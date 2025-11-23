// Popup script - DEBUG VERSION
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔧 DEBUG: Popup loaded');
  
  // Add debug info to the popup
  const debugInfo = document.createElement('div');
  debugInfo.id = 'debugInfo';
  debugInfo.style.cssText = 'font-size: 10px; color: #666; background: #f8f9fa; padding: 8px; border-radius: 4px; margin-top: 10px; font-family: monospace;';
  document.body.appendChild(debugInfo);
  
  await updateDebugInfo('Popup loaded');
  await checkNotificationPermission();
  await updatePopup();
  
  document.getElementById('openOptions').addEventListener('click', () => {
    updateDebugInfo('Opening options page...');
    chrome.runtime.openOptionsPage();
  });
  
  document.getElementById('testNotification').addEventListener('click', async () => {
    updateDebugInfo('Test notification button clicked');
    await testNotification();
  });
  
  document.getElementById('enableNotifications').addEventListener('click', async () => {
    updateDebugInfo('Enable notifications button clicked');
    await requestNotificationPermission();
  });
});

// Debug logging function
async function updateDebugInfo(message) {
  const debugInfo = document.getElementById('debugInfo');
  if (debugInfo) {
    debugInfo.textContent = `DEBUG: ${message} (${new Date().toLocaleTimeString()})`;
  }
  console.log(`🔧 ${message}`);
}

// Check if we have notification permission
async function checkNotificationPermission() {
  return new Promise((resolve) => {
    updateDebugInfo('Checking notification permission...');
    
    // Method 1: Try the modern way first
    if (chrome.notifications.getPermissionLevel) {
      chrome.notifications.getPermissionLevel((level) => {
        updateDebugInfo(`Notification permission level: ${level}`);
        
        const notificationStatus = document.getElementById('notificationStatus');
        const notificationSuccess = document.getElementById('notificationSuccess');
        const enableButton = document.getElementById('enableNotifications');
        const testButton = document.getElementById('testNotification');
        
        if (level === 'granted') {
          // Notifications are enabled
          notificationStatus.classList.add('hidden');
          notificationSuccess.classList.remove('hidden');
          enableButton.classList.add('hidden');
          testButton.disabled = false;
          updateDebugInfo('Notifications are GRANTED - test button enabled');
        } else {
          // Notifications are not enabled
          notificationStatus.classList.remove('hidden');
          notificationSuccess.classList.add('hidden');
          enableButton.classList.remove('hidden');
          testButton.disabled = true;
          updateDebugInfo(`Notifications are ${level.toUpperCase()} - test button disabled`);
        }
        
        resolve(level === 'granted');
      });
    } else {
      // Method 2: Fallback - try to create a notification to test
      updateDebugInfo('Using fallback permission check');
      testNotificationFallback().then(resolve);
    }
  });
}

// Fallback permission check by attempting to create a notification
async function testNotificationFallback() {
  try {
    const testId = 'permission-test-' + Date.now();
    await chrome.notifications.create(testId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'Permission Test',
      message: 'Testing notification permissions...',
      priority: 0
    });
    
    // If we get here, permissions are granted
    chrome.notifications.clear(testId);
    updateDebugInfo('Fallback check: Notifications WORK');
    return true;
  } catch (error) {
    updateDebugInfo(`Fallback check failed: ${error.message}`);
    return false;
  }
}

// Request notification permission from user
async function requestNotificationPermission() {
  try {
    updateDebugInfo('Attempting to request notification permission...');
    
    // Method 1: Try creating a notification (this should trigger the prompt)
    const permissionTestId = 'permission-request-' + Date.now();
    await chrome.notifications.create(permissionTestId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'Facebook Keyword Alert - Permission Needed',
      message: 'Please allow notifications to receive keyword alerts.',
      priority: 2
    });
    
    updateDebugInfo('Permission request notification created');
    
    // Clear it immediately so it doesn't bother the user
    setTimeout(() => {
      chrome.notifications.clear(permissionTestId);
    }, 100);
    
  } catch (error) {
    updateDebugInfo(`Method 1 failed: ${error.message}`);
    
    // Method 2: Try the permissions API (older method)
    try {
      updateDebugInfo('Trying permissions API...');
      chrome.permissions.request({
        permissions: ['notifications']
      }, (granted) => {
        updateDebugInfo(`Permissions API result: ${granted ? 'GRANTED' : 'DENIED'}`);
        checkNotificationPermission();
      });
    } catch (fallbackError) {
      updateDebugInfo(`Method 2 failed: ${fallbackError.message}`);
    }
  }
  
  // Check permission again after a delay
  setTimeout(async () => {
    await checkNotificationPermission();
  }, 2000);
}

async function updatePopup() {
  try {
    updateDebugInfo('Updating popup status...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    updateDebugInfo(`Current tab: ${tab.url}`);
    
    // Update active tab info
    if (tab.url && tab.url.includes('facebook.com/groups/')) {
      document.getElementById('status').classList.add('active');
      document.getElementById('status').textContent = '✅ Monitoring this group';
      document.getElementById('activeTab').textContent = 'Current Group';
    } else if (tab.url && tab.url.includes('facebook.com')) {
      document.getElementById('status').textContent = 'ℹ️ Navigate to a group to monitor';
      document.getElementById('activeTab').textContent = 'Facebook';
    } else {
      document.getElementById('status').textContent = '⚠️ Not on Facebook';
      document.getElementById('activeTab').textContent = 'Other Site';
    }
    
    // Try to get settings
    try {
      const settings = await getSettings();
      document.getElementById('keywordCount').textContent = settings.keywords?.length || 0;
      updateDebugInfo(`Loaded ${settings.keywords?.length || 0} keywords`);
    } catch (error) {
      updateDebugInfo(`Error getting settings: ${error.message}`);
      document.getElementById('keywordCount').textContent = '?';
    }
    
    // Get group tab count
    try {
      const tabCount = await getGroupTabCount();
      document.getElementById('groupTabCount').textContent = tabCount;
      updateDebugInfo(`Found ${tabCount} group tabs`);
    } catch (error) {
      updateDebugInfo(`Error getting tab count: ${error.message}`);
      document.getElementById('groupTabCount').textContent = '?';
    }
    
  } catch (error) {
    updateDebugInfo(`Error in updatePopup: ${error.message}`);
    document.getElementById('status').textContent = '❌ Error loading popup';
  }
}

async function testNotification() {
  try {
    updateDebugInfo('Starting test notification...');
    
    // Check permission first
    const hasPermission = await checkNotificationPermission();
    if (!hasPermission) {
      updateDebugInfo('No permission - showing alert');
      alert('Please enable notifications first by clicking the "Enable Notifications" button.');
      return;
    }
    
    updateDebugInfo('Permission granted - creating test notification');
    
    // Create a unique notification ID
    const notificationId = 'test-notification-' + Date.now();
    
    // Create the notification directly
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'Facebook Keyword Alert - Test',
      message: 'This is a test notification! If you see this, notifications are working correctly.',
      contextMessage: 'Extension Test - Click to open settings',
      priority: 1
    });
    
    updateDebugInfo('Test notification created successfully');
    
    // Set up one-time click handler
    const handleTestNotificationClick = (clickedNotificationId) => {
      if (clickedNotificationId === notificationId) {
        updateDebugInfo('Test notification clicked - opening options');
        chrome.runtime.openOptionsPage();
        chrome.notifications.onClicked.removeListener(handleTestNotificationClick);
      }
    };
    
    chrome.notifications.onClicked.addListener(handleTestNotificationClick);
    
    // Clear after 5 seconds
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
      updateDebugInfo('Test notification cleared');
    }, 5000);
    
  } catch (error) {
    updateDebugInfo(`Test notification ERROR: ${error.message}`);
    alert(`Notification test failed: ${error.message}\n\nCheck Chrome notification settings.`);
  }
}

async function getSettings() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

async function getGroupTabCount() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'getGroupTabCount' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response.count || 0);
      }
    });
  });
}