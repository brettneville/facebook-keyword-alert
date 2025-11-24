// content.js
console.log("[FB Keyword Alert] Content script loaded");

// ==================== STATE ====================

// Store the last scan results to avoid duplicates across runs
let lastScanResults = new Set();
// Avoid overlapping scans on the same page
let isScanInProgress = false;

// ==================== UTILITIES ====================

// Generate a unique ID for a post based on its content and timestamp
function generatePostId(post) {
    try {
        const content = (post && post.textContent) || "";
        const timestamp =
            (post && post.getAttribute && post.getAttribute("data-utime")) ||
            "";

        // Use first 50 chars of content + timestamp
        return `${content.substring(0, 50)}_${timestamp}`.replace(/\s+/g, "_");
    } catch (error) {
        console.error("[FB Keyword Alert] Error generating post ID:", error);
        return `post_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
}

// Improved function to extract posts from Facebook's DOM
function extractPostsFromPage() {
    console.log("[FB Keyword Alert] Extracting posts from page");

    // Multiple selectors to catch different Facebook post structures
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
            console.log(
                `[FB Keyword Alert] Found ${elements.length} elements with selector: ${selector}`
            );
            elements.forEach((element) => {
                // Only add if it contains substantial text content
                if (
                    element &&
                    element.textContent &&
                    element.textContent.trim().length > 10
                ) {
                    posts.push(element);
                }
            });
        });

        // Remove duplicates by element reference
        posts = [...new Set(posts)];
        console.log(
            `[FB Keyword Alert] Total unique posts found: ${posts.length}`
        );
    } catch (error) {
        console.error(
            "[FB Keyword Alert] Error while extracting posts from page:",
            error
        );
    }

    return posts;
}

// Extract text content from a post element
function extractTextFromPost(post) {
    if (!post) return "";

    try {
        // Clone the node to avoid modifying the original
        const clone = post.cloneNode(true);

        // Remove interactive elements that aren't part of the main content
        const elementsToRemove = clone.querySelectorAll(
            "button, .comment, .share, .like, [role='button'], .uiMorePagerPrimary, .see_more_link"
        );
        elementsToRemove.forEach((el) => el.remove());

        // Get clean text content
        let text = clone.textContent || "";

        // Clean up the text
        text = text
            .trim()
            .replace(/\s+/g, " ") // Replace multiple spaces with single space
            .replace(/\n+/g, " ") // Replace newlines with spaces
            .substring(0, 1000); // Limit length

        return text;
    } catch (error) {
        console.error(
            "[FB Keyword Alert] Error extracting text from post:",
            error
        );
        return (post && post.textContent) || "";
    }
}

// Extract group name from the page
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
                if (name && name.length > 0) {
                    return name;
                }
            }
        }

        // Fallback to URL parsing
        const url = window.location.href;
        const match = url.match(/groups\/([^\/?]+)/);
        return match ? decodeURIComponent(match[1]) : "unknown-group";
    } catch (error) {
        console.error(
            "[FB Keyword Alert] Error extracting group name:",
            error
        );
        return "unknown-group";
    }
}

// Extract post timestamp
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
            "[FB Keyword Alert] Error extracting timestamp:",
            error
        );
        return new Date().toISOString();
    }
}

// Extract post URL
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
        console.error(
            "[FB Keyword Alert] Error extracting post URL:",
            error
        );
        return window.location.href;
    }
}

// ==================== CORE SCAN LOGIC ====================

// Main function to extract data from posts and check for keyword matches
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
                "[FB Keyword Alert] No valid keywords provided for scan."
            );
            return [];
        }

        console.log(
            `[FB Keyword Alert] Scanning for keywords: ${cleanedKeywords.join(
                ", "
            )}`
        );

        console.time("[FB Keyword Alert] extractDataFromPosts");

        const posts = extractPostsFromPage();
        const matches = [];
        const currentScanResults = new Set();
        const groupName = extractGroupName();

        for (const post of posts) {
            try {
                const postId = generatePostId(post);

                // Skip if we've already processed this post in the current scan
                if (currentScanResults.has(postId)) {
                    continue;
                }
                currentScanResults.add(postId);

                const text = extractTextFromPost(post);
                if (!text || text.length < 5) continue;

                const lowerText = text.toLowerCase();

                // Check for keyword matches
                for (const keyword of cleanedKeywords) {
                    const lowerKeyword = keyword.toLowerCase();
                    if (lowerKeyword && lowerText.includes(lowerKeyword)) {
                        // Skip if this is a duplicate from recent scans
                        const matchId = `${postId}_${lowerKeyword}`;
                        if (lastScanResults.has(matchId)) {
                            continue;
                        }

                        console.log(
                            `[FB Keyword Alert] Match found for "${keyword}": ${text.substring(
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

                        // Remember this match to avoid duplicates
                        lastScanResults.add(matchId);
                        // Only count one keyword match per post per scan; move to next post
                        break;
                    }
                }
            } catch (error) {
                console.error(
                    "[FB Keyword Alert] Error processing individual post:",
                    error
                );
            }
        }

        // Clean up old scan results to prevent memory issues
        if (lastScanResults.size > 1000) {
            lastScanResults = new Set(
                Array.from(lastScanResults).slice(-500)
            );
        }

        console.log(
            `[FB Keyword Alert] Found ${matches.length} keyword match(es)`
        );
        console.timeEnd("[FB Keyword Alert] extractDataFromPosts");

        return matches;
    } catch (error) {
        console.error(
            "[FB Keyword Alert] Fatal error in extractDataFromPosts:",
            error
        );
        return [];
    }
}

// ==================== AUTO-SCROLL FUNCTIONS ====================

/**
 * Auto-scroll and scan to load more posts
 */
async function autoScrollAndScan(keywords, maxScrollAttempts = 5) {
    console.log(
        `[FB Keyword Alert] 🔄 Starting auto-scroll with max ${maxScrollAttempts} attempts`
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

            // Count current posts
            previousPostCount = currentPostCount;
            currentPostCount = document.querySelectorAll(
                '[role="article"]'
            ).length;

            console.log(
                `[FB Keyword Alert] 📊 Posts visible: ${currentPostCount}, Matches found this pass: ${currentMatches.length}`
            );

            if (currentPostCount === previousPostCount) {
                noNewPostsCount++;
                console.log(
                    `[FB Keyword Alert] ⏸️ No new posts loaded (attempt ${noNewPostsCount}/3)`
                );
            } else {
                noNewPostsCount = 0;
            }

            if (noNewPostsCount >= 3) {
                console.log(
                    "[FB Keyword Alert] 🚫 No new posts loading, stopping auto-scroll"
                );
                break;
            }

            // Scroll to bottom to load more posts
            console.log(
                "[FB Keyword Alert] ⬇️ Scrolling page to load more posts..."
            );
            const previousScrollHeight =
                document.body.scrollHeight ||
                document.documentElement.scrollHeight ||
                0;
            window.scrollTo(0, previousScrollHeight);

            // Wait for new content to load with more sophisticated detection
            await waitForNewContent(previousScrollHeight);

            scrollAttempts++;
        } while (scrollAttempts < maxScrollAttempts);
    } catch (error) {
        console.error(
            "[FB Keyword Alert] Fatal error during auto-scroll scan:",
            error
        );
    }

    console.log(
        `[FB Keyword Alert] ✅ Auto-scroll complete. Total matches: ${allMatches.length}`
    );
    return allMatches;
}

/**
 * Wait for new content to load after scrolling
 */
function waitForNewContent(previousScrollHeight) {
    return new Promise((resolve) => {
        let checks = 0;
        const maxChecks = 10; // 5 seconds max wait

        const checkInterval = setInterval(() => {
            checks++;

            const currentScrollHeight =
                document.body.scrollHeight ||
                document.documentElement.scrollHeight ||
                0;

            // Check if scroll height changed (new content loaded)
            if (currentScrollHeight > previousScrollHeight) {
                console.log("[FB Keyword Alert] 📄 New content detected");
                clearInterval(checkInterval);
                resolve();
                return;
            }

            // Check for loading indicators
            const loadingIndicators = document.querySelector(
                "[role='progressbar'], .uiLoadingIndicator"
            );
            if (!loadingIndicators) {
                console.log(
                    "[FB Keyword Alert] ⚡ No loading indicators; assuming content loaded"
                );
                clearInterval(checkInterval);
                resolve();
                return;
            }

            // Timeout after max checks
            if (checks >= maxChecks) {
                console.log(
                    "[FB Keyword Alert] ⏰ Scroll timeout reached; moving on"
                );
                clearInterval(checkInterval);
                resolve();
            }
        }, 500); // Check every 500ms
    });
}

/**
 * Enhanced scan function with auto-scroll support
 */
async function scanForKeywordsWithAutoScroll(keywords, options = {}) {
    const { enableAutoScroll = false, maxScrollAttempts = 5 } = options;

    // Defensive: normalize keywords early
    const safeKeywords = Array.isArray(keywords)
        ? keywords
        : typeof keywords === "string"
        ? keywords.split(",")
        : [];

    if (!safeKeywords.length) {
        console.warn(
            "[FB Keyword Alert] scanForKeywordsWithAutoScroll called with no keywords."
        );
        return [];
    }

    if (enableAutoScroll) {
        console.log(
            "[FB Keyword Alert] 🔍 Starting scan with auto-scroll enabled"
        );
        return await autoScrollAndScan(safeKeywords, maxScrollAttempts);
    } else {
        console.log(
            "[FB Keyword Alert] 🔍 Starting scan of visible posts only"
        );
        return await extractDataFromPosts(safeKeywords);
    }
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || request.action !== "scan") {
        return;
    }

    console.log("[FB Keyword Alert] Received scan request:", request);

    if (isScanInProgress) {
        console.warn(
            "[FB Keyword Alert] Scan request ignored because a scan is already in progress on this page."
        );
        sendResponse({
            matches: [],
            error: "scan_in_progress"
        });
        return; // Do not return true, we responded synchronously
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
            console.log(
                `[FB Keyword Alert] Sending ${matches.length} matches back to background/popup`
            );
            sendResponse({ matches });
        })
        .catch((error) => {
            console.error("[FB Keyword Alert] Scan error:", error);
            sendResponse({
                matches: [],
                error: error && error.message ? error.message : String(error)
            });
        })
        .finally(() => {
            console.timeEnd("[FB Keyword Alert] Full scan cycle");
            isScanInProgress = false;
        });

    // Keep message channel open for async response
    return true;
});

// ==================== PAGE HOOKS ====================

// Log when the page loads
window.addEventListener("load", () => {
    console.log("[FB Keyword Alert] Page loaded, ready for scanning");
});

// Log on user scroll (no automatic scanning here to avoid churn)
let scrollTimeout;
window.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        console.log(
            "[FB Keyword Alert] User scrolled; page content may have changed"
        );
    }, 1000);
});

console.log(
    "[FB Keyword Alert] Content script initialized successfully (defensive mode)"
);
