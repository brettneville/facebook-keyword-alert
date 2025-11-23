// Content script - runs on Facebook group pages
class GroupMonitor {
  constructor() {
    this.settings = null;
    this.observer = null;
    this.autoScrollInterval = null;
    this.initialize();
  }

  async initialize() {
    console.log('🔍 Facebook Group Monitor loaded');
    
    // Get settings from background
    this.settings = await this.getSettings();
    
    // Start monitoring
    this.startMonitoring();
    this.startAutoScroll();
    
    // Listen for messages from background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'checkForKeywords') {
        this.scanVisiblePosts();
      }
      return true;
    });
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error getting settings:', chrome.runtime.lastError);
          resolve({ keywords: [] });
        } else {
          resolve(response);
        }
      });
    });
  }

  startMonitoring() {
    // Scan existing posts
    this.scanVisiblePosts();
    
    // Set up observer for new posts
    this.setupMutationObserver();
    
    // Also scan on scroll (for infinite scroll)
    window.addEventListener('scroll', this.debounce(() => {
      this.scanVisiblePosts();
    }, 1000));
  }

  startAutoScroll() {
    // Auto-scroll every 2 minutes to load new posts
    this.autoScrollInterval = setInterval(() => {
      if (this.isTabVisible()) {
        this.scrollToLoadNewPosts();
      }
    }, 120000); // 2 minutes
    
    console.log('🔄 Auto-scroll enabled (every 2 minutes)');
  }

  isTabVisible() {
    return !document.hidden;
  }

  scrollToLoadNewPosts() {
    // Scroll to bottom to trigger Facebook's infinite scroll
    const currentScroll = window.scrollY;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    
    // Only scroll if we're not already at the bottom
    if (maxScroll - currentScroll > 500) {
      window.scrollTo(0, document.body.scrollHeight);
      console.log('🔄 Auto-scrolled to load new posts');
      
      // Scan for new posts after a delay
      setTimeout(() => {
        this.scanVisiblePosts();
      }, 3000);
    } else {
      console.log('📜 Already near bottom, no scroll needed');
    }
  }

  setupMutationObserver() {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          this.scanNewNodes(mutation.addedNodes);
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  scanNewNodes(nodes) {
    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const posts = node.querySelectorAll('[role="article"], div[data-pagelet], div[role="feed"] > div');
        this.scanPosts(posts);
      }
    }
  }

  scanVisiblePosts() {
    const posts = document.querySelectorAll('[role="article"], div[data-pagelet], div[role="feed"] > div');
    this.scanPosts(posts);
  }

  async scanPosts(posts) {
    if (!this.settings) {
      this.settings = await this.getSettings();
    }

    console.log(`🔍 Scanning ${posts.length} posts for keywords...`);

    for (const post of posts) {
      await this.scanPost(post);
    }
  }

  async scanPost(post) {
    try {
      const text = post.textContent;
      if (!text || text.length < 50) return;

      // Generate a simple ID for the post
      const postId = this.generatePostId(text);
      
      // Check if we've already seen this post
      const isSeen = await this.isPostSeen(postId);
      if (isSeen) return;

      // Check for keywords
      for (const keyword of this.settings.keywords) {
        if (text.toLowerCase().includes(keyword.toLowerCase())) {
          console.log(`✅ Found keyword: ${keyword}`);
          
          const matchData = {
            postId: postId,
            keyword: keyword,
            group: this.getGroupName(),
            groupUrl: window.location.href,
            preview: text.substring(0, 200) + '...',
            fullText: text,
            timestamp: new Date().toISOString()
          };

          // Send to background for processing
          chrome.runtime.sendMessage({
            action: 'keywordMatchFound',
            data: matchData
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('Error sending match:', chrome.runtime.lastError);
            }
          });

          break; // Only match one keyword per post
        }
      }
    } catch (error) {
      console.log('⚠️ Error scanning post:', error);
    }
  }

  generatePostId(text) {
    // Simple hash-based ID
    return btoa(text.substring(0, 100)).replace(/[^a-zA-Z0-9]/g, '');
  }

  async isPostSeen(postId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'isPostSeen', postId }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Error checking seen post:', chrome.runtime.lastError);
          resolve(false);
        } else {
          resolve(response);
        }
      });
    });
  }

  getGroupName() {
    // Extract group name from page
    const title = document.title.replace(' | Facebook', '');
    const urlMatch = window.location.pathname.match(/\/groups\/([^\/]+)/);
    return urlMatch ? urlMatch[1] : title;
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Cleanup when page unloads
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.autoScrollInterval) {
      clearInterval(this.autoScrollInterval);
    }
  }
}

// Start the monitor when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.groupMonitor = new GroupMonitor();
  });
} else {
  window.groupMonitor = new GroupMonitor();
}

// Cleanup when page unloads
window.addEventListener('beforeunload', () => {
  if (window.groupMonitor) {
    window.groupMonitor.destroy();
  }
});