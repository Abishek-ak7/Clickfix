const ALERT_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const DETECTION_HISTORY_LIMIT = 1000;
const alertedUrls = new Map();
let detectionHistory = [];

// Load saved history from storage
chrome.storage.local.get(['detectionHistory'], (result) => {
  if (result.detectionHistory) {
    detectionHistory = result.detectionHistory;
  }
});

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "checkClipboard",
    title: "Check for Clipboard Operations",
    contexts: ["all"]
  });
 
  chrome.contextMenus.create({
    id: "viewHistory",
    title: "View Detection History",
    contexts: ["all"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
if (info.menuItemId === "viewHistory") {
    showHistoryPage();
  }
});
const tabRedirectChains = new Map();

// Enhanced navigation tracking
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    console.log('Before navigate:', details.url, 'Tab:', details.tabId);
    
    if (!tabRedirectChains.has(details.tabId)) {
      tabRedirectChains.set(details.tabId, []);
    }
    
    const chain = tabRedirectChains.get(details.tabId);
    if (chain.length === 0 || chain[chain.length - 1] !== details.url) {
      chain.push(details.url);
      tabRedirectChains.set(details.tabId, chain);
      console.log('Updated chain for tab', details.tabId, ':', chain);
    }
  }
});

// Track committed navigations (final URLs)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    console.log('Navigation committed:', details.url, 'Tab:', details.tabId);
    
    const chain = tabRedirectChains.get(details.tabId) || [];
    const lastUrl = chain[chain.length - 1];
    
    if (lastUrl !== details.url) {
      chain.push(details.url);
      tabRedirectChains.set(details.tabId, chain);
      console.log('Final chain for tab', details.tabId, ':', chain);
    }
  }
});

async function captureAndSendScreenshot(retryCount = 0) {
  try {

const window = await chrome.windows.getCurrent({ populate: true });

    const tab = window.tabs.find(t =>
      t.active &&
      t.status === 'complete' &&
      t.url &&
      /^https?:\/\//.test(t.url)
    );

    if (!tab) {
      console.warn("No valid tab to capture.");
      return;
    }

    const imageUri = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const blob = await (await fetch(imageUri)).blob();

    const formData = new FormData();
    formData.append('file', blob, 'screenshot.png');
    formData.append('url', tab.url);

    const response = await fetch('http://20.106.187.204:8080/predict', {
      method: 'POST',
      body: formData
    });


    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const result = await response.json();
      console.log(result);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Screenshot Sent',
        message: `Backend says: ${result.message || 'Success'}`,
        priority: 1
      });
        chrome.tabs.sendMessage(tab.id,{
          type:'model_result',
          decision:result
        });
    } else {
      const text = await response.text();
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Screenshot Sent',
        message: 'Received non-JSON response from backend',
        priority: 1
      });
    }
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Screenshot Failed',
      message: error.message || 'Could not capture and send screenshot',
      priority: 1
    });
  }
}



// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'capture_screenshot') {
    captureAndSendScreenshot();
    chrome.tabs.captureVisibleTab(null,{format:'png'},function(dataUri){
      sendResponse({imageUri:dataUri})
    });
    return true;
  }
if (request.type === 'get_navigation_chain') {
    const tabId = sender.tab?.id;
    const chain = tabRedirectChains.get(tabId) || [];
    
    // If no chain exists, use the current tab URL
    if (chain.length === 0 && sender.tab?.url) {
      chain.push(sender.tab.url);
      tabRedirectChains.set(tabId, chain);
    }
    
    const response = {
      sourceUrl: chain.length > 0 ? chain[0] : sender.tab?.url || '',
      destinationUrl: chain.length > 0 ? chain[chain.length - 1] : sender.tab?.url || '',
      fullChain: chain,
      tabId: tabId
    };
    
    console.log('Sending navigation chain response:', response);
    sendResponse(response);
    return true; // Keep message channel open
  }

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "readClipboard") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "readClipboard" });
        console.log("Forwarded readClipboard to content script");
      }
    });
  }

});




  if (request.type === 'clipboard_alert') {
    const url = new URL(request.url).hostname;
    const lastAlertTime = alertedUrls.get(url) || 0;
    const now = Date.now();

    if (now - lastAlertTime > ALERT_COOLDOWN) {
      alertedUrls.set(url, now);
      showNotification(request.message, request.url);
     
      // Add to history
      const detection = {
        type: 'Clipboard Operation',
        source: url,
        content: request.message,
        timestamp: new Date(request.timestamp).toISOString()
      };
      addToDetectionHistory(detection);
    }
    sendResponse({success: true});
  } else if (request.type === 'detection_history') {
    addToDetectionHistory(request.detection);
    sendResponse({success: true});
  } else if (request.type === 'get_history') {
    sendResponse({history: detectionHistory});
  } else if (request.type === 'check_results') {
    // Forward results to popup if it's listening
    sendResponse({success: true});
  }
 else if (request.type === 'clear_history') {
  detectionHistory = [];
  chrome.storage.local.set({ detectionHistory: [], historyCleared: true }, () => {
    sendResponse({ success: true });
  });
 


}
 return true;
});

// Show desktop notification
function showNotification(message, url) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Clipboard Guard Alert',
    message: `${message}\nURL: ${new URL(url).hostname}`,
    priority: 1
  });
}

function addToDetectionHistory(detection) {
  // Normalize detection for comparison
  const detectionKey = `${detection.type}|${detection.source}|${detection.content}|${detection.url || ''}`;

  // Check for duplicates
  const isDuplicate = detectionHistory.some(existing => {
    const existingKey = `${existing.type}|${existing.source}|${existing.content}|${existing.url || ''}`;
    return existingKey === detectionKey;
  });

  if (isDuplicate) {
    console.log('Duplicate detection skipped:', detection);
    return;
  }

  // Add to history
  detectionHistory.unshift(detection);

  // Trim to limit
  if (detectionHistory.length > DETECTION_HISTORY_LIMIT) {
    detectionHistory.pop();
  }

  // Save to storage
  chrome.storage.local.set({ detectionHistory }, () => {
    console.log('Detection history updated. Total entries:', detectionHistory.length);
  });
}



function showHistoryPage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('history.html')
  });
}

// Clear clipboard function
async function clearClipboard() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      try {
        navigator.clipboard.writeText('').catch(() => {});
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = '';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch (e) {
        console.log('Could not clear clipboard:', e);
      }
    }
  });
  
}