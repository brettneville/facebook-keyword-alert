// content.js
console.log("Facebook Keyword Alert content script loaded");

// Store the last scan results to avoid duplicates
let lastScanResults = new Set();

// Generate a unique ID for a post based on its content and timestamp
function generatePostId(post) {
    const content = post.textContent || '';
    const timestamp = post.getAttribute('data-utime') || '';
    return `${content.substring(0, 50)}_${timestamp}`.replace(/\s+/g, '_');
}

// Improved function to extract posts from Facebook's DOM
function extractPostsFromPage() {
    console.log("Extracting posts from page");
    
    // Multiple selectors to catch different Facebook post structures
    const postSelectors = [
        '[role="article"]',
        '.userContentWrapper',
        'div[data-ad-preview="message"]',
        '.storyStream > div',
        'div[data-testid="post_message"]',
        '.fbUserContent',
        'div[dir="auto"]'
    ];

    let posts = [];
    
    postSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        elements.forEach(element => {
            // Only add if it contains substantial text content
            if (element.textContent && element.textContent.trim().length > 10) {
                posts.push(element);
            }
        });
    });

    // Remove duplicates by element reference
    posts = [...new Set(posts)];
    console.log(`Total unique posts found: ${posts.length}`);
    return posts;
}

// Extract text content from a post element
function extractTextFromPost(post) {
    try {
        // Clone the node to avoid modifying the original
        const clone = post.cloneNode(true);
        
        // Remove interactive elements that aren't part of the main content
        const elementsToRemove = clone.querySelectorAll(
            'button, .comment, .share, .like, [role="button"], .uiMorePagerPrimary, .see_more_link'
        );
        elementsToRemove.forEach(el => el.remove());

        // Get clean text content
        let text = clone.textContent || '';
        
        // Clean up the text
        text = text.trim()
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .substring(0, 1000); // Limit length

        return text;
    } catch (error) {
        console.error('Error extracting text from post:', error);
        return post.textContent || '';
    }
}

// Extract group name from the page
function extractGroupName() {
    try {
        // Try multiple selectors for group name
        const groupSelectors = [
            '[data-pagelet="GroupRoot"] h1',
            'h1[dir="auto"]',
            '.groupName',
            'title'
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
        return match ? decodeURIComponent(match[1]) : 'unknown-group';
    } catch (error) {
        console.error('Error extracting group name:', error);
        return 'unknown-group';
    }
}

// Extract post timestamp
function extractPostTimestamp(post) {
    try {
        // Look for time elements
        const timeSelectors = [
            'abbr[data-utime]',
            'span[data-utime]',
            'time',
            '[aria-label*="hrs"]',
            '[aria-label*="mins"]',
            '[aria-label*="days"]'
        ];

        for (const selector of timeSelectors) {
            const timeElement = post.querySelector(selector);
            if (timeElement) {
                const utime = timeElement.getAttribute('data-utime');
                if (utime) {
                    return new Date(parseInt(utime) * 1000).toISOString();
                }
                
                const ariaLabel = timeElement.getAttribute('aria-label');
                if (ariaLabel) {
                    // Convert relative time to approximate timestamp
                    const now = new Date();
                    if (ariaLabel.includes('hrs')) {
                        const hours = parseInt(ariaLabel) || 0;
                        now.setHours(now.getHours() - hours);
                    } else if (ariaLabel.includes('mins')) {
                        const minutes = parseInt(ariaLabel) || 0;
                        now.setMinutes(now.getMinutes() - minutes);
                    } else if (ariaLabel.includes('days')) {
                        const days = parseInt(ariaLabel) || 0;
                        now.setDate(now.getDate() - days);
                    }
                    return now.toISOString();
                }
            }
        }

        return new Date().toISOString();
    } catch (error) {
        console.error('Error extracting timestamp:', error);
        return new Date().toISOString();
    }
}

// Extract post URL
function extractPostUrl(post) {
    try {
        // Look for post permalink
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
        console.error('Error extracting post URL:', error);
        return window.location.href;
    }
}

// Main function to extract data from posts and check for keyword matches
async function extractDataFromPosts(keywords) {
    console.log(`Scanning for keywords: ${keywords.join(', ')}`);
    
    const posts = extractPostsFromPage();
    const matches = [];
    const currentScanResults = new Set();

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
            for (const keyword of keywords) {
                const lowerKeyword = keyword.toLowerCase().trim();
                if (lowerKeyword && lowerText.includes(lowerKeyword)) {
                    
                    // Skip if this is a duplicate from recent scans
                    const matchId = `${postId}_${lowerKeyword}`;
                    if (lastScanResults.has(matchId)) {
                        continue;
                    }

                    console.log(`Match found for "${keyword}": ${text.substring(0, 100)}...`);
                    
                    matches.push({
                        keyword: keyword,
                        group: extractGroupName(),
                        groupName: extractGroupName(),
                        preview: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
                        timestamp: extractPostTimestamp(post),
                        fullText: text,
                        postUrl: extractPostUrl(post)
                    });

                    // Remember this match to avoid duplicates
                    lastScanResults.add(matchId);
                    break; // Only count one match per post per keyword
                }
            }
        } catch (error) {
            console.error('Error processing post:', error);
        }
    }

    // Clean up old scan results to prevent memory issues
    if (lastScanResults.size > 1000) {
        lastScanResults = new Set(Array.from(lastScanResults).slice(-500));
    }

    console.log(`Found ${matches.length} keyword matches`);
    return matches;
}

// ==================== AUTO-SCROLL FUNCTIONS ====================

/**
 * Auto-scroll and scan to load more posts
 */
async function autoScrollAndScan(keywords, maxScrollAttempts = 5) {
    const allMatches = [];
    let previousPostCount = 0;
    let currentPostCount = 0;
    let scrollAttempts = 0;
    let noNewPostsCount = 0;

    console.log(`🔄 Starting auto-scroll with ${maxScrollAttempts} attempts`);

    do {
        // Scan current visible posts using existing function
        const currentMatches = await extractDataFromPosts(keywords);
        allMatches.push(...currentMatches);
        
        // Count current posts
        previousPostCount = currentPostCount;
        currentPostCount = document.querySelectorAll('[role="article"]').length;
        
        console.log(`📊 Posts visible: ${currentPostCount}, Matches found: ${currentMatches.length}`);

        // Check if we're getting new posts
        if (currentPostCount === previousPostCount) {
            noNewPostsCount++;
            console.log(`⏸️ No new posts loaded (attempt ${noNewPostsCount}/3)`);
        } else {
            noNewPostsCount = 0; // Reset counter if we got new posts
        }

        // Stop if no new posts after multiple attempts
        if (noNewPostsCount >= 3) {
            console.log('🚫 No new posts loading, stopping scroll');
            break;
        }

        // Scroll to bottom to load more posts
        console.log('⬇️ Scrolling to load more posts...');
        const previousScrollHeight = document.body.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
        
        // Wait for new content to load with more sophisticated detection
        await waitForNewContent(previousScrollHeight);
        
        scrollAttempts++;

    } while (scrollAttempts < maxScrollAttempts);

    console.log(`✅ Auto-scroll complete. Total matches: ${allMatches.length}`);
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
            
            // Check if scroll height changed (new content loaded)
            if (document.body.scrollHeight > previousScrollHeight) {
                console.log('📄 New content detected');
                clearInterval(checkInterval);
                resolve();
                return;
            }
            
            // Check for loading indicators
            const loadingIndicators = document.querySelector('[role="progressbar"], .uiLoadingIndicator');
            if (!loadingIndicators) {
                // No loading indicators, probably done
                console.log('⚡ Content appears loaded');
                clearInterval(checkInterval);
                resolve();
                return;
            }
            
            // Timeout after max checks
            if (checks >= maxChecks) {
                console.log('⏰ Scroll timeout reached');
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
    
    if (enableAutoScroll) {
        console.log('🔍 Starting scan with auto-scroll enabled');
        return await autoScrollAndScan(keywords, maxScrollAttempts);
    } else {
        console.log('🔍 Starting scan of visible posts only');
        return await extractDataFromPosts(keywords);
    }
}

// Listen for messages from the background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scan") {
        console.log("Received scan request", request);
        
        // Use the enhanced scanning function with auto-scroll support
        scanForKeywordsWithAutoScroll(request.keywords, {
            enableAutoScroll: request.autoScroll || false,
            maxScrollAttempts: request.maxScrollAttempts || 3
        }).then(matches => {
            console.log(`Sending ${matches.length} matches to background`);
            sendResponse({ matches });
        }).catch(error => {
            console.error('Scan error:', error);
            sendResponse({ matches: [], error: error.message });
        });
        
        return true; // Keep message channel open for async response
    }
});

// Also scan when the page loads initially
window.addEventListener('load', () => {
    console.log('Page loaded, ready for scanning');
});

// Re-scan when user scrolls (optional - can be intensive)
let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        console.log('User scrolled, page content may have changed');
    }, 1000);
});

console.log("Facebook Keyword Alert content script initialized successfully");
