// background.js - MV3-safe auto-scan with alarms + group management
console.log("Facebook Keyword Alert background script loaded");

// ====== GLOBAL STATE ======
const SCAN_ALARM_NAME = "fb-keyword-scan";

let isScanning = false; // are we currently running a global scan?

// ====== STORAGE HELPERS ======
function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        "keywords",
        "webhookUrl",
        "scanInterval",
        "autoScroll",
        "maxScrollAttempts",
        "facebookGroups",
        "autoOpenGroups",
        "notificationsEnabled",
        "autoScanEnabled"
      ],
      (result) => {
        const defaults = {
          keywords: [],
          webhookUrl: "",
          scanInterval: 5,
          autoScroll: false,
          maxScrollAttempts: 3,
          facebookGroups: [],
          autoOpenGroups: false,
          notificationsEnabled: true,
          autoScanEnabled: false
        };

        // Normalize types
        let keywords = result.keywords || [];
        if (typeof keywords === "string") {
          keywords = keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
        }

        let facebookGroups = result.facebookGroups || [];
        if (!Array.isArray(facebookGroups)) {
          facebookGroups = [];
        }

        resolve({
          ...defaults,
          ...result,
          keywords,
          facebookGroups
        });
      }
    );
  });
}

// ====== WEBHOOK SENDER ======
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
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            matches: matches,
            source: source,
            timestamp: new Date().toISOString()
          })
        });

        if (response.ok) {
          console.log("Successfully sent matches to webhook");
          resolve();
        } else {
          console.error(
            "Failed to send matches to webhook",
            response.status
          );
          reject(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("Error sending to webhook", error);
        reject(error);
      }
    });
  });
}

// ====== MANUAL SCAN HANDLER (LEGACY SUPPORT) ======
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
        console.log(
          `Sending ${response.matches.length} matches to sheets`
        );
        sendToSheets(response.matches, "manual")
          .then(() => {
            sendResponse({
              success: true,
              matches: response.matches
            });
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error
            });
          });
      } else {
        sendResponse({
          success: true,
          matches: []
        });
      }
    }
  );
}

// ====== TAB HELPERS ======
function isFacebookGroupTab(tab) {
  return tab.url && tab.url.includes("facebook.com/groups/");
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

  // Check if current tab URL matches any configured group URL
  return facebookGroups.some((groupUrl) => {
    if (!groupUrl) return false;
    try {
      return tab.url && tab.url.startsWith(groupUrl);
    } catch {
      return false;
    }
  });
}

// ====== AUTO-SCAN ENGINE (ALARMS) ======

async function ensureScanAlarm() {
  const settings = await getStoredSettings();
  const scanInterval = settings.scanInterval || 5;

  if (!scanInterval || scanInterval <= 0) {
    console.log("[FB Alert] Scan interval disabled, clearing alarm");
    chrome.alarms.clear(SCAN_ALARM_NAME);
    chrome.storage.local.set({ autoScanEnabled: false });
    return;
  }

  console.log(
    `[FB Alert] Creating/refreshing scan alarm every ${scanInterval} min`
  );

  chrome.alarms.create(SCAN_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: scanInterval
  });

  chrome.storage.local.set({ autoScanEnabled: true });
}

/**
 * Perform a scan on a specific tab using current settings
 */
async function performTabScan(tabId, cachedSettings) {
  const settings = cachedSettings || (await getStoredSettings());

  try {
    console.log(`🔍 Scanning tab ${tabId}`);
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "scan",
      keywords: settings.keywords || [],
      autoScroll: settings.autoScroll || false,
      maxScrollAttempts: settings.maxScrollAttempts || 3
    });

    if (response && response.matches && response.matches.length > 0) {
      console.log(
        `✅ Found ${response.matches.length} matches in tab ${tabId}`
      );

      await sendToSheets(response.matches, "auto_scan");

      if (settings.notificationsEnabled !== false) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon48.png",
          title: "Facebook Keyword Alert",
          message: `Found ${response.matches.length} new matches!`
        });
      }
    } else {
      console.log(`❌ No matches found in tab ${tabId}`);
    }
  } catch (error) {
    console.error(`Error scanning tab ${tabId}:`, error);
  }
}

/**
 * Scan all eligible Facebook group tabs when the alarm fires
 */
async function scanAllEligibleTabs() {
  if (isScanning) {
    console.log("⏸️ Global scan already in progress, skipping...");
    return;
  }

  isScanning = true;

  try {
    const settings = await getStoredSettings();

    chrome.tabs.query(
      { url: "*://*.facebook.com/groups/*" },
      async (tabs) => {
        const eligibleTabs = [];

        for (const tab of tabs) {
          if (await shouldScanTab(tab)) {
            eligibleTabs.push(tab);
          }
        }

        if (eligibleTabs.length === 0) {
          console.log(
            "[FB Alert] No eligible group tabs open to scan right now"
          );
          return;
        }

        console.log(
          `[FB Alert] Scanning ${eligibleTabs.length} eligible group tab(s)`
        );

        // Scan sequentially to avoid hammering the page
        for (const tab of eligibleTabs) {
          await performTabScan(tab.id, settings);
        }
      }
    );
  } finally {
    isScanning = false;
  }
}

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCAN_ALARM_NAME) {
    scanAllEligibleTabs();
  }
});

// ====== AUTO-OPEN GROUPS / TAB MANAGEMENT ======

async function enhancedAutoOpenFacebookGroups() {
  try {
    const settings = await getStoredSettings();
    const facebookGroups = settings.facebookGroups || [];

    if (!facebookGroups.length) {
      console.log("[FB Alert] No facebookGroups configured");
      return;
    }

    console.log(
      `[FB Alert] Auto-opening ${facebookGroups.length} Facebook groups`
    );

    // First, get current tabs so we don't duplicate
    chrome.tabs.query(
      { url: "*://*.facebook.com/groups/*" },
      (existingTabs) => {
        const existingUrls = new Set(
          (existingTabs || []).map((t) => t.url || "")
        );

        facebookGroups.forEach((groupUrl, index) => {
          if (!groupUrl) return;
          if (existingUrls.has(groupUrl)) {
            console.log(
              `↪ Group already open, skipping: ${groupUrl}`
            );
            return;
          }

          setTimeout(() => {
            chrome.tabs.create(
              {
                url: groupUrl,
                active: false
              },
              (tab) => {
                console.log(`✅ Opened Facebook group: ${groupUrl}`);

                // Optionally kick off an immediate scan once loaded
                chrome.tabs.onUpdated.addListener(function once(
                  updatedTabId,
                  changeInfo
                ) {
                  if (
                    updatedTabId === tab.id &&
                    changeInfo.status === "complete"
                  ) {
                    chrome.tabs.onUpdated.removeListener(once);
                    performTabScan(tab.id);
                  }
                });
              }
            );
          }, index * 1000);
        });
      }
    );
  } catch (error) {
    console.error("Error auto-opening Facebook groups:", error);
  }
}

async function closeGroupTabs() {
  chrome.tabs.query(
    { url: "*://*.facebook.com/groups/*" },
    async (tabs) => {
      const eligible = [];
      for (const tab of tabs) {
        if (await shouldScanTab(tab)) {
          eligible.push(tab);
        }
      }
      const ids = eligible.map((t) => t.id);
      if (ids.length) {
        chrome.tabs.remove(ids);
      }
    }
  );
}

async function refreshGroupTabs() {
  chrome.tabs.query(
    { url: "*://*.facebook.com/groups/*" },
    async (tabs) => {
      const eligible = [];
      for (const tab of tabs) {
        if (await shouldScanTab(tab)) {
          eligible.push(tab);
        }
      }
      eligible.forEach((tab) => {
        chrome.tabs.reload(tab.id);
      });
    }
  );
}

async function getGroupTabCount() {
  return new Promise((resolve) => {
    chrome.tabs.query(
      { url: "*://*.facebook.com/groups/*" },
      async (tabs) => {
        let count = 0;
        for (const tab of tabs) {
          if (await shouldScanTab(tab)) {
            count++;
          }
        }
        resolve(count);
      }
    );
  });
}

// ====== MESSAGE HANDLER ======

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request);

  // Legacy direct scan
  if (request.action === "scan") {
    handleScanRequest(request, sender, sendResponse);
    return true;
  }

  // Manual scan of current tab (unused by popup right now but kept)
  if (request.action === "manualScan" && sender.tab) {
    performTabScan(sender.tab.id).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Popup status query
  if (request.action === "getScanStatus") {
    chrome.alarms.get(SCAN_ALARM_NAME, async (alarm) => {
      const count = await getGroupTabCount();
      const status = {
        autoScanEnabled: !!alarm,
        activeTabs: count,
        totalIntervals: count, // for backward compatibility with popup.js
        isCurrentlyScanning: isScanning
      };
      sendResponse(status);
    });
    return true;
  }

  // Popup asking to "restart" auto scan for a tab after settings change
  if (request.action === "restartAutoScan" && request.tabId) {
    ensureScanAlarm();
    performTabScan(request.tabId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Popup "Open Groups" button
  if (request.action === "autoOpenGroups" || request.action === "openAllGroups") {
    enhancedAutoOpenFacebookGroups().then(() => {
      ensureScanAlarm();
      sendResponse({ success: true });
    });
    return true;
  }

  // Options page: close group tabs
  if (request.action === "closeGroupTabs") {
    closeGroupTabs().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Options page: refresh group tabs
  if (request.action === "refreshGroupTabs") {
    refreshGroupTabs().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Options page: count group tabs
  if (request.action === "getGroupTabCount") {
    getGroupTabCount().then((count) => {
      sendResponse({ count });
    });
    return true;
  }

  // Options page: get settings
  if (request.action === "getSettings") {
    getStoredSettings().then((settings) => {
      sendResponse({
        keywords: settings.keywords || [],
        groups: settings.facebookGroups || [],
        googleSheetsUrl: settings.webhookUrl || "",
        notificationsEnabled: settings.notificationsEnabled !== false
      });
    });
    return true;
  }

  // Options page: save settings
  if (request.action === "saveSettings" && request.settings) {
    const s = request.settings;
    const keywords = Array.isArray(s.keywords) ? s.keywords : [];
    const groups = Array.isArray(s.groups) ? s.groups : [];
    const webhookUrl = s.googleSheetsUrl || "";
    const notificationsEnabled = !!s.notificationsEnabled;

    chrome.storage.local.set(
      {
        keywords,
        facebookGroups: groups,
        webhookUrl,
        notificationsEnabled
      },
      () => {
        ensureScanAlarm();
        sendResponse({ success: true });
      }
    );
    return true;
  }

  // Webhook test
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
            preview:
              "This is a test message from the Facebook Keyword Alert extension",
            timestamp: new Date().toISOString(),
            fullText:
              "This is a test message from the Facebook Keyword Alert extension. If you can see this, your webhook is working correctly!",
            postUrl: "https://facebook.com/groups/test-group"
          }
        ],
        source: "test_webhook",
        timestamp: new Date().toISOString()
      };

      fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(testData)
      })
        .then((response) => {
          if (response.ok) {
            sendResponse({ success: true });
          } else {
            sendResponse({
              success: false,
              error: `HTTP ${response.status}`
            });
          }
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.toString() });
        });
    });
    return true;
  }
});

// ====== LIFECYCLE HOOKS ======

// When a Facebook group tab finishes loading, optionally scan it once
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isFacebookGroupTab(tab)) {
    shouldScanTab(tab).then((should) => {
      if (should) {
        console.log(
          `✅ Facebook group tab loaded and approved for scanning: ${tab.url}`
        );
        performTabScan(tabId);
      } else {
        console.log(
          `⏸️ Facebook group tab loaded but not in monitored list: ${tab.url}`
        );
      }
    });
  }
});

// Recreate alarm on startup/install
chrome.runtime.onInstalled.addListener(() => {
  ensureScanAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureScanAlarm();
});

// If scanInterval changes in storage, update alarm
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    if (changes.scanInterval || changes.facebookGroups) {
      ensureScanAlarm();
    }
  }
});
