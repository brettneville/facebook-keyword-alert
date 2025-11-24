// content.js - defensive scan + auto-scroll + verbose logging

const CS_DEBUG_PREFIX = "[FB Keyword Alert CS]";
let csDebugLogging = false;
let lastScanResults = new Set();
let isScanInProgress = false;

// ===== LOGGING HELPERS =====

chrome.storage.local.get(["debugLogging"], (res) => {
  csDebugLogging = !!res.debugLogging;
  if (csDebugLogging) {
    console.log(CS_DEBUG_PREFIX, "Verbose logging enabled");
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.debugLogging) {
    csDebugLogging = !!changes.debugLogging.newValue;
    console.log(
      CS_DEBUG_PREFIX,
      "Verbose logging is now",
      csDebugLogging ? "ON" : "OFF"
    );
  }
});

function csLogDebug(...args) {
  if (csDebugLogging) {
    console.log(CS_DEBUG_PREFIX, ...args);
  }
}

function csLogInfo(...args) {
  console.log(CS_DEBUG_PREFIX, ...args);
}

// ===== UTILITIES =====

function generatePostId(post) {
  try {
    const content = (post && post.textContent) || "";
    const timestamp =
      (post &&
        post.getAttribute &&
        post.getAttribute("data-utime")) ||
      "";

    return `${content.substring(0, 50)}_${timestamp}`.replace(
      /\s+/g,
      "_"
    );
  } catch (error) {
    console.error(CS_DEBUG_PREFIX, "Error generating post ID:", error);
    return `post_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
  }
}

function extractPostsFromPage() {
  csLogDebug("Extracting posts from page");

  const postSelectors = [
    '[role="article"]',
    ".userContentWrapper",
    'div[data-ad-preview="message"]',
    ".storyStream > div",
    'div[data-testid="post_message"]',
    ".fbUserContent",
    'div[dir="auto"]'
  ];

  let posts = [];

  try {
    postSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      csLogDebug(
        `Found ${elements.length} elements with selector: ${selector}`
      );
      elements.forEach((element) => {
        if (
          element &&
          element.textContent &&
          element.textContent.trim().length > 10
        ) {
          posts.push(element);
        }
      });
    });

    posts = [...new Set(posts)];
    csLogDebug(`Total unique posts found: ${posts.length}`);
  } catch (error) {
    console.error(
      CS_DEBUG_PREFIX,
      "Error while extracting posts from page:",
      error
    );
  }

  return posts;
}

function extractTextFromPost(post) {
  if (!post) return "";

  try {
    const clone = post.cloneNode(true);

    const elementsToRemove = clone.querySelectorAll(
      "button, .comment, .share, .like, [role='button'], .uiMorePagerPrimary, .see_more_link"
    );
    elementsToRemove.forEach((el) => el.remove());

    let text = clone.textContent || "";

    text = text
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\n+/g, " ")
      .substring(0, 1000);

    return text;
  } catch (error) {
    console.error(
      CS_DEBUG_PREFIX,
      "Error extracting text from post:",
      error
    );
    return (post && post.textContent) || "";
  }
}

function extractGroupName() {
  try {
    const groupSelectors = [
      '[data-pagelet="GroupRoot"] h1',
      "h1[dir='auto']",
      ".groupName",
      "title"
    ];

    for (const selector of groupSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        const name = element.textContent.trim();
        if (name) {
          return name;
        }
      }
    }

    const url = window.location.href;
    const match = url.match(/groups\/([^\/?]+)/);
    return match ? decodeURIComponent(match[1]) : "unknown-group";
  } catch (error) {
    console.error(CS_DEBUG_PREFIX, "Error extracting group name:", error);
    return "unknown-group";
  }
}

function extractPostTimestamp(post) {
  try {
    const timeSelectors = [
      "abbr[data-utime]",
      "span[data-utime]",
      "time",
      "[aria-label*='hrs']",
      "[aria-label*='mins']",
      "[aria-label*='days']"
    ];

    for (const selector of timeSelectors) {
      const timeElement = post.querySelector(selector);
      if (timeElement) {
        const utime = timeElement.getAttribute("data-utime");
        if (utime) {
          return new Date(parseInt(utime, 10) * 1000).toISOString();
        }

        const ariaLabel = timeElement.getAttribute("aria-label");
        if (ariaLabel) {
          const now = new Date();
          if (ariaLabel.includes("hrs")) {
            const hours = parseInt(ariaLabel, 10) || 0;
            now.setHours(now.getHours() - hours);
          } else if (ariaLabel.includes("mins")) {
            const minutes = parseInt(ariaLabel, 10) || 0;
            now.setMinutes(now.getMinutes() - minutes);
          } else if (ariaLabel.includes("days")) {
            const days = parseInt(ariaLabel, 10) || 0;
            now.setDate(now.getDate() - days);
          }
          return now.toISOString();
        }
      }
    }

    return new Date().toISOString();
  } catch (error) {
    console.error(
      CS_DEBUG_PREFIX,
      "Error extracting timestamp:",
      error
    );
    return new Date().toISOString();
  }
}

function extractPostUrl(post) {
  try {
    const linkSelectors = [
      'a[href*="/posts/"]',
      'a[href*="/permalink/"]',
      'a[aria-label*="Story"]'
    ];

    for (const selector of linkSelectors) {
      const link = post.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }

    return window.location.href;
  } catch (error) {
    console.error(CS_DEBUG_PREFIX, "Error extracting post URL:", error);
    return window.location.href;
  }
}

// ===== CORE SCAN =====

async function extractDataFromPosts(rawKeywords) {
  try {
    const keywords = Array.isArray(rawKeywords)
      ? rawKeywords
      : typeof rawKeywords === "string"
      ? rawKeywords.split(",")
      : [];

    const cleanedKeywords = keywords
      .map((k) => (k || "").toString().trim())
      .filter((k) => k.length > 0);

    if (cleanedKeywords.length === 0) {
      console.warn(
        CS_DEBUG_PREFIX,
        "No valid keywords provided for scan."
      );
      return [];
    }

    csLogInfo(
      `Scanning for keywords: ${cleanedKeywords.join(", ")}`
    );
    console.time("[FB Keyword Alert] extractDataFromPosts");

    const posts = extractPostsFromPage();
    const matches = [];
    const currentScanResults = new Set();
    const groupName = extractGroupName();

    for (const post of posts) {
      try {
        const postId = generatePostId(post);

        if (currentScanResults.has(postId)) {
          continue;
        }
        currentScanResults.add(postId);

        const text = extractTextFromPost(post);
        if (!text || text.length < 5) continue;

        const lowerText = text.toLowerCase();

        for (const keyword of cleanedKeywords) {
          const lowerKeyword = keyword.toLowerCase();
          if (lowerKeyword && lowerText.includes(lowerKeyword)) {
            const matchId = `${postId}_${lowerKeyword}`;
            if (lastScanResults.has(matchId)) {
              continue;
            }

            csLogInfo(
              `Match found for "${keyword}": ${text.substring(
                0,
                100
              )}...`
            );

            const timestamp = extractPostTimestamp(post);
            const postUrl = extractPostUrl(post);

            matches.push({
              keyword: keyword,
              group: groupName,
              groupName: groupName,
              preview:
                text.substring(0, 200) +
                (text.length > 200 ? "..." : ""),
              timestamp: timestamp,
              fullText: text,
              postUrl: postUrl
            });

            lastScanResults.add(matchId);
            break;
          }
        }
      } catch (error) {
        console.error(
          CS_DEBUG_PREFIX,
          "Error processing individual post:",
          error
        );
      }
    }

    if (lastScanResults.size > 1000) {
      lastScanResults = new Set(
        Array.from(lastScanResults).slice(-500)
      );
    }

    csLogInfo(
      `Found ${matches.length} keyword match(es) on this pass`
    );
    console.timeEnd("[FB Keyword Alert] extractDataFromPosts");

    return matches;
  } catch (error) {
    console.error(
      CS_DEBUG_PREFIX,
      "Fatal error in extractDataFromPosts:",
      error
    );
    return [];
  }
}

// ===== AUTO-SCROLL =====

async function autoScrollAndScan(keywords, maxScrollAttempts = 5) {
  csLogInfo(
    `Starting auto-scroll with max ${maxScrollAttempts} attempts`
  );

  const allMatches = [];
  let previousPostCount = 0;
  let currentPostCount = 0;
  let scrollAttempts = 0;
  let noNewPostsCount = 0;

  try {
    do {
      const currentMatches = await extractDataFromPosts(keywords);
      allMatches.push(...currentMatches);

      previousPostCount = currentPostCount;
      currentPostCount = document.querySelectorAll(
        '[role="article"]'
      ).length;

      csLogDebug(
        `Posts visible: ${currentPostCount}, Matches this pass: ${currentMatches.length}`
      );

      if (currentPostCount === previousPostCount) {
        noNewPostsCount++;
        csLogDebug(
          `No new posts loaded (attempt ${noNewPostsCount}/3)`
        );
      } else {
        noNewPostsCount = 0;
      }

      if (noNewPostsCount >= 3) {
        csLogInfo(
          "No new posts loading, stopping auto-scroll"
        );
        break;
      }

      csLogDebug("Scrolling page to load more posts...");
      const previousScrollHeight =
        document.body.scrollHeight ||
        document.documentElement.scrollHeight ||
        0;
      window.scrollTo(0, previousScrollHeight);

      await waitForNewContent(previousScrollHeight);

      scrollAttempts++;
    } while (scrollAttempts < maxScrollAttempts);
  } catch (error) {
    console.error(
      CS_DEBUG_PREFIX,
      "Fatal error during auto-scroll scan:",
      error
    );
  }

  csLogInfo(
    `Auto-scroll complete. Total matches: ${allMatches.length}`
  );
  return allMatches;
}

function waitForNewContent(previousScrollHeight) {
  return new Promise((resolve) => {
    let checks = 0;
    const maxChecks = 10;

    const checkInterval = setInterval(() => {
      checks++;

      const currentScrollHeight =
        document.body.scrollHeight ||
        document.documentElement.scrollHeight ||
        0;

      if (currentScrollHeight > previousScrollHeight) {
        csLogDebug("New content detected after scroll");
        clearInterval(checkInterval);
        resolve();
        return;
      }

      const loadingIndicators = document.querySelector(
        "[role='progressbar'], .uiLoadingIndicator"
      );
      if (!loadingIndicators) {
        csLogDebug(
          "No loading indicators; assuming content loaded"
        );
        clearInterval(checkInterval);
        resolve();
        return;
      }

      if (checks >= maxChecks) {
        csLogDebug("Scroll timeout reached; moving on");
        clearInterval(checkInterval);
        resolve();
      }
    }, 500);
  });
}

async function scanForKeywordsWithAutoScroll(keywords, options = {}) {
  const { enableAutoScroll = false, maxScrollAttempts = 5 } = options;

  const safeKeywords = Array.isArray(keywords)
    ? keywords
    : typeof keywords === "string"
    ? keywords.split(",")
    : [];

  if (!safeKeywords.length) {
    console.warn(
      CS_DEBUG_PREFIX,
      "scanForKeywordsWithAutoScroll called with no keywords."
    );
    return [];
  }

  if (enableAutoScroll) {
    csLogInfo("Starting scan with auto-scroll enabled");
    return await autoScrollAndScan(safeKeywords, maxScrollAttempts);
  } else {
    csLogInfo("Starting scan of visible posts only");
    return await extractDataFromPosts(safeKeywords);
  }
}

// ===== MESSAGE HANDLER =====

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.action !== "scan") {
    return;
  }

  csLogInfo("Received scan request:", request);

  if (isScanInProgress) {
    console.warn(
      CS_DEBUG_PREFIX,
      "Scan request ignored because a scan is already in progress on this page."
    );
    sendResponse({
      matches: [],
      error: "scan_in_progress"
    });
    return;
  }

  isScanInProgress = true;
  console.time("[FB Keyword Alert] Full scan cycle");

  const keywords = request.keywords;
  const autoScroll = !!request.autoScroll;
  const maxScrollAttempts =
    typeof request.maxScrollAttempts === "number"
      ? request.maxScrollAttempts
      : 3;

  scanForKeywordsWithAutoScroll(keywords, {
    enableAutoScroll: autoScroll,
    maxScrollAttempts: maxScrollAttempts
  })
    .then((matches) => {
      csLogInfo(
        `Sending ${matches.length} matches back to background/popup`
      );
      sendResponse({ matches });
    })
    .catch((error) => {
      console.error(CS_DEBUG_PREFIX, "Scan error:", error);
      sendResponse({
        matches: [],
        error: error && error.message ? error.message : String(error)
      });
    })
    .finally(() => {
      console.timeEnd("[FB Keyword Alert] Full scan cycle");
      isScanInProgress = false;
    });

  return true;
});

// ===== PAGE HOOKS =====

window.addEventListener("load", () => {
  csLogInfo("Page loaded, ready for scanning");
});

let scrollTimeout;
window.addEventListener("scroll", () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    csLogDebug("User scrolled; page content may have changed");
  }, 1000);
});

console.log(
  CS_DEBUG_PREFIX,
  "Content script initialized successfully (defensive mode)"
);
