// popup.js
document.addEventListener("DOMContentLoaded", function () {
    loadSettings();
    loadScanStatus();

    document.getElementById("saveSettings").addEventListener("click", saveSettings);
    document.getElementById("scanNow").addEventListener("click", scanNow);
    document.getElementById("testWebhook").addEventListener("click", testWebhook);

    // Load settings when popup opens
    loadSettings();
});

function loadSettings() {
    chrome.storage.local.get(
        ["keywords", "webhookUrl", "scanInterval", "autoScroll", "maxScrollAttempts"],
        function (result) {
            document.getElementById("keywords").value = result.keywords ? result.keywords.join(", ") : "";
            document.getElementById("webhookUrl").value = result.webhookUrl || "";
            document.getElementById("scanInterval").value = result.scanInterval || 5;
            document.getElementById("autoScroll").checked = result.autoScroll || false;
            document.getElementById("maxScrollAttempts").value = result.maxScrollAttempts || 3;
            
            updateUI();
        }
    );
}

function loadScanStatus() {
    chrome.runtime.sendMessage({ action: 'getScanStatus' }, function(response) {
        if (response) {
            const statusElement = document.getElementById('scanStatus');
            if (response.autoScanEnabled) {
                let statusText = `🟢 Auto-scan active (${response.totalIntervals} tabs)`;
                if (response.isCurrentlyScanning) {
                    statusText += ' - Scanning now...';
                }
                statusElement.innerHTML = statusText;
                statusElement.className = 'status-active';
            } else {
                statusElement.innerHTML = '🟡 Auto-scan disabled';
                statusElement.className = 'status-inactive';
            }
        }
    });
}

function saveSettings() {
    const keywords = document
        .getElementById("keywords")
        .value.split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
    const webhookUrl = document.getElementById("webhookUrl").value.trim();
    const scanInterval = parseInt(document.getElementById("scanInterval").value) || 0;
    const autoScroll = document.getElementById("autoScroll").checked;
    const maxScrollAttempts = parseInt(document.getElementById("maxScrollAttempts").value) || 3;

    if (keywords.length === 0) {
        showStatus("Please enter at least one keyword", "error");
        return;
    }

    if (!webhookUrl) {
        showStatus("Please enter a webhook URL", "error");
        return;
    }

    if (!webhookUrl.includes("https://script.google.com/macros/")) {
        if (!confirm("This doesn't look like a Google Apps Script URL. Continue anyway?")) {
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
            maxScrollAttempts: maxScrollAttempts
        },
        function () {
            showStatus("Settings saved successfully!", "success");
            
            // Restart auto-scan with new settings
            chrome.tabs.query({url: "*://*.facebook.com/groups/*"}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.runtime.sendMessage({ 
                        action: 'restartAutoScan', 
                        tabId: tab.id 
                    });
                });
            });
            
            // Reload status after a delay
            setTimeout(loadScanStatus, 1000);
            updateUI();
        }
    );
}

function scanNow() {
    showStatus("Preparing to scan...", "info");

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) {
            showStatus("No active tab found", "error");
            return;
        }

        const currentTab = tabs[0];
        
        // Check if we're on a Facebook group page
        if (!currentTab.url || !currentTab.url.includes("facebook.com/groups/")) {
            showStatus("Please navigate to a Facebook group page first", "error");
            
            // Offer to open Facebook groups
            if (confirm("You need to be on a Facebook group page to scan. Would you like to open Facebook Groups now?")) {
                chrome.tabs.create({ url: "https://facebook.com/groups" });
            }
            return;
        }

        showStatus("Scanning current page...", "info");

        // Get current keywords
        const keywords = getKeywords();
        if (keywords.length === 0) {
            showStatus("No keywords configured. Please save settings first.", "error");
            return;
        }

        // Send scan request
        chrome.tabs.sendMessage(
            currentTab.id,
            { 
                action: "scan", 
                keywords: keywords,
                autoScroll: document.getElementById("autoScroll").checked,
                maxScrollAttempts: parseInt(document.getElementById("maxScrollAttempts").value) || 3
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("Error: " + chrome.runtime.lastError.message, "error");
                    return;
                }

                if (response && response.matches) {
                    const matchCount = response.matches.length;
                    if (matchCount > 0) {
                        showStatus(`🎉 Found ${matchCount} matching posts! Check your Google Sheet.`, "success");
                        
                        // Show brief summary
                        const keywordSummary = {};
                        response.matches.forEach(match => {
                            keywordSummary[match.keyword] = (keywordSummary[match.keyword] || 0) + 1;
                        });
                        
                        const summary = Object.entries(keywordSummary)
                            .map(([keyword, count]) => `${keyword}: ${count}`)
                            .join(', ');
                            
                        setTimeout(() => {
                            showStatus(`Matches: ${summary}`, "info");
                        }, 3000);
                        
                    } else {
                        showStatus("No matches found for your keywords", "info");
                    }
                } else {
                    showStatus("Scan completed, but no response received", "error");
                }
            }
        );
    });
}

function testWebhook() {
    const webhookUrl = document.getElementById("webhookUrl").value.trim();
    if (!webhookUrl) {
        showStatus("Please enter a webhook URL first", "error");
        return;
    }

    showStatus("Sending test webhook request...", "info");

    chrome.runtime.sendMessage({ action: "testWebhook" }, (response) => {
        if (response) {
            if (response.success) {
                showStatus("✅ Webhook test successful! Check your Google Sheet for the test entry.", "success");
            } else {
                showStatus("❌ Webhook test failed: " + (response.error || "Unknown error"), "error");
                
                // Provide helpful suggestions based on common errors
                if (response.error.includes("404") || response.error.includes("Not Found")) {
                    setTimeout(() => {
                        showStatus("Tip: Make sure your Google Apps Script is deployed as a web app", "info");
                    }, 2000);
                } else if (response.error.includes("403")) {
                    setTimeout(() => {
                        showStatus("Tip: Make sure web app is deployed with 'Anyone' access", "info");
                    }, 2000);
                }
            }
        } else {
            showStatus("No response received from background script", "error");
        }
    });
}

function getKeywords() {
    const keywordsText = document.getElementById("keywords").value;
    return keywordsText.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
}

function showStatus(message, type) {
    const statusElement = document.getElementById("status");
    if (!statusElement) {
        console.log("Status:", message);
        return;
    }

    statusElement.textContent = message;
    statusElement.className = "status " + type;

    // Auto-hide success messages after 5 seconds
    if (type === "success") {
        setTimeout(() => {
            if (statusElement.textContent === message) {
                statusElement.textContent = "";
                statusElement.className = "status";
            }
        }, 5000);
    }
    
    // Auto-hide info messages after 8 seconds
    if (type === "info") {
        setTimeout(() => {
            if (statusElement.textContent === message) {
                statusElement.textContent = "";
                statusElement.className = "status";
            }
        }, 8000);
    }
}

function updateUI() {
    const keywords = getKeywords();
    const webhookUrl = document.getElementById("webhookUrl").value;
    const scanNowButton = document.getElementById("scanNow");
    const testWebhookButton = document.getElementById("testWebhook");
    
    // Enable/disable buttons based on configuration
    const hasKeywords = keywords.length > 0;
    const hasWebhook = webhookUrl.length > 0;
    
    scanNowButton.disabled = !hasKeywords || !hasWebhook;
    testWebhookButton.disabled = !hasWebhook;
    
    // Update button titles with helpful hints
    if (!hasKeywords) {
        scanNowButton.title = "Please configure keywords first";
        testWebhookButton.title = "Please configure webhook URL first";
    } else if (!hasWebhook) {
        scanNowButton.title = "Please configure webhook URL first";
        testWebhookButton.title = "Please configure webhook URL first";
    } else {
        scanNowButton.title = "Scan current Facebook group page";
        testWebhookButton.title = "Test connection to Google Sheets";
    }
    
    // Update placeholders with examples
    const keywordsInput = document.getElementById("keywords");
    const webhookInput = document.getElementById("webhookUrl");
    
    if (!keywordsInput.getAttribute('data-placeholder-set')) {
        keywordsInput.placeholder = "real estate, mortgage, housing market, for sale...";
        webhookInput.placeholder = "https://script.google.com/macros/s/.../exec";
        keywordsInput.setAttribute('data-placeholder-set', 'true');
    }
}

// Add real-time validation
document.getElementById("keywords").addEventListener("input", updateUI);
document.getElementById("webhookUrl").addEventListener("input", updateUI);
document.getElementById("autoScroll").addEventListener("change", updateUI);
document.getElementById("maxScrollAttempts").addEventListener("input", updateUI);
document.getElementById("scanInterval").addEventListener("input", updateUI);

// Add keyboard shortcuts
document.addEventListener("keydown", function (event) {
    // Ctrl+Enter or Cmd+Enter to save settings
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        saveSettings();
    }
    
    // Ctrl+Shift+S to scan now
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "S") {
        event.preventDefault();
        scanNow();
    }
});

// Update UI every 2 seconds to show current status
setInterval(loadScanStatus, 2000);

// Initial UI update
setTimeout(updateUI, 100);

// Export functions for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getKeywords,
        showStatus,
        updateUI
    };
}

console.log("Facebook Keyword Alert popup loaded successfully");
