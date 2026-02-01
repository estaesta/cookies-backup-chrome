// Background service worker for auto-backup functionality

const ALARM_NAME = 'auto-backup';

// Initialize alarm when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  // Load saved settings and set up alarm
  chrome.storage.sync.get(['autoBackupEnabled', 'autoBackupInterval'], (result) => {
    if (result.autoBackupEnabled) {
      setupAlarm(result.autoBackupInterval || 'monthly');
    }
  });
});

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Auto-backup alarm triggered');
    performAutoBackup();
  }
});

// Set up the alarm based on user preference
function setupAlarm(interval) {
  // Clear any existing alarm first
  chrome.alarms.clear(ALARM_NAME, () => {
    let periodInMinutes;
    
    if (interval === 'biweekly') {
      // 2 weeks = 14 days = 14 * 24 * 60 minutes
      periodInMinutes = 14 * 24 * 60;
    } else {
      // Monthly = 30 days = 30 * 24 * 60 minutes
      periodInMinutes = 30 * 24 * 60;
    }
    
    // Create the alarm
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: periodInMinutes,
      periodInMinutes: periodInMinutes
    });
    
    console.log(`Alarm set for ${interval} with period ${periodInMinutes} minutes`);
  });
}

// Perform the auto-backup
async function performAutoBackup() {
  try {
    // Get auto-backup password from storage
    const result = await chrome.storage.sync.get(['autoBackupPassword']);
    
    // Validate password exists and is not empty
    if (!result.autoBackupPassword || result.autoBackupPassword.trim() === '') {
      console.error('No auto-backup password set');
      showNotification('Auto-backup failed', 'Please set a password in settings');
      return;
    }
    
    // Get all cookies
    chrome.cookies.getAll({}, async (cookies) => {
      if (cookies.length === 0) {
        console.log('No cookies to backup');
        showNotification('Auto-backup skipped', 'No cookies to backup');
        return;
      }
      
      try {
        // Import sjcl dynamically
        await importScripts('sjcl.js');
        
        // Validate and serialize cookies data
        let cookiesJson;
        try {
          cookiesJson = JSON.stringify(cookies);
        } catch (jsonError) {
          console.error('Failed to serialize cookies:', jsonError);
          showNotification('Auto-backup failed', 'Invalid cookies data');
          return;
        }
        
        // Encrypt the cookies with validation
        let encryptedData;
        try {
          encryptedData = sjcl.encrypt(result.autoBackupPassword.trim(), cookiesJson, { ks: 256 });
        } catch (encryptError) {
          console.error('Encryption failed:', encryptError);
          showNotification('Auto-backup failed', 'Encryption error: ' + (encryptError.message || 'Unknown error'));
          return;
        }
        
        // Create filename with timestamp
        const d = new Date();
        const date = d.toLocaleDateString("en-GB").replace(/\//g, "-");
        const time = d.toLocaleTimeString("en-GB").replace(/:/g, "-");
        const filename = `cookies-auto-backup-${date}-${time}.ckz`;
        
        // Download the backup file
        const blob = new Blob([encryptedData], { type: "application/ckz" });
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({ url: url, filename: filename }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('Download error:', chrome.runtime.lastError);
            showNotification('Auto-backup failed', 'Could not save backup file');
          } else {
            console.log(`Auto-backup completed: ${cookies.length} cookies backed up`);
            showNotification('Auto-backup completed', `Successfully backed up ${cookies.length} cookies`);
          }
        });
      } catch (error) {
        console.error('Auto-backup encryption error:', error);
        showNotification('Auto-backup failed', 'Unexpected error: ' + (error.message || 'Unknown'));
      }
    });
  } catch (error) {
    console.error('Auto-backup error:', error);
    showNotification('Auto-backup failed', 'An error occurred: ' + (error.message || 'Unknown'));
  }
}

// Show notification
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/48.png',
    title: title,
    message: message,
    priority: 2
  });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setupAlarm') {
    setupAlarm(request.interval);
    sendResponse({ success: true });
  } else if (request.action === 'clearAlarm') {
    chrome.alarms.clear(ALARM_NAME, (wasCleared) => {
      sendResponse({ success: wasCleared });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'getAlarmInfo') {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
      sendResponse({ alarm: alarm });
    });
    return true; // Keep channel open for async response
  }
});
