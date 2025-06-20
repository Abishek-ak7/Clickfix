// Content Script - Complete Security Monitoring Solution
(function() {
  // ========== CONFIGURATION ========== //
  const COOLDOWN_TIME = 60 * 1000; // 1 minute cooldown for alerts
  const MAX_DEOBFUSCATIONS = 20; // Max stored deobfuscations
  const MIN_SCRIPT_LENGTH = 100; // Minimum script length to process
  const PARTIAL_CONTENT_LENGTH = 500; // Length of content snippets to store

  // ========== STATE MANAGEMENT ========== //
  const alertTimestamps = new Map();
  const detectionHistory = [];
  const processedElements = new WeakSet();
  const deobfuscationQueue = new Set();
  const processedScriptHashes = new Set();

  let lastUserCopyTime = 0;

document.addEventListener('copy', (e) => {
  if (e.isTrusted) {
    lastUserCopyTime = Date.now();
  }
});


const maliciousPatterns = [
  {
    pattern: /powershell(\.exe)?\s+/i,
    description: "General PowerShell command execution attempt"
  },
  {
    pattern: /powershell(\.exe)?\s*-[Ee]ncode[d]?[Cc]ommand/i,
    description: "Encoded PowerShell command execution attempt"
  },
  {
    pattern: /cmd\s*\/c\s*start\s*\/min\s*powershell/i,
    description: "Silent PowerShell launch attempt"
  },
  {
    pattern: /\.(ps1|vbs|js)\s*['\"][^'\"]*?(?:\$[a-zA-Z_][a-zA-Z0-9_]*|%[a-zA-Z][a-zA-Z0-9_]*%)[^'\"]*?['\"]/i,
    description: "Suspicious script file with variable injection"
  },
  {
    pattern: /(setClipboardCopyData|navigator\.writetext|clipboard.*copy)/i,
    description: "Clipboard manipulation attempt"
  },
  {
    pattern: /(?:win(?:dows)?\s*(?:icon|key)?\s*\+\s*r|keyCode\s*[:=]\s*(?:82|91)(?:\s|$|[,;\)]))/i,
    description: "Windows key shortcut simulation"
  },
  {
    pattern: /WScript\.Shell|document\.execCommand\s*\(\s*['\"]copy['\"]/i,
    description: "System command execution attempt"
  },
  {
    id: 'hex_or_obfuscated_var',
    pattern: /(?:\\x[0-9a-fA-F]{2}){10,}|var _0x[a-f0-9]{4,6}[^a-zA-Z0-9]/i,
    description: "Hexadecimal escape sequences or obfuscated variable names"
  },
  {
  pattern: /powershell(\.exe)?\s+-windowstyle\s+hidden\s+-command\s+["']?\$[a-z]+\s*=\s*['"]?https?:\/\/[^;]+;?\s*\$[a-z]+\s*=\s*iwr\s+\$[a-z]+;?\s*iex\s+\$[a-z]+/i,
  description: "Obfuscated PowerShell download and execute"
},
{
  pattern: /iex\s+\$[a-z]+/i,
  description: "Invoke-Expression on downloaded content"
},
{
  pattern: /iwr\s+https?:\/\/[^\\s]+/i,
  description: "Invoke-WebRequest to external domain"
}
,
];



let lastClipboardContent = '';

async function monitorClipboard() {
  try {
    const text = await navigator.clipboard.readText();

    // Skip if same as last checked
    if (text === lastClipboardContent) return;
    lastClipboardContent = text;

    // Normalize clipboard content
    const normalized = text.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').trim();

    // Skip if user just copied something (within 1 second)
    const recentUserCopy = Date.now() - lastUserCopyTime < 1000;
    if (recentUserCopy) {
      console.debug('[Clipboard Monitor] Skipped due to user-initiated copy:', normalized);
      return;
    }

    // Skip if the active element is an input or textarea
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      console.debug('[Clipboard Monitor] Skipped due to active input element:', active.tagName);
      return;
    }

    // Check clipboard content using existing script detection logic
    console.debug('[Clipboard Monitor] Read:', normalized);
    checkScriptContent(normalized, 'clipboard');

  } catch (e) {
    console.debug('[Clipboard Monitor] Clipboard read failed:', e);
  }
}



setInterval(monitorClipboard, 2000);




function tryBase64DecodeAndAnalyze(content, source) {
  const base64Pattern = /atob\s*\(\s*[A-Za-z0-9+/=]{20,}['"`]\s*\)/gi;
  let match;
  while ((match = base64Pattern.exec(content)) !== null) {
    try {
      const decoded = atob(match[1]);
      analyzeContent(decoded, source);
    } catch (e) {
      console.warn('Base64 decode failed:', e);
    }
  }
}

  const originalAPIs = {
    execCommand: document.execCommand,
    writeText: navigator.clipboard?.writeText,
    setTimeout: window.setTimeout,
    setInterval: window.setInterval,
    fetch: window.fetch,
    xhrOpen: XMLHttpRequest.prototype.open
  };

  /**
   * Processes potentially obfuscated scripts
   * @param {HTMLElement} scriptElement - The script element to process
   */
  function processScriptElement(scriptElement) {


    try {
      if (!scriptElement || processedElements.has(scriptElement)) return;

      const scriptContent = scriptElement.textContent || '';
      if (scriptContent.length < MIN_SCRIPT_LENGTH) return;

      // Create content fingerprint
      const contentHash = hashString(scriptContent.substring(0, 1000));
      if (processedScriptHashes.has(contentHash)) return;
      processedScriptHashes.add(contentHash);

      // Check for obfuscation indicators
      const isObfuscated = checkForObfuscation(scriptContent);
      if (!isObfuscated) return;

      // Prepare complete script context
      const scriptContext = {
        content: scriptContent,
        attributes: getElementAttributes(scriptElement),
        outerHTML: scriptElement.outerHTML.substring(0, 500),
        url: window.location.href,
        timestamp: new Date().toISOString()
      };

      // Send for deobfuscation
      sendToDeobfuscationService(scriptContext)
        .then(result => handleDeobfuscationResult(scriptContext, result))
        .catch(err => console.debug('Deobfuscation failed:', err));

      processedElements.add(scriptElement);
    } catch (e) {
      console.debug('Script processing error:', e);
    }
  }

  /**
   * Checks if content contains obfuscation patterns
   * @param {string} content - The content to check
   * @returns {boolean} True if obfuscation is detected
   */
function checkForObfuscation(content) {
  const hexPattern = /\\x[0-9a-fA-F]{2}/g;
  const undefinedVarPattern = /\b[a-zA-Z_]\w*\s*\[.*?\]\s*=/g;

  return hexPattern.test(content) || undefinedVarPattern.test(content);
}


  /**
   * Collects all element attributes
   * @param {HTMLElement} element - The element to process
   * @returns {Object} Key-value pairs of attributes
   */
  function getElementAttributes(element) {
    return Array.from(element.attributes).reduce((obj, attr) => {
      obj[attr.name] = attr.value;
      return obj;
    }, {});
  }

  /**
   * Sends script to deobfuscation service
   * @param {Object} scriptContext - The script context object
   * @returns {Promise} Promise with deobfuscation result
   */
async function sendToDeobfuscationService(scriptContext) {
  if (!scriptContext?.content || scriptContext.content.trim().length === 0) {
    console.warn('Skipped sending empty script content to backend');
    return;
  }
  addToDetectionHistory(scriptContext);

  if (deobfuscationQueue.has(scriptContext.url)) return;
  deobfuscationQueue.add(scriptContext.url);

  try {
    const response = await fetch('http://localhost:3000/deobfuscate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: scriptContext.content }),
      
      
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
   
  } finally {
    deobfuscationQueue.delete(scriptContext.url);
  }
   
}


  /**
   * Handles deobfuscation results
   * @param {Object} original - Original script context
   * @param {Object} result - Deobfuscation result
   */
function handleDeobfuscationResult(original, result) {
  if (!result?.success) return;

  // Store complete results
  storeDeobfuscationResult(original, result);

  // Create detection record
  const detection = {
    type: 'Deobfuscated Script',
    severity: 'high',
    source: original,
    content: result.deobfuscated,
    mappings: result.mappings,
    timestamp: new Date().toISOString(),
    analysis: result.analysis || 'Deobfuscation completed'
  };

  addToDetectionHistory(detection);

  // Analyze deobfuscated content for known patterns
  analyzeContent(result.deobfuscated, original.url);

  // Alert if needed
  if (canAlert(`deob-${hashString(original.content)}`)) {
    showSecurityAlert(
      `Deobfuscation result: ${result.analysis || 'Suspicious content found'}`,
      original.url
    );
  }
}


const safePatterns = [
  /gtag\(['"]config['"],\s*['"]G-[A-Z0-9]+['"]\)/, // Google Analytics
  /window\.translations\s*=\s*\{[^}]+\}/,          // Translation blocks
  /\\u[0-9a-fA-F]{4}/g                              // Unicode escapes
];

function isWhitelisted(content) {
  return safePatterns.some(pattern => pattern.test(content));
}


  /**
   * Stores deobfuscation results
   * @param {Object} original - Original script
   * @param {Object} result - Deobfuscation result
   */
function storeDeobfuscationResult(original, result) {
  chrome.storage.local.get({ deobfuscatedScripts: [] }, (data) => {
    const updated = [...data.deobfuscatedScripts, {
      original,
      result,
      timestamp: new Date().toISOString()
    }].slice(-MAX_DEOBFUSCATIONS);

    chrome.storage.local.set({ deobfuscatedScripts: updated }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save deobfuscation history:', chrome.runtime.lastError);
      } else {
        console.log('Deobfuscation history updated:', updated);
      }
    });
  });
}

  /**
   * Analyzes deobfuscated content
   * @param {string} content - Content to analyze
   * @param {string} source - Source URL
   */
  function analyzeContent(content, source) {
    maliciousPatterns.forEach(({ pattern, description }) => {
      const matches = content.match(pattern);
      if (matches) {
        addToDetectionHistory({
          type: 'Pattern Match',
         
          source: source,
          content: matches,
          description: description,
          timestamp: new Date().toISOString()
        });
      }
    });
  }



  /**
   * Generates content hash
   * @param {string} str - Input string
   * @returns {string} Hash string
   */
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

  /**
   * Checks if alert can be shown
   * @param {string} key - Alert key
   * @returns {boolean} True if alert can be shown
   */
  function canAlert(key = 'default') {
    const now = Date.now();
    const last = alertTimestamps.get(key) || 0;
    if (now - last < COOLDOWN_TIME) return false;
    alertTimestamps.set(key, now);
    return true;
  }

  
  /**
   * Adds detection to history
   * @param {Object} detection - Detection object
   */
  function addToDetectionHistory(detection) {
    detectionHistory.push(detection);
    if (detectionHistory.length > 50) {
      detectionHistory.shift();
    }
    
    // Send to background script for storage
    chrome.runtime?.sendMessage?.({
      type: 'detection_history',
      detection
    });
  }


  /**
   * Shows security alert
   * @param {string} message - Alert message
   * @param {string} source - Alert source
   */
  function showSecurityAlert(message, source) {
    // Send to background
    chrome.runtime.sendMessage({
      type: 'alert',
      message: message,
      source: source
    });

    // Show in-page notification
    const alertDiv = document.createElement('div');
    alertDiv.className = 'security-alert-notification';
    alertDiv.innerHTML = `
      <div class="alert-header">
        <span class="alert-icon">⚠️</span>
        <span class="alert-title">Security Alert</span>
      </div>
      <div class="alert-body">${message}</div>
      <div class="alert-footer">
        <span class="alert-source">Source: ${window.location.href}</span>
        <span class="alert-time">${new Date().toLocaleTimeString()}</span>
      </div>
    `;
    
    Object.assign(alertDiv.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      width: '350px',
      padding: '12px',
      backgroundColor: '#ff4444',
      color: 'white',
      borderRadius: '4px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      zIndex: '999999',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px'
    });

    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 10000);
  }




  // MutationObserver for dynamic content
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
    if (node.nodeName === 'SCRIPT') {
  const scriptCode = node.textContent?.trim();
  if (scriptCode) {
    checkScriptContent(scriptCode, node.src || 'inline');
  }
}

      });
    });
  });

  // Start observing document
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });


  document.querySelectorAll('script').forEach(processScriptElement);

  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    return originalAPIs.fetch.apply(this, arguments)
      .then(response => {
        if (url?.match(/\.(js|vbs|ps1|bat|cmd)$/i)) {
          response.clone().text()
            .then(text => checkScriptContent(text, url))
            .catch(() => {});
        }
        return response;
      })
      .catch(err => {
        console.debug('Fetch monitoring error:', err);
        throw err;
      });
  };

  // Monitor XHR requests
  XMLHttpRequest.prototype.open = function(method, url) {
    if (url?.match(/\.(js|vbs|ps1|bat|cmd)$/i)) {
      const originalOnReadyStateChange = this.onreadystatechange;
      this.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
          checkScriptContent(this.responseText, url);
        }
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(this, arguments);
        }
      };
    }
    return originalAPIs.xhrOpen.apply(this, arguments);
  };

  // Monitor setTimeout/setInterval
  window.setTimeout = function(callback, delay) {
    if (typeof callback === 'string' || 
        (typeof callback === 'function' && 
         callback.toString().includes('clipboard') && 
         !isUserInitiated())) {
      const detection = {
        type: 'setTimeout',
        severity: 'medium',
        source: 'Inline script',
        content: callback.toString().substring(0, PARTIAL_CONTENT_LENGTH),
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      if (canAlert('setTimeout')) {
        showSecurityAlert('Suspicious setTimeout with clipboard operation', window.location.href);
      }
    }
    return originalAPIs.setTimeout.apply(this, arguments);
  };

  window.setInterval = function(callback, delay) {
    if (typeof callback === 'string' || 
        (typeof callback === 'function' && 
         callback.toString().includes('clipboard') && 
         !isUserInitiated())) {
      const detection = {
        type: 'setInterval',
        severity: 'medium',
        source: 'Inline script',
        content: callback.toString().substring(0, PARTIAL_CONTENT_LENGTH),
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      if (canAlert('setInterval')) {
        showSecurityAlert('Suspicious setInterval with clipboard operation', window.location.href);
      }
    }
    return originalAPIs.setInterval.apply(this, arguments);
  };

  // Monitor clipboard APIs
  document.execCommand = function(command, showUI, value) {
    if (command.toLowerCase() === 'copy' && !isUserInitiated() && canAlert('execCommand')) {
      const detection = {
        type: 'execCommand',
        severity: 'high',
        source: 'Inline script',
        content: `Attempt to copy: ${value?.substring(0, 100) || 'unknown content'}`,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      showSecurityAlert('execCommand copy detected without user interaction', window.location.href);
      clearClipboard();
    }
    return originalAPIs.execCommand.apply(this, arguments);
  };

  if (navigator.clipboard && originalAPIs.writeText) {
    navigator.clipboard.writeText = function(text) {
      if (!isUserInitiated() && canAlert('clipboard.writeText')) {
        const detection = {
          type: 'clipboard.writeText',
          severity: 'high',
          source: 'Inline script',
          content: `Attempt to copy: ${text?.substring(0, 100) || 'unknown content'}`,
          url: window.location.href,
          timestamp: new Date().toISOString()
        };
        addToDetectionHistory(detection);
        showSecurityAlert('clipboard.writeText detected without user interaction', window.location.href);
        clearClipboard();
        return Promise.reject('Blocked by security extension');
      }
      
      const maliciousMatch = maliciousPatterns.find(({ pattern }) => pattern.test(text));
      if (text && maliciousMatch) {
        const detection = {
          type: 'Malicious Clipboard Content',
          severity: 'critical',
          source: 'Inline script',
          content: `Attempt to copy: ${text.match(maliciousMatch.pattern)?.[0,100] || 'Pattern matched'}`,
          url: window.location.href,
          timestamp: new Date().toISOString()
        };
        addToDetectionHistory(detection);
        showSecurityAlert(`Malicious content detected in clipboard operation: ${maliciousMatch.description}`, window.location.href);
        clearClipboard();
        return Promise.reject('Blocked by security extension');
      }
      return originalAPIs.writeText.apply(this, arguments);
    };
  }

  function isUserInitiated() {
    try {
      const event = window.event;
      return event && event.isTrusted;
    } catch {
      return false;
    }
  }

  function clearClipboard() {
    try {
      if (navigator.clipboard && originalAPIs.writeText) {
        originalAPIs.writeText.call(navigator.clipboard, '')
          .catch(() => {});
      }
      document.execCommand('copy', false, '');
    } catch (e) {}
  }

function checkScriptContent(content, source) {
  if (!content || content.length < 20 || isWhitelisted(content)) return;

  const powershellCommandPattern = /powershell(?:\.exe)?\s*[-\/][Ee]ncode[d]?[Cc]ommand\s+([A-Za-z0-9+/=\\-]+)/i;
  const normalized = content.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').toLowerCase();
  let shouldDeobfuscate = false;

  const BACKEND_API_ENDPOINT = 'http://localhost:3000/report-detection';

  function reportDetectionToBackend(data) {
    fetch(BACKEND_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(err => {
      console.warn('Failed to report detection:', err);
    });
  }

  maliciousPatterns.forEach(({ id, pattern, description }) => {
    const matches = normalized.match(new RegExp(pattern, 'gi'));
    if (matches && canAlert(`pattern:${pattern.source}`)) {
      matches.forEach(() => {
        const detection = {
          type: 'Script Pattern Match',
          severity: 'medium',
          source: source || 'DOM',
          content,
          description,
          url: window.location.href,
          timestamp: new Date().toISOString()
        };

        addToDetectionHistory(detection);
        reportDetectionToBackend({
          type: detection.type,
          description: detection.description,
          content: detection.content,
          url: detection.url,
          timestamp: detection.timestamp
        });

        // 🔍 Decode PowerShell command if present
        if (description.toLowerCase().includes('powershell')) {
          const psMatch = content.match(powershellCommandPattern);
          if (psMatch && psMatch[1]) {
            try {
              const decoded = atob(psMatch[1].replace(/\\+/g, '+'));
              const decodedDetection = {
                type: 'Decoded PowerShell Command',
                severity: 'high',
                source: source || 'DOM',
                content: decoded,
                description: 'Decoded PowerShell command from encoded input',
                url: window.location.href,
                timestamp: new Date().toISOString()
              };
              addToDetectionHistory(decodedDetection);
              reportDetectionToBackend(decodedDetection);
              showSecurityAlert(`⚠️ PowerShell command detected:\n${decoded}`, source || window.location.href);
            } catch (e) {
              console.warn('Failed to decode PowerShell command:', e);
            }
          }
        }

        showSecurityAlert(`Suspicious pattern: ${description}`, source || window.location.href);
      });

      if (id === 'hex_or_obfuscated_var') {
        shouldDeobfuscate = true;
      }
    }
  });

  tryBase64DecodeAndAnalyze(content, source);

  if (shouldDeobfuscate) {
    const scriptContext = {
      content,
      url: source || window.location.href,
      timestamp: new Date().toISOString()
    };
    sendToDeobfuscationService(scriptContext)
      .then(result => {
        if (result?.success) {
          handleDeobfuscationResult(scriptContext, result);
        }
      })
      .catch(() => {});
  }
}


})();