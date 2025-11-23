// background.js - COMPLETE VERSION WITH AUTO-SCAN, GROUPS FILTERING, AND AUTO-OPEN
console.log("Facebook Keyword Alert background script loaded");

let scanIntervals = new Map();
let isScanning = false;

// Your existing sendToSheets function
async function sendToSheets(matches, source = "extension") {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["webhookUrl"], async (result) => {
            const webhookUrl = result.webhookUrl;
            if (!webhookUrl) {
                console.error("No webhook URL set");
                reject("No webhook URL set");
                return;
            }

            console.log(`Sending ${matches.length} matches to webhook`);

            try {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        matches: matches,
                        source: source,
                        timestamp: new Date().toISOString(),
                    }),
                });

                if (response.ok) {
                    console.log("Successfully sent matches to webhook");
                    resolve();
                } else {
                    console.error("Failed to send matches to webhook", response.status);
                    reject(`HTTP ${response.status}`);
                }
            } catch (error) {
                console.error("Error sending to webhook", error);
                reject(error);
            }
        });
    });
}

// Your existing handleScanRequest function
function handleScanRequest(request, sender, sendResponse) {
    console.log("Handling scan request", request);

    if (!sender.tab) {
        console.error("No tab associated with request");
        sendResponse({ error: "No tab associated with request" });
        return;
    }

    chrome.tabs.sendMessage(
        sender.tab.id,
        { action: "scan", keywords: request.keywords },
        (response) => {
            console.log("Received response from content script", response);
            if (response && response.matches && response.matches.length > 0) {
                console.log(`Sending ${response.matches.length} matches to sheets`);
                sendToSheets(response.matches, "manual")
                    .then(() => {
                        sendResponse({
                            success: true,
                            matches: response.matches,
                        });
                    })
                    .catch((error) => {
                        sendResponse({
                            success: false,
                            error: error,
                        });
                    });
            } else {
                sendResponse({
                    success: true,
                    matches: [],
                });
            }
        }
    );
}

// ==================== AUTO-SCROLL & AUTO-REFRESH FUNCTIONS ====================

/**
 * Start auto-scan for a specific tab
 */
async function startAutoScanForTab(tabId) {
    // Stop existing scan for this tab
    stopAutoScanForTab(tabId);
    
    try {
        const settings = await getStoredSettings();
        const scanInterval = settings.scanInterval || 5; // Default 5 minutes
        
        if (scanInterval > 0) {
            console.log(`🔄 Starting auto-scan for tab ${tabId} every ${scanInterval} minutes`);
            
            const intervalId = setInterval(async () => {
                if (!isScanning) {
                    await performTabScan(tabId);
                } else {
                    console.log('⏸️ Scan already in progress, skipping...');
                }
            }, scanInterval * 60 * 1000);
            
            scanIntervals.set(tabId, intervalId);
            
            // Perform initial scan immediately
            await performTabScan(tabId);
        }
    } catch (error) {
        console.error('Error starting auto-scan:', error);
    }
}

/**
 * Stop auto-scan for a specific tab
 */
function stopAutoScanForTab(tabId) {
    if (scanIntervals.has(tabId)) {
        clearInterval(scanIntervals.get(tabId));
        scanIntervals.delete(tabId);
        console.log(`🛑 Stopped auto-scan for tab ${tabId}`);
    }
}

/**
 * Perform a scan on a specific tab
 */
async function performTabScan(tabId) {
    if (isScanning) {
        console.log('⏸️ Scan already in progress, skipping...');
        return;
    }
    
    try {
        isScanning = true;
        const settings = await getStoredSettings();
        
        console.log(`🔍 Auto-scanning tab ${tabId}`);
        
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'scan',
            keywords: settings.keywords || [],
            autoScroll: settings.autoScroll || false,
            maxScrollAttempts: settings.maxScrollAttempts || 3
        });
        
        if (response && response.matches && response.matches.length > 0) {
            console.log(`✅ Found ${response.matches.length} matches in tab ${tabId}`);
            
            // Use your existing sendToSheets function
            await sendToSheets(response.matches, 'auto_scan');
            
            // Show notification for new matches
            if (response.matches.length > 0) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Facebook Keyword Alert',
                    message: `Found ${response.matches.length} new matches!`
                });
            }
        } else {
            console.log(`❌ No matches found in tab ${tabId}`);
        }
        
    } catch (error) {
        console.error(`Error scanning tab ${tabId}:`, error);
        // Tab might not be ready or content script not loaded
    } finally {
        isScanning = false;
    }
}

/**
 * Check if tab is a Facebook group
 */
function isFacebookGroupTab(tab) {
    return tab.url && tab.url.includes('facebook.com/groups/');
}

/**
 * Check if tab should be scanned based on configured groups
 */
async function shouldScanTab(tab) {
    const settings = await getStoredSettings();
    const facebookGroups = settings.facebookGroups || [];
    
    // If no groups specified, scan all Facebook groups
    if (facebookGroups.length === 0) {
        return true;
    }
    
    // Check if current tab URL matches any configured group
    return facebookGroups.some(groupUrl => {
        return tab.url.includes(groupUrl);
    });
}

/**
 * Get stored settings
 */
function getStoredSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['keywords', 'webhookUrl', 'scanInterval', 'autoScroll', 'maxScrollAttempts', 'facebookGroups', 'autoOpenGroups'], (result) => {
            resolve(result);
        });
    });
}

// ==================== AUTO-OPEN FUNCTIONALITY ====================

/**
 * Enhanced auto-open that manages existing tabs and only opens missing groups
 */
async function enhancedAutoOpenFacebookGroups() {
    try {
        const settings = await getStoredSettings();
        const facebookGroups = settings.facebookGroups || [];
        
        if (facebookGroups.length === 0) {
            console.log('⏸️ No specific Facebook groups configured for auto-opening');
            return;
        }
        
        // Get all existing Facebook group tabs
        const existingTabs = await new Promise(resolve => {
            chrome.tabs.query({url: "*://*.facebook.com/groups/*"}, resolve);
        });
        
        const existingUrls = existingTabs.map(tab => tab.url);
        const groupsToOpen = [];
        
        // Find groups that aren't already open
        facebookGroups.forEach(groupUrl => {
            const isAlreadyOpen = existingUrls.some(url => url.includes(groupUrl));
            if (!isAlreadyOpen) {
                groupsToOpen.push(groupUrl);
            } else {
                console.log(`⏸️ Group already open: ${groupUrl}`);
            }
        });
        
        if (groupsToOpen.length === 0) {
            console.log('✅ All configured Facebook groups are already open');
            return;
        }
        
        console.log(`🔄 Auto-opening ${groupsToOpen.length} new Facebook groups`);
        
        // Open missing groups
        groupsToOpen.forEach((groupUrl, index) => {
            setTimeout(() => {
                chrome.tabs.create({ 
                    url: groupUrl,
                    active: false // Open in background
                }, (tab) => {
                    console.log(`✅ Opened Facebook group: ${groupUrl}`);
                    // Start auto-scan for this new tab
                    startAutoScanForTab(tab.id);
                });
            }, index * 1000);
        });
        
    } catch (error) {
        console.error('Error auto-opening Facebook groups:', error);
    }
}

/**
 * Check if we should auto-open groups (on browser start)
 */
function shouldAutoOpenGroups() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['autoOpenGroups'], (result) => {
            resolve(result.autoOpenGroups !== false); // Default to true if not set
        });
    });
}

// Initialize when extension loads
chrome.runtime.onStartup.addListener(initializeAutoScan);
chrome.runtime.onInstalled.addListener(initializeAutoScan);

function initializeAutoScan() {
    console.log('🚀 Facebook Keyword Alert auto-scan initialized');
    // Clear any existing intervals
    scanIntervals.forEach((interval, tabId) => {
        clearInterval(interval);
        scanIntervals.delete(tabId);
    });
    
    // Auto-open Facebook groups on startup
    shouldAutoOpenGroups().then(shouldOpen => {
        if (shouldOpen) {
            enhancedAutoOpenFacebookGroups();
        }
    });
}

// Listen for tab updates to manage auto-scan
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && isFacebookGroupTab(tab)) {
        shouldScanTab(tab).then(shouldScan => {
            if (shouldScan) {
                console.log(`✅ Facebook group tab loaded and approved for scanning: ${tab.url}`);
                startAutoScanForTab(tabId);
            } else {
                console.log(`⏸️ Facebook group tab loaded but not in monitored list: ${tab.url}`);
            }
        });
    }
});

// Stop scanning when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    stopAutoScanForTab(tabId);
});

// Enhanced message listener with all functionality
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background received message:", request);
    
    if (request.action === "scan") {
        // Your existing scan logic
        handleScanRequest(request, sender, sendResponse);
        return true;
    }
    
    // NEW ACTIONS FOR AUTO-SCANNING:
    if (request.action === 'manualScan' && sender.tab) {
        performTabScan(sender.tab.id).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    
    if (request.action === 'getScanStatus') {
        const status = {
            autoScanEnabled: scanIntervals.size > 0,
            activeTabs: Array.from(scanIntervals.keys()),
            totalIntervals: scanIntervals.size,
            isCurrentlyScanning: isScanning
        };
        sendResponse(status);
    }
    
    if (request.action === 'restartAutoScan' && request.tabId) {
        startAutoScanForTab(request.tabId).then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Auto-open groups action
    if (request.action === 'autoOpenGroups') {
        enhancedAutoOpenFacebookGroups().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Your existing testWebhook action
    if (request.action === "testWebhook") {
        chrome.storage.local.get(["webhookUrl"], (result) => {
            const webhookUrl = result.webhookUrl;
            if (!webhookUrl) {
                sendResponse({ success: false, error: "No webhook URL set" });
                return;
            }

            const testData = {
                matches: [
                    {
                        keyword: "test",
                        group: "test-group",
                        groupName: "Test Group",
                        preview: "This is a test message from the Facebook Keyword Alert extension",
                        timestamp: new Date().toISOString(),
                        fullText: "This is a test message from the Facebook Keyword Alert extension. If you can see this, your webhook is working correctly!",
                        postUrl: "https://facebook.com/groups/test-group/posts/123456789",
                    },
                ],
                source: "test",
                timestamp: new Date().toISOString(),
            };

            fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(testData),
            })
                .then((response) => {
                    if (response.ok) {
                        sendResponse({ success: true });
                    } else {
                        sendResponse({
                            success: false,
                            error: `HTTP ${response.status}`,
                        });
                    }
                })
                .catch((error) => {
                    sendResponse({ success: false, error: error.message });
                });
        });
        return true;
    }
});

console.log("Facebook Keyword Alert background script initialized successfully");
