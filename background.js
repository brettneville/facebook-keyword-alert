// Background service worker - COMPLETE WITH GROUP MANAGEMENT
console.log('🔧 Facebook Keyword Alert background script loaded');

// Initialize storage with default settings if not exists
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed/updated');
  
  const result = await chrome.storage.local.get(['keywords', 'notificationsEnabled']);
  
  if (!result.keywords) {
    await chrome.storage.local.set({
      keywords: ['wilmington', 'leland', 'oak island', 'wrightsville', 'bolivia', 'supply', 'shallotte', 'hampstead', 'carolina beach', 'kure beach'],
      groups: [],
      notificationsEnabled: true,
      seenPosts: []
    });
    console.log('✅ Default settings initialized');
  }
});

// Set up periodic checking using alarms
chrome.alarms.create('periodicCheck', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicCheck') {
    triggerKeywordCheck();
  }
});

// Auto-open groups when Chrome starts (if groups are configured)
chrome.runtime.onStartup.addListener(async () => {
  console.log('Chrome started - checking for groups to auto-open');
  const settings = await getSettings();
  
  if (settings.groups && settings.groups.length > 0) {
    console.log(`Auto-opening ${settings.groups.length} groups on startup`);
    openGroupTabs(settings.groups);
  }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  switch (request.action) {
    case 'keywordMatchFound':
      handleKeywordMatch(request.data, sender.tab);
      sendResponse({ success: true });
      break;
      
    case 'getSettings':
      getSettings().then(settings => sendResponse(settings));
      return true; // Keep message channel open for async
      
    case 'saveSettings':
      saveSettings(request.settings).then(() => sendResponse({ success: true }));
      return true; // Keep message channel open for async
      
    case 'isPostSeen':
      isPostSeen(request.postId).then(isSeen => sendResponse(isSeen));
      return true; // Keep message channel open for async
      
    // GROUP MANAGEMENT ACTIONS:
    case 'openGroupTabs':
      openGroupTabs(request.groups).then(tabs => sendResponse({ success: true, opened: tabs.length }));
      return true;
      
    case 'closeGroupTabs':
      closeGroupTabs().then(result => sendResponse(result));
      return true;
      
    case 'refreshGroupTabs':
      refreshGroupTabs().then(result => sendResponse(result));
      return true;
      
    case 'getGroupTabCount':
      getGroupTabCount().then(result => sendResponse(result));
      return true;
      
    default:
      sendResponse({ error: 'Unknown action' });
  }
});

// GROUP MANAGEMENT FUNCTIONS

// Open group tabs automatically
async function openGroupTabs(groups) {
  console.log('🚀 Opening group tabs:', groups);
  
  const openedTabs = [];
  
  for (const group of groups) {
    try {
      const groupUrl = normalizeGroupUrl(group);
      console.log(`Opening tab for: ${groupUrl}`);
      
      // Check if this group is already open
      const existingTabs = await chrome.tabs.query({ url: `*://*.facebook.com/groups/${extractGroupId(group)}/*` });
      
      if (existingTabs.length === 0) {
        const tab = await chrome.tabs.create({
          url: groupUrl,
          active: false // Open in background
        });
        
        openedTabs.push(tab);
        console.log(`✅ Opened tab for group: ${group}`);
        
        // Wait a bit between opening tabs to be nice to Facebook
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log(`ℹ️ Group already open: ${group}`);
      }
      
    } catch (error) {
      console.error(`Error opening group ${group}:`, error);
    }
  }
  
  console.log(`✅ Opened ${openedTabs.length} new group tabs`);
  return openedTabs;
}

// Normalize group input to proper Facebook URL
function normalizeGroupUrl(groupInput) {
  groupInput = groupInput.trim();
  
  // If it's already a full URL, use it as-is
  if (groupInput.startsWith('https://facebook.com/groups/') || 
      groupInput.startsWith('https://www.facebook.com/groups/')) {
    return groupInput;
  }
  
  // If it's just an ID or slug, create the full URL
  return `https://facebook.com/groups/${groupInput}`;
}

// Extract group ID from various input formats
function extractGroupId(groupInput) {
  groupInput = groupInput.trim();
  
  // If it's a full URL, extract the group ID
  const urlMatch = groupInput.match(/facebook\.com\/groups\/([^\/?]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  // Otherwise, assume it's already the group ID
  return groupInput;
}

// Close all Facebook group tabs
async function closeGroupTabs() {
  try {
    const tabs = await chrome.tabs.query({ 
      url: 'https://*.facebook.com/groups/*' 
    });
    
    const tabIds = tabs.map(tab => tab.id);
    
    if (tabIds.length > 0) {
      await chrome.tabs.remove(tabIds);
      console.log(`🗑️ Closed ${tabIds.length} group tabs`);
    } else {
      console.log('No group tabs to close');
    }
    
    return { success: true, closed: tabIds.length };
  } catch (error) {
    console.error('Error closing group tabs:', error);
    return { success: false, error: error.message };
  }
}

// Refresh all group tabs
async function refreshGroupTabs() {
  try {
    const tabs = await chrome.tabs.query({ 
      url: 'https://*.facebook.com/groups/*' 
    });
    
    for (const tab of tabs) {
      try {
        await chrome.tabs.reload(tab.id);
        console.log(`🔄 Refreshed tab: ${tab.url}`);
        
        // Wait a bit between refreshes to be nice to Facebook
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error refreshing tab ${tab.id}:`, error);
      }
    }
    
    return { success: true, refreshed: tabs.length };
  } catch (error) {
    console.error('Error refreshing group tabs:', error);
    return { success: false, error: error.message };
  }
}

// Get count of open group tabs
async function getGroupTabCount() {
  try {
    const tabs = await chrome.tabs.query({ 
      url: 'https://*.facebook.com/groups/*' 
    });
    
    return { count: tabs.length };
  } catch (error) {
    console.error('Error getting tab count:', error);
    return { count: 0 };
  }
}

// CORE FUNCTIONALITY

// Trigger keyword check across all Facebook group tabs
async function triggerKeywordCheck() {
  console.log('🔄 Periodic keyword check triggered');
  
  try {
    const tabs = await chrome.tabs.query({ 
      url: 'https://*.facebook.com/groups/*' 
    });
    
    console.log(`Found ${tabs.length} Facebook group tabs to check`);
    
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'checkForKeywords' });
      } catch (error) {
        console.log(`Could not send message to tab ${tab.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in periodic check:', error);
  }
}

// Handle keyword matches
async function handleKeywordMatch(matchData, tab) {
  console.log('🎯 Keyword match found:', matchData.keyword);
  
  // Save to seen posts
  await saveSeenPost(matchData.postId);
  
  // Send to Google Sheets
  await sendToGoogleSheets([matchData]);
  
  // Show notification
  await showNotification(matchData);
}

// Get settings from storage
async function getSettings() {
  const result = await chrome.storage.local.get([
    'keywords',
    'groups',
    'googleSheetsUrl',
    'notificationsEnabled'
  ]);
  
  return {
    keywords: result.keywords || ['wilmington', 'leland', 'oak island'],
    groups: result.groups || [],
    googleSheetsUrl: result.googleSheetsUrl || '',
    notificationsEnabled: result.notificationsEnabled !== false
  };
}

// Save settings to storage
async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
  console.log('💾 Settings saved:', settings);
}

// Save seen post to prevent duplicates
async function saveSeenPost(postId) {
  const result = await chrome.storage.local.get(['seenPosts']);
  const seenPosts = result.seenPosts || [];
  
  if (!seenPosts.includes(postId)) {
    seenPosts.push(postId);
    // Keep only last 1000 posts to prevent storage bloat
    if (seenPosts.length > 1000) {
      seenPosts.splice(0, seenPosts.length - 1000);
    }
    await chrome.storage.local.set({ seenPosts });
  }
}

// Check if post has been seen
async function isPostSeen(postId) {
  const result = await chrome.storage.local.get(['seenPosts']);
  const seenPosts = result.seenPosts || [];
  return seenPosts.includes(postId);
}

// Send matches to Google Sheets
async function sendToGoogleSheets(matches) {
  const settings = await getSettings();
  
  if (!settings.googleSheetsUrl) {
    console.log('⚠️ No Google Sheets URL configured');
    return;
  }

  try {
    const response = await fetch(settings.googleSheetsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        matches: matches,
        timestamp: new Date().toISOString(),
        source: 'chrome_extension'
      })
    });
    
    if (response.ok) {
      console.log('✅ Data sent to Google Sheets');
    } else {
      console.error('❌ Failed to send to Google Sheets:', response.status);
    }
  } catch (error) {
    console.error('❌ Error sending to Google Sheets:', error);
  }
}

// Show desktop notification
async function showNotification(matchData) {
  const settings = await getSettings();
  
  if (!settings.notificationsEnabled) return;

  try {
    const notificationId = `keyword-alert-${Date.now()}`;
    
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Facebook Keyword Alert!',
      message: `Found "${matchData.keyword}" in ${matchData.group}`,
      contextMessage: 'Click to view post',
      priority: 2
    });

    console.log('🔔 Notification shown');
    
    // Handle notification click - create a one-time listener
    const handleNotificationClick = (clickedNotificationId) => {
      if (clickedNotificationId === notificationId) {
        chrome.tabs.create({ url: matchData.groupUrl });
        chrome.notifications.onClicked.removeListener(handleNotificationClick);
      }
    };
    
    chrome.notifications.onClicked.addListener(handleNotificationClick);
    
  } catch (error) {
    console.error('❌ Error showing notification:', error);
  }
}

console.log('✅ Background script loaded successfully with group management');