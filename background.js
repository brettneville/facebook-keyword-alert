// background.js - MV3-friendly auto-scan with alarms, group filtering, auto-open, and verbose logging

const SCAN_ALARM_NAME = "fb-keyword-scan";
const DEBUG_PREFIX = "[FB Keyword Alert BG]";

let isScanning = false;
let debugLogging = false;

// ========= LOGGING HELPERS =========

function loadDebugFlag() {
  chrome.storage.local.get(["debugLogging"], (res) => {
    debugLogging = !!res.debugLogging;
    console.log(
      DEBUG_PREFIX,
      "Verbose logging is",
      debugLogging ? "ON" : "OFF"
    );
  });
}

function logDebug(...args) {
  if (debugLogging) {
    console.log(DEBUG_PREFIX, ...args);
  }
}

function logInfo(...args) {
  console.log(DEBUG_PREFIX, ...args);
}

// initial load
loadDebugFlag();

// react to changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.debugLogging) {
    debugLogging = !!changes.debugLogging.newValue;
    console.log(
      DEBUG_PREFIX,
      "Verbose logging is now",
      debugLogging ? "ON" : "OFF"
    );
  }
});

// ========= SETTINGS HELPERS =========

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
        "debugLogging"
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
          debugLogging: false
        };

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
          facebookGroups,
          debugLogging: !!result.debugLogging
        });
      }
    );
  });
}

// ========= WEBHOOK SENDER =========

async function sendToSheets(matches, source = "extension") {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["webhookUrl"], async (result) => {
      const webhookUrl = result.webhookUrl;
      if (!webhookUrl) {
        console.error(DEBUG_PREFIX, "No webhook URL set");
        reject("No webhook URL set");
        return;
      }

      logDebug(`Sending ${matches.length} matches to webhook`);

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            matches,
            source,
            timestamp: new Date().toISOString()
          })
        });

        if (response.ok) {
          logInfo("Successfully sent matches to webhook");
          resolve();
        } else {
          console.error(
            DEBUG_PREFIX,
            "Failed to send matches to webhook",
            response.status
          );
          reject(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error(DEBUG_PREFIX, "Error sending to webhook", error);
        reject(error);
      }
    });
  });
}

// ========= MANUAL SCAN HANDLER (LEGACY SUPPORT) =========

function handleScanRequest(request, sender, sendResponse) {
  logDebug("Handling direct scan request", request);

  if (!sender.tab) {
    console.error(DEBUG_PREFIX, "No tab associated with request");
    sendResponse({ error: "No tab associated with request" });
    return;
  }

  chrome.tabs.sendMessage(
    sender.tab.id,
    { action: "scan", keywords: request.keywords },
    (response) => {
      logDebug("Received response from content script", response);
      if (response && response.matches && response.matches.length > 0) {
        logInfo(`Sending ${response.matches.length} matches to sheets (manual)`);
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

// ========= TAB HELPERS =========

function isFacebookGroupTab(tab) {
  return tab.url && tab.url.includes("facebook.com/groups/");
}

async function shouldScanTab(tab) {
  const settings = await getStoredSettings();
  const facebookGroups = settings.facebookGroups || [];

  if (facebookGroups.length === 0) {
    // No filters: scan every FB group
    return true;
  }

  return facebookGroups.some((groupUrl) => {
    if (!groupUrl) return false;
    try {
      return tab.url && tab.url.startsWith(groupUrl);
    } catch (e) {
      return false;
    }
  });
}

// ========= AUTO-SCAN ENGINE (ALARMS) =========

async function ensureScanAlarm() {
  const settings = await getStoredSettings();
  const scanInterval = settings.scanInterval || 5;

  if (!scanInterval || scanInterval <= 0) {
    logInfo("Scan interval disabled, clearing alarm");
    chrome.alarms.clear(SCAN_ALARM_NAME);
    return;
  }

  logInfo(`Creating/refreshing scan alarm every ${scanInterval} minute(s)`);

  chrome.alarms.create(SCAN_ALARM_NAME, {
    delayInMinutes: 0.1,
    periodInMinutes: scanInterval
  });
}

async function performTabScan(tabId, cachedSettings) {
  const settings = cachedSettings || (await getStoredSettings());

  try {
    logDebug(`Scanning tab ${tabId} with settings`, {
      keywords: settings.keywords,
      autoScroll: settings.autoScroll,
      maxScrollAttempts: settings.maxScrollAttempts
    });

    const response = await chrome.tabs.sendMessage(tabId, {
      action: "scan",
      keywords: settings.keywords || [],
      autoScroll: settings.autoScroll || false,
      maxScrollAttempts: settings.maxScrollAttempts || 3
    });

    if (response && response.matches && response.matches.length > 0) {
      logInfo(`Found ${response.matches.length} matches in tab ${tabId}`);
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
      logDebug(`No matches found in tab ${tabId}`);
    }
  } catch (error) {
    console.error(DEBUG_PREFIX, `Error scanning tab ${tabId}:`, error);
  }
}

async function scanAllEligibleTabs() {
  if (isScanning) {
    logDebug("Global scan already in progress; skipping");
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
          logDebug("No eligible group tabs open to scan");
          return;
        }

        logInfo(
          `Scanning ${eligibleTabs.length} eligible group tab(s) for keywords`
        );

        // Sequential to be nice to FB
        for (const tab of eligibleTabs) {
          await performTabScan(tab.id, settings);
        }
      }
    );
  } finally {
    isScanning = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCAN_ALARM_NAME) {
    scanAllEligibleTabs();
  }
});

// ========= GROUP TAB MANAGEMENT =========

async function enhancedAutoOpenFacebookGroups() {
  try {
    const settings = await getStoredSettings();
    const facebookGroups = settings.facebookGroups || [];

    if (!facebookGroups.length) {
      logInfo("No facebookGroups configured; nothing to open");
      return;
    }

    logInfo(`Auto-opening ${facebookGroups.length} Facebook groups`);

    chrome.tabs.query(
      { url: "*://*.facebook.com/groups/*" },
      (existingTabs) => {
        const existingUrls = new Set(
          (existingTabs || []).map((t) => t.url || "")
        );

        facebookGroups.forEach((groupUrl, index) => {
          if (!groupUrl) return;
          if (existingUrls.has(groupUrl)) {
            logDebug(`Group already open, skipping: ${groupUrl}`);
            return;
          }

          setTimeout(() => {
            chrome.tabs.create(
              {
                url: groupUrl,
                active: false
              },
              (tab) => {
                logInfo(`Opened Facebook group: ${groupUrl}`);

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
          }, index * 700);
        });
      }
    );
  } catch (error) {
    console.error(DEBUG_PREFIX, "Error auto-opening Facebook groups:", error);
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
      eligible.forEach((tab) => chrome.tabs.reload(tab.id));
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

// ========= MESSAGE HANDLER =========

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  logDebug("Background received message:", request);

  // legacy direct scan
  if (request.action === "scan") {
    handleScanRequest(request, sender, sendResponse);
    return true;
  }

  if (request.action === "manualScan" && sender.tab) {
    performTabScan(sender.tab.id).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getScanStatus") {
    chrome.alarms.get(SCAN_ALARM_NAME, async (alarm) => {
      const count = await getGroupTabCount();
      const status = {
        autoScanEnabled: !!alarm,
        activeTabs: count,
        totalIntervals: count,
        isCurrentlyScanning: isScanning
      };
      sendResponse(status);
    });
    return true;
  }

  if (request.action === "restartAutoScan" && request.tabId) {
    ensureScanAlarm();
    performTabScan(request.tabId).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "autoOpenGroups" || request.action === "openAllGroups") {
    enhancedAutoOpenFacebookGroups().then(() => {
      ensureScanAlarm();
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "closeGroupTabs") {
    closeGroupTabs().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === "refreshGroupTabs") {
    refreshGroupTabs().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === "getGroupTabCount") {
    getGroupTabCount().then((count) => sendResponse({ count }));
    return true;
  }

  if (request.action === "getSettings") {
    getStoredSettings().then((settings) => {
      sendResponse({
        keywords: settings.keywords || [],
        groups: settings.facebookGroups || [],
        googleSheetsUrl: settings.webhookUrl || "",
        notificationsEnabled: settings.notificationsEnabled !== false,
        debugLogging: settings.debugLogging === true
      });
    });
    return true;
  }

  if (request.action === "saveSettings" && request.settings) {
    const s = request.settings;
    const keywords = Array.isArray(s.keywords) ? s.keywords : [];
    const groups = Array.isArray(s.groups) ? s.groups : [];
    const webhookUrl = s.googleSheetsUrl || "";
    const notificationsEnabled = !!s.notificationsEnabled;
    const debugLoggingFlag = !!s.debugLogging;

    chrome.storage.local.set(
      {
        keywords,
        facebookGroups: groups,
        webhookUrl,
        notificationsEnabled,
        debugLogging: debugLoggingFlag
      },
      () => {
        logInfo("Settings saved from options page");
        ensureScanAlarm();
        sendResponse({ success: true });
      }
    );
    return true;
  }

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

// ========= LIFECYCLE HOOKS =========

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isFacebookGroupTab(tab)) {
    shouldScanTab(tab).then((should) => {
      if (should) {
        logDebug("Facebook group tab loaded & approved for scanning:", tab.url);
        performTabScan(tabId);
      } else {
        logDebug("Group tab not in monitored list; skipping:", tab.url);
      }
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  logInfo("Extension installed; ensuring alarm");
  ensureScanAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  logInfo("Browser startup; ensuring alarm");
  ensureScanAlarm();
});

console.log("Facebook Keyword Alert background script initialized successfully");
