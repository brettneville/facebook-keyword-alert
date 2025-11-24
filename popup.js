// popup.js
document.addEventListener("DOMContentLoaded", function () {
  loadSettings();
  loadScanStatus();

  document
    .getElementById("saveSettings")
    .addEventListener("click", saveSettings);
  document.getElementById("scanNow").addEventListener("click", scanNow);
  document
    .getElementById("testWebhook")
    .addEventListener("click", testWebhook);
  document.getElementById("openGroups").addEventListener("click", openGroups);
});

// ====== SETTINGS LOAD/SAVE ======
function loadSettings() {
  chrome.storage.local.get(
    [
      "keywords",
      "webhookUrl",
      "scanInterval",
      "autoScroll",
      "maxScrollAttempts",
      "facebookGroups",
      "autoOpenGroups"
    ],
    function (result) {
      const keywords = (result.keywords || []).join(", ");
      document.getElementById("keywords").value = keywords;

      document.getElementById("webhookUrl").value =
        result.webhookUrl || "";

      document.getElementById("scanInterval").value =
        result.scanInterval || 5;

      document.getElementById("autoScroll").checked =
        result.autoScroll || false;

      document.getElementById("maxScrollAttempts").value =
        result.maxScrollAttempts || 3;

      const facebookGroups = (result.facebookGroups || []).join(", ");
      document.getElementById("facebookGroups").value = facebookGroups;

      document.getElementById("autoOpenGroups").checked =
        result.autoOpenGroups || false;

      updateUI();
    }
  );
}

function saveSettings() {
  const keywords = document
    .getElementById("keywords")
    .value.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  const webhookUrl = document.getElementById("webhookUrl").value.trim();
  const scanInterval =
    parseInt(document.getElementById("scanInterval").value) || 0;
  const autoScroll = document.getElementById("autoScroll").checked;
  const maxScrollAttempts =
    parseInt(document.getElementById("maxScrollAttempts").value) || 3;
  const facebookGroups = document
    .getElementById("facebookGroups")
    .value.split(/[\n,]/)
    .map((url) => url.trim())
    .filter(
      (url) =>
        url.length > 0 && url.includes("facebook.com/groups/")
    );
  const autoOpenGroups =
    document.getElementById("autoOpenGroups").checked;

  if (keywords.length === 0) {
    showStatus("Please enter at least one keyword", "error");
    return;
  }

  if (!webhookUrl) {
    showStatus("Please enter a webhook URL", "error");
    return;
  }

  if (!webhookUrl.includes("https://script.google.com/macros/")) {
    if (
      !confirm(
        "This doesn't look like a Google Apps Script URL. Continue anyway?"
      )
    ) {
      return;
    }
  }

  showStatus("Saving settings...", "info");

  chrome.storage.local.set(
    {
      keywords: keywords,
      webhookUrl: webhookUrl,
      scanInterval: scanInterval,
      autoScroll: autoScroll,
      maxScrollAttempts: maxScrollAttempts,
      facebookGroups: facebookGroups,
      autoOpenGroups: autoOpenGroups
    },
    function () {
      showStatus("Settings saved successfully!", "success");

      // Ask background to refresh its alarm and do an immediate scan on open group tabs
      chrome.tabs.query(
        { url: "*://*.facebook.com/groups/*" },
        function (tabs) {
          tabs.forEach((tab) => {
            chrome.runtime.sendMessage(
              {
                action: "restartAutoScan",
                tabId: tab.id
              },
              () => {}
            );
          });
        }
      );

      setTimeout(loadScanStatus, 1000);
      updateUI();
    }
  );
}

// ====== STATUS / UI ======

function loadScanStatus() {
  chrome.runtime.sendMessage({ action: "getScanStatus" }, function (response) {
    if (response) {
      const statusElement = document.getElementById("scanStatus");
      if (response.autoScanEnabled) {
        let count =
          typeof response.totalIntervals === "number"
            ? response.totalIntervals
            : response.activeTabs || 0;

        let statusText = `🟢 Auto-scan active (${count} tab${
          count === 1 ? "" : "s"
        })`;
        if (response.isCurrentlyScanning) {
          statusText += " - Scanning now...";
        }
        statusElement.innerHTML = statusText;
        statusElement.className = "status-active";
      } else {
        statusElement.innerHTML = "🟡 Auto-scan disabled";
        statusElement.className = "status-inactive";
      }
    }
  });
}

function updateUI() {
  // Hook for any future dynamic UI changes based on settings
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = "status " + type;

  setTimeout(() => {
    status.className = "status";
  }, 4000);
}

function getKeywords() {
  const keywordsText = document.getElementById("keywords").value;
  return keywordsText
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// ====== COMMANDS ======

function scanNow() {
  showStatus("Preparing to scan...", "info");

  chrome.tabs.query(
    { active: true, currentWindow: true },
    function (tabs) {
      if (tabs.length === 0) {
        showStatus("No active tab found", "error");
        return;
      }

      const currentTab = tabs[0];

      if (
        !currentTab.url ||
        !currentTab.url.includes("facebook.com/groups/")
      ) {
        showStatus(
          "Please navigate to a Facebook group page first",
          "error"
        );

        if (
          confirm(
            "You need to be on a Facebook group page to scan. Would you like to open Facebook Groups now?"
          )
        ) {
          chrome.tabs.create({ url: "https://facebook.com/groups" });
        }
        return;
      }

      showStatus("Scanning current page...", "info");

      const keywords = getKeywords();

      chrome.tabs.sendMessage(
        currentTab.id,
        {
          action: "scan",
          keywords: keywords,
          autoScroll:
            document.getElementById("autoScroll").checked,
          maxScrollAttempts:
            parseInt(
              document.getElementById("maxScrollAttempts").value
            ) || 3
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus(
              "Error: " +
                chrome.runtime.lastError.message +
                ". Try refreshing the page.",
              "error"
            );
            return;
          }

          if (response && response.matches) {
            if (response.matches.length > 0) {
              showStatus(
                `Found ${response.matches.length} matches on this page`,
                "success"
              );
            } else {
              showStatus("No matches found on this page", "info");
            }
          } else {
            showStatus("No response from content script", "error");
          }
        }
      );
    }
  );
}

function testWebhook() {
  const webhookUrl = document.getElementById("webhookUrl").value.trim();
  if (!webhookUrl) {
    showStatus("Please enter a webhook URL first", "error");
    return;
  }

  showStatus("Sending test webhook request...", "info");

  chrome.runtime.sendMessage(
    { action: "testWebhook" },
    (response) => {
      if (response) {
        if (response.success) {
          showStatus(
            "✅ Webhook test successful! Check your Google Sheet for the test entry.",
            "success"
          );
        } else {
          showStatus(
            "❌ Webhook test failed: " +
              (response.error || "Unknown error"),
            "error"
          );
        }
      } else {
        showStatus(
          "❌ No response from background script",
          "error"
        );
      }
    }
  );
}

function openGroups() {
  showStatus("Opening Facebook groups...", "info");

  chrome.runtime.sendMessage(
    { action: "autoOpenGroups" },
    (response) => {
      if (response && response.success) {
        showStatus(
          "✅ Facebook groups are being opened in background tabs!",
          "success"
        );
      } else {
        showStatus("Failed to open groups", "error");
      }
    }
  );
}
