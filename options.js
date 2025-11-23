// Options page script - WITH GROUP MANAGEMENT
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Options page loaded');
  await loadSettings();
  await updateTabCount();
  
  document.getElementById('save').addEventListener('click', saveSettings);
  document.getElementById('openGroups').addEventListener('click', openAllGroups);
  document.getElementById('closeGroups').addEventListener('click', closeGroupTabs);
  document.getElementById('refreshGroups').addEventListener('click', refreshGroups);
  
  // Update tab count every 5 seconds
  setInterval(updateTabCount, 5000);
});

async function loadSettings() {
  try {
    const settings = await getSettings();
    console.log('Loaded settings:', settings);
    
    document.getElementById('keywords').value = settings.keywords.join('\n');
    document.getElementById('groups').value = settings.groups?.join('\n') || '';
    document.getElementById('googleSheetsUrl').value = settings.googleSheetsUrl || '';
    document.getElementById('notificationsEnabled').checked = settings.notificationsEnabled !== false;
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('❌ Error loading settings', 'error');
  }
}

async function saveSettings() {
  const keywords = document.getElementById('keywords').value
    .split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0);
  
  const groups = document.getElementById('groups').value
    .split('\n')
    .map(g => g.trim())
    .filter(g => g.length > 0);
  
  const settings = {
    keywords: keywords,
    groups: groups,
    googleSheetsUrl: document.getElementById('googleSheetsUrl').value.trim(),
    notificationsEnabled: document.getElementById('notificationsEnabled').checked
  };
  
  console.log('Saving settings:', settings);
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'saveSettings', 
      settings: settings 
    });
    
    if (response && response.success) {
      showStatus('✅ Settings saved successfully!', 'success');
    } else {
      showStatus('❌ Failed to save settings', 'error');
    }
  } catch (error) {
    console.error('Save error:', error);
    showStatus('❌ Error saving settings: ' + error.message, 'error');
  }
}

async function openAllGroups() {
  const settings = await getSettings();
  const groups = settings.groups || [];
  
  if (groups.length === 0) {
    showStatus('❌ No groups configured. Please save your groups first.', 'error');
    return;
  }
  
  showStatus('🚀 Opening group tabs...', 'success');
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'openGroupTabs',
      groups: groups
    });
    
    if (response && response.success) {
      showStatus(`✅ Opening ${groups.length} group tabs...`, 'success');
      setTimeout(updateTabCount, 2000); // Update count after tabs open
    }
  } catch (error) {
    console.error('Error opening groups:', error);
    showStatus('❌ Error opening groups: ' + error.message, 'error');
  }
}

async function closeGroupTabs() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'closeGroupTabs'
    });
    
    if (response && response.success) {
      showStatus('✅ Closed all group tabs', 'success');
      updateTabCount();
    }
  } catch (error) {
    console.error('Error closing groups:', error);
    showStatus('❌ Error closing groups: ' + error.message, 'error');
  }
}

async function refreshGroups() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'refreshGroupTabs'
    });
    
    if (response && response.success) {
      showStatus('✅ Refreshed group tabs', 'success');
    }
  } catch (error) {
    console.error('Error refreshing groups:', error);
    showStatus('❌ Error refreshing groups: ' + error.message, 'error');
  }
}

async function updateTabCount() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getGroupTabCount'
    });
    
    if (response && response.count !== undefined) {
      const count = response.count;
      const tabCountElement = document.getElementById('tabCount');
      if (count === 0) {
        tabCountElement.textContent = 'No group tabs open';
      } else {
        tabCountElement.textContent = `${count} group tab${count === 1 ? '' : 's'} open`;
      }
    }
  } catch (error) {
    console.error('Error getting tab count:', error);
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

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = 'status ' + type;
  
  setTimeout(() => {
    status.className = 'status';
  }, 3000);
}