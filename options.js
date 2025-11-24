// options.js - options page with group/tab tools + verbose logging toggle

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[FB Keyword Alert Options] Page loaded");
  await loadSettings();
  await updateTabCount();

  document.getElementById("save").addEventListener("click", saveSettings);
  document
    .getElementById("openGroups")
    .addEventListener("click", openAllGroups);
  document
    .getElementById("closeGroups")
    .addEventListener("click", closeGroupTabs);
  document
    .getElementById("refreshGroups")
    .addEventListener("click", refreshGroups);

  setInterval(updateTabCount, 5000);
});

async function loadSettings() {
  try {
    const settings = await getSettings();
    console.log("[FB Keyword Alert Options] Loaded settings:", settings);

    document.getElementById("keywords").value =
      (settings.keywords || []).join("\n");
    document.getElementById("groups").value =
      (settings.groups || []).join("\n");
    document.getElementById("googleSheetsUrl").value =
      settings.googleSheetsUrl || "";
    document.getElementById("notificationsEnabled").checked =
      settings.notificationsEnabled !== false;

    const debugCheckbox = document.getElementById("debugLogging");
    if (debugCheckbox) {
      debugCheckbox.checked = settings.debugLogging === true;
    }
  } catch (error) {
    console.error("[FB Keyword Alert Options] Error loading settings:", error);
    showStatus(
      "❌ Error loading settings: " + (error.message || String(error)),
      "error"
    );
  }
}

async function saveSettings() {
  try {
    const keywords = document
      .getElementById("keywords")
      .value.split("\n")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    const groups = document
      .getElementById("groups")
      .value.split("\n")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);

    const debugCheckbox = document.getElementById("debugLogging");

    const settings = {
      keywords: keywords,
      groups: groups,
      googleSheetsUrl:
        document.getElementById("googleSheetsUrl").value.trim(),
      notificationsEnabled:
        document.getElementById("notificationsEnabled").checked,
      debugLogging: debugCheckbox ? debugCheckbox.checked : false
    };

    console.log("[FB Keyword Alert Options] Saving settings:", settings);

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "saveSettings", settings },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });

    if (response && response.success) {
      showStatus("✅ Settings saved successfully!", "success");
    } else {
      showStatus("❌ Failed to save settings", "error");
    }
  } catch (error) {
    console.error("[FB Keyword Alert Options] Save error:", error);
    showStatus(
      "❌ Error saving settings: " + (error.message || String(error)),
      "error"
    );
  }
}

async function openAllGroups() {
  const settings = await getSettings();
  const groups = settings.groups || [];

  if (groups.length === 0) {
    showStatus(
      "❌ No groups configured. Please save your groups first.",
      "error"
    );
    return;
  }

  showStatus(
    `Opening ${groups.length} group(s) in background...`,
    "info"
  );

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "openAllGroups" },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });

    if (response && response.success) {
      showStatus(
        "✅ Groups opening in background tabs!",
        "success"
      );
    } else {
      showStatus("❌ Failed to open groups", "error");
    }
  } catch (error) {
    console.error("[FB Keyword Alert Options] Error opening groups:", error);
    showStatus(
      "❌ Error opening groups: " + (error.message || String(error)),
      "error"
    );
  }
}

async function closeGroupTabs() {
  showStatus("Closing group tabs...", "info");
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "closeGroupTabs" },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });
    showStatus("✅ Group tabs closed", "success");
    updateTabCount();
  } catch (error) {
    console.error("[FB Keyword Alert Options] Error closing groups:", error);
    showStatus(
      "❌ Error closing groups: " + (error.message || String(error)),
      "error"
    );
  }
}

async function refreshGroups() {
  showStatus("Refreshing group tabs...", "info");
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "refreshGroupTabs" },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });
    showStatus("✅ Group tabs refreshed", "success");
  } catch (error) {
    console.error("[FB Keyword Alert Options] Error refreshing groups:", error);
    showStatus(
      "❌ Error refreshing groups: " + (error.message || String(error)),
      "error"
    );
  }
}

async function updateTabCount() {
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "getGroupTabCount" },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(res);
          }
        }
      );
    });

    if (response && response.count !== undefined) {
      const count = response.count;
      const tabCountElement =
        document.getElementById("tabCount");
      if (count === 0) {
        tabCountElement.textContent = "No group tabs open";
      } else {
        tabCountElement.textContent = `${count} group tab${
          count === 1 ? "" : "s"
        } open`;
      }
    }
  } catch (error) {
    console.error("[FB Keyword Alert Options] Error getting tab count:", error);
  }
}

function getSettings() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "getSettings" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response || {});
        }
      }
    );
  });
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = "status " + type;

  setTimeout(() => {
    status.className = "status";
  }, 3000);
}
