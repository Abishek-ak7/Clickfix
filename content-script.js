(function() {
  const COOLDOWN_TIME = 10 * 1000; // 10 seconds
  const PARTIAL_CONTENT_LENGTH = 500; 
  const alertTimestamps = new Map();
  const detectionHistory = [];
  const deobfuscationQueue = new Set();


//Patterns to be used to match with the commands in the Source Code
const maliciousPatterns = [
  {
    type:'Powershell Command',
    pattern: /powershell(\.exe)?\s+.*(-enc|iwr|iex|hidden)/i,
    description: "General PowerShell command execution attempt"
  },
  {
    type:'Powershell Command',
    pattern: /powershell(\.exe)?\s*-[Ee]ncode[d]?[Cc]ommand/i,
    description: "Encoded PowerShell command execution attempt"
  },
  {
    type:'Silent Powershell Command',
    pattern: /cmd\s*\/c\s*start\s*\/min\s*powershell/i,
    description: "Silent PowerShell launch attempt"
  },
  {
    type:'Suspicious File ',
    pattern: /\.(ps1|vbs|js)\s*['\"][^'\"]*?(?:\$[a-zA-Z_][a-zA-Z0-9_]*|%[a-zA-Z][a-zA-Z0-9_]*%)[^'\"]*?['\"]/i,
    description: "Suspicious script file with variable injection"
  },
{
  type:"Remote File execution(MSHTA)",
  pattern: /mshta\s+(?!https?:\/\/(?:internal|intranet|corp|localhost))https?:\/\/[^\s]+/i,
  description: "MSHTA remote script execution to untrusted domain"
}
,
  {
    type:"HardCode Clipboard Function",
    pattern: /(setClipboardCopyData|navigator\.writetext|clipboard.*copy)/i,
    description: "Clipboard manipulation attempt"
  },
  {
    type:"Windows + R Command",
    pattern: /(?:win(?:dows)?\s*(?:icon|key)?\s*\+\s*r|keyCode\s*[:=]\s*(?:82|91)(?:\s|$|[,;\)]))/i,
    description: "Windows key shortcut simulation"
  },
  {
    type:"Script or shell Command",
    pattern: /WScript\.Shell|document\.execCommand\s*\(\s*['\"]copy['\"]/i,
    description: "System command execution attempt"
  },
  {
    type:"Hexadecimal_Code",
    pattern: /(?:\\x[0-9a-fA-F]{2}){10,}|var _0x[a-f0-9]{4,6}[^a-zA-Z0-9]/i,
    description: "Hexadecimal escape sequences or obfuscated variable names"
  },
  {
    type:"Obfuscated Powershell Command",
  pattern: /powershell(\.exe)?\s+-windowstyle\s+hidden\s+-command\s+["']?\$[a-z]+\s*=\s*['"]?https?:\/\/[^;]+;?\s*\$[a-z]+\s*=\s*iwr\s+\$[a-z]+;?\s*iex\s+\$[a-z]+/i,
  description: "Obfuscated PowerShell download and execute"
},
{
  type:'IEX Found',
  pattern: /iex\s+\$[a-z]+/i,
  description: "Invoke-Expression on downloaded content"
},
{
  type:"IWR Found",
  pattern: /iwr\s+https?:\/\/[^\\s]+/i,
  description: "Invoke-WebRequest to external domain"
}
,
];
const homoglyphMap = {
  'а': 'a', // Cyrillic a
  'е': 'e', // Cyrillic e
  'і': 'i', // Cyrillic i
  'ο': 'o', // Greek omicron
  'р': 'p', // Cyrillic p
  'ѕ': 's', // Cyrillic s
  'ѵ': 'v', // Cyrillic v
  'ꞵ': 'b', // Latin beta
  'ʟ': 'l', // Latin small capital L
  'ⅰ': 'i', // Roman numeral one
};




const heuristicWeights = {
  "Powershell Command": 0.3,
  "Silent Powershell Command": 0.4,
  "Suspicious File": 0.3,
  "Remote File execution(MSHTA)": 0.5,
  "HardCode Clipboard Function": 0.2,
  "Windows + R Command": 0.2,
  "Script or shell Command": 0.3,
  "Hexadecimal_Code": 0.4,
  "Obfuscated Powershell Command": 0.6,
  "IEX Found": 0.4,
  "IWR Found": 0.4
};


function extractDomainAndCheckHomoglyphs(text) {
  const urlPattern = /https?:\/\/([^\s/]+)/gi;
  let match;
  const suspiciousDomains = [];

  while ((match = urlPattern.exec(text)) !== null) {
    const domain = match[1];
    const homoglyphsFound = [];

    for (const char of domain) {
      if (homoglyphMap[char]) {
        homoglyphsFound.push({ char, replacement: homoglyphMap[char] });
      }
    }

    if (homoglyphsFound.length > 0) {
      suspiciousDomains.push({ domain, homoglyphsFound });
    }
  }

  return suspiciousDomains;
}




//It is used to verify the Heuristic Evaluation of the IWR, IEX, Mhta 
function isLikelySafeUsage(content) {
  const normalized = content.toLowerCase();


  const hasIwr = normalized.includes('iwr')
  const isIwrDownloadOnly = /iwr\s+https?:\/\/[^\s]+.*-outfile\s+/i.test(normalized);
  const iwrHasNoExecution = !/(\||;)\s*(iex|invoke-expression)/i.test(normalized);

  const hasIex = normalized.includes('iex');
  const noIexDynamic = !/iex\s+(\$|\(|['"`])/i.test(normalized);
  const noIexChaining = !/(\||;|&&)\s*iex/i.test(normalized);

  const mshtaMatch = normalized.includes('mshta');
  const isMshtaTrusted = !mshtaMatch || /mshta\s+["']?(https?:\/\/(?:internal|intranet|corp|localhost)[^"'\s]*)/i.test(normalized);

  const noEncoded = !/encodedcommand|frombase64string|atob\s*\(/i.test(normalized);

return (
  ( !hasIwr ||  (isIwrDownloadOnly && iwrHasNoExecution)) &&
  (!hasIex || (noIexDynamic &&
  noIexChaining)) &&
  isMshtaTrusted &&
  noEncoded
);
}

document.addEventListener("click", () => {
  console.log("Click detected, sending readClipboard request to background");
  setTimeout(()=>{
 chrome.runtime.sendMessage({ action: "readClipboard" });
 console.log("Readclipboard request sent to the background.")
  },2500);
 
});

let model_output = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "readClipboard") {
    navigator.clipboard.readText().then(text => {
      console.log("Clipboard text:", text);
      monitorClipboard(text);
    }).catch(err => {
      console.error("Clipboard read failed", err);
    });
  }
  if(msg.type === 'model_result'){
    console.log("Received model output:",msg.decision);
    const rece = msg.decision;
    const confidence = parseFloat(rece.final_confidence);
    model_output = confidence/100;
    console.log("The output is:", model_output);

    evaluateFinalAlert();
  }
});

//It is used to regularly monitor the Clipboard for any suspicious contents found.

 let lastClipboardContent = '';
async function monitorClipboard(text) {
  if (text === lastClipboardContent) return;
  lastClipboardContent = text;

  const normalized = text.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').trim();

  const matched = maliciousPatterns.some(({ pattern }) => pattern.test(normalized));
  const suspiciousDomains = extractDomainAndCheckHomoglyphs(normalized);

  if (matched || suspiciousDomains.length > 0) {
    checkScriptContent(normalized, 'clipboard');
    clearClipboard();

    suspiciousDomains.forEach(({ domain, homoglyphsFound }) => {
      const detection = {
        type: 'Homoglyph Domain',
        source: 'clipboard',
        content: domain,
        description: `Detected homoglyphs: ${homoglyphsFound.map(h => `${h.char}→${h.replacement}`).join(', ')}`,
        url: window.location.href,
        src: sourceUrl,
        dest: destinationUrl,
        fullChain,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      if (canAlert(`homoglyph-${domain}`)) {
        showSecurityAlert(`Suspicious domain detected: ${domain}`, window.location.href);
      }
    });
  }
}
//Here this function will be used to check whether the content is encoded and then it match with the pattern 
function tryBase64DecodeAndAnalyze(content, source) {
  const base64Pattern = /atob\s*\(\s*[A-Za-z0-9+/=]{20,}['"`]\s*\)/gi;
  let match;
  while ((match = base64Pattern.exec(content)) !== null) {
    try {
      const decoded = atob(match[1]);
      checkScriptContent(decoded, source);
    } catch (e) {
      console.warn('Base64 decode failed:', e);
    }
  }
}

//These are the APIs to be used there here mentioned for the easy use.
  const originalAPIs = {
    execCommand: document.execCommand,
    writeText: navigator.clipboard?.writeText,
    setTimeout: window.setTimeout,
    setInterval: window.setInterval,
    fetch: window.fetch,
    xhrOpen: XMLHttpRequest.prototype.open
  };

//It will send the scripts to the backend and then receive the obfuscated script from the backend.
async function sendToDeobfuscationService(scriptContext) {
  if (!scriptContext?.content || scriptContext.content.trim().length === 0) {
    console.warn('Skipped sending empty script content to backend');
    return;
  }

  //To prevent from the multiple requests of the obfuscated content
  if (deobfuscationQueue.has(scriptContext.url)) return;
  deobfuscationQueue.add(scriptContext.url);
  try {
    const response = await fetch('https://deobfuscator-xcby.onrender.com/deobfuscate', {
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

//It will be used to handle the result which is received from the backend.
function handleDeobfuscationResult(original, result) {
  if (!result?.success) return;


  // Create detection record
  const detection = {
    type: 'Deobfuscated Script',
    source: original,
    content: result.deobfuscated,
    mappings: result.mappings,
    description:result,
    src:sourceUrl,
    dest:destinationUrl,
       fullChain,
    timestamp: new Date().toISOString(),
    analysis: result.analysis || 'Deobfuscation completed'
  };

  addToDetectionHistory(detection);

  
  checkScriptContent(result.deobfuscated, original.url);

  // Alert if needed
  if (canAlert(`deob-${hashString(original.content)}`)) {
    // showSecurityAlert(
    //   `Deobfuscation result: ${result.analysis || 'Suspicious content found'}`,
    //   original.url
    // );
  }
}


//It is used to prevent from the legitimate websites been detected.
const safePatterns = [
  /gtag\(['"]config['"],\s*['"]G-[A-Z0-9]+['"]\)/, // Google Analytics
  /window\.translations\s*=\s*\{[^}]+\}/,          // Translation blocks
  /\\u[0-9a-fA-F]{4}/g                              // Unicode escapes
]; 

//It will mostly check the browser urls neglection because it contains the % like symbols.
function isWhitelisted(content) {
  return safePatterns.some(pattern => pattern.test(content));
}

let sourceUrl = window.location.href;
let destinationUrl = window.location.href;
let fullChain = [window.location.href];


  //It will be used for producing the hash value for the specified hashcode to prevent from the same script alert for a no of times.
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }

//It will be used to check whether the last alert and the current alert to prevent from the spam.
  function canAlert(key = 'default') {
    const now = Date.now();
    const last = alertTimestamps.get(key) || 0;
    if (now - last < COOLDOWN_TIME) return false;
    alertTimestamps.set(key, now);
    return true;
  }

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

function getNavigationChain(retryCount = 0) {
  chrome.runtime.sendMessage({ type: 'get_navigation_chain' }, (response) => {
    if (response && response.sourceUrl && response.destinationUrl) {
      sourceUrl = response.sourceUrl;
      destinationUrl = response.destinationUrl;
      fullChain = response.fullChain;

      console.log('Source URL:', sourceUrl);
      console.log('Destination URL:', destinationUrl);
      console.log('Full Chain:', fullChain);

      // ✅ Start monitoring only after navigation chain is ready
      startScriptMonitoring();
    } else {
      console.warn('Navigation chain not ready, attempt:', retryCount + 1);
      if (retryCount < 3) {
        setTimeout(() => getNavigationChain(retryCount + 1), (retryCount + 1) * 1000);
      } else {
        sourceUrl = window.location.href;
        destinationUrl = window.location.href;
        fullChain = [window.location.href];
        console.log('Using fallback URLs:', sourceUrl);
        startScriptMonitoring(); // fallback
      }
    }
  });
}

// Call this instead of the direct message
setTimeout(() => {
  getNavigationChain();
}, 500); // Initial delay to ensure page is loaded

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

function startScriptMonitoring() {
  document.querySelectorAll('script').forEach(script => {
    const code = script.textContent?.trim();
    if (code) {
      checkScriptContent(code, script.src || 'inline');
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });
}


  //It will be used to check the script element for the presence of any malicious commands after the execution of it.
  document.querySelectorAll('script').forEach(checkScriptContent,'DOM');

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

  // Monitor setTimeout/setInterval Used to check the clipboard access things. It will be used to check after some times with a delay.
  window.setTimeout = function(callback, delay) {
    if (typeof callback === 'string' || 
        (typeof callback === 'function' && 
         callback.toString().includes('clipboard') && 
         !isUserInitiated())) {
      const detection = {
        type: 'setTimeout',
        source: 'Inline script',
        content: callback.toString().substring(0, PARTIAL_CONTENT_LENGTH),
         src:sourceUrl,
    dest:destinationUrl,
    fullChain,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      if (canAlert('setTimeout')) {
        // showSecurityAlert('Suspicious setTimeout with clipboard operation', window.location.href);
        
      }
    }
    return originalAPIs.setTimeout.apply(this, arguments);
  };

  //It will be used to check continuously with an interval
  window.setInterval = function(callback, delay) {
    if (typeof callback === 'string' || 
        (typeof callback === 'function' && 
         callback.toString().includes('clipboard') && 
         !isUserInitiated())) {
      const detection = {
        type: 'setInterval',
        source: 'Inline script',
        content: callback.toString().substring(0, PARTIAL_CONTENT_LENGTH),
         src:sourceUrl,
    dest:destinationUrl,
       fullChain,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      if (canAlert('setInterval')) {
        // showSecurityAlert('Suspicious setInterval with clipboard operation', window.location.href);
      }
    }
    return originalAPIs.setInterval.apply(this, arguments);
  };

  // Monitor clipboard APIs like the document.exec
  document.execCommand = function(command, showUI, value) {
    if (command.toLowerCase() === 'copy' && !isUserInitiated() && canAlert('execCommand')) {
      const detection = {
        type: 'execCommand',
        source: 'Inline script',
        content: `Attempt to copy: ${value?.substring(0, 100) || 'unknown content'}`,
         src:sourceUrl,
         screenshot:img,
    dest:destinationUrl,
       fullChain,
        url: window.location.href,
        timestamp: new Date().toISOString()
      };
      addToDetectionHistory(detection);
      // showSecurityAlert('execCommand copy detected without user interaction', window.location.href);
      clearClipboard();
    }
    return originalAPIs.execCommand.apply(this, arguments);
  };

  //It will be used to check the navigator.writeText() which is also an API for the data copy.
  if (navigator.clipboard && originalAPIs.writeText) {
    navigator.clipboard.writeText = function(text) {
      if (!isUserInitiated() && canAlert('clipboard.writeText')) {
        const detection = {
          type: 'clipboard.writeText',
          source: 'Inline script',
          content: `Attempt to copy: ${text?.substring(0, 100) || 'unknown content'}`,
          url: window.location.href,
                  screenshot:img,
           src:sourceUrl,
    dest:destinationUrl,
       fullChain,
          timestamp: new Date().toISOString()
        };
        addToDetectionHistory(detection);
        // showSecurityAlert('clipboard.writeText detected without user interaction', window.location.href);
return originalAPIs.writeText.call(navigator.clipboard, '[Blocked malicious clipboard content]');
      }
      
      const maliciousMatch = maliciousPatterns.find(({ pattern }) => pattern.test(text));
      if (text && maliciousMatch) {
        const detection = {
          type: 'Malicious Clipboard Content',
          source: 'Inline script',
          content: `Attempt to copy: ${text.match(maliciousMatch.pattern)?.[0,100] || 'Pattern matched'}`,
          url: window.location.href,
           src:sourceUrl,
    dest:destinationUrl,
       fullChain,
          timestamp: new Date().toISOString()
        };
        addToDetectionHistory(detection);
        // showSecurityAlert(`Malicious content detected in clipboard operation: ${maliciousMatch.description}`, window.location.href);
return originalAPIs.writeText.call(navigator.clipboard, '[Blocked malicious clipboard content]');
      }
      return originalAPIs.writeText.apply(this, arguments);
    };
  }

  //It will be used to check the clipboard manipulation without the user interaction
  function isUserInitiated() {
    try {
      const event = window.event;
      return event && event.isTrusted;
    } catch {
      return false;
    }
  }

//It wont work as of now which will clear the clipboard but due to the Browser policy it is blocked
function clearClipboard() {
  try {
    const safeText = '[Blocked malicious clipboard content]';

    if (navigator.clipboard && originalAPIs.writeText) {
      originalAPIs.writeText.call(navigator.clipboard, safeText)
        .then(() => console.log('Clipboard overridden with safe content'))
        .catch(err => console.warn('Clipboard override failed:', err));
    }
  } catch (e) {
    console.error('Clipboard override error:', e);
  }
}

function evaluateFinalAlert() {
  if (heuristicScore + model_output >= 0.5) {
    console.log("The malicious content is found and alerts");
    showSecurityAlert('Malicious Pattern Detected', window.location.href);
  }
}



let heuristicScore = 0;

  //It is the main function which will be triggered whenever the content is extracted the function for the pattern matching.
function checkScriptContent(content, source) {
  if (!content || content.length < 20 || content.includes('<![CDATA[') || isWhitelisted(content)) return;

  const lower = content.toLowerCase();
  if (
    lower.includes('invoke-webrequest') ||
    lower.includes('iwr') ||
    lower.includes('iex') ||
    lower.includes('mshta') ||
    lower.includes('encodedcommand') ||
    lower.includes('frombase64string') ||
    lower.includes('atob(')
  ) {
    if (isLikelySafeUsage(content)) {
      console.debug('[Safe Usage] Skipped alert for trusted command:', content);
      return;
    }
  }

  const powershellCommandPattern = /powershell(?:\.exe)?\s*[-\/][Ee]ncode[d]?[Cc]ommand\s+([A-Za-z0-9+/=\\-]+)/i;
  const normalized = content.replace(/\s+/g, ' ').replace(/[\n\r\t]/g, ' ').toLowerCase();
  let shouldDeobfuscate = false;
  const matchedPatterns = [];

  // Collect all matching patterns first
  maliciousPatterns.forEach(({ type, pattern, description }) => {
    const matches = normalized.match(new RegExp(pattern, 'gi'));
    if (matches && canAlert(`pattern:${pattern.source}`)) {
      matchedPatterns.push({ type, pattern, description, matches });
    }
  });

  if (matchedPatterns.length === 0) return;

  // Capture screenshot once after confirming matches
  chrome.runtime.sendMessage({ type: 'capture_screenshot' }, (response) => {
    const img = response?.imageUri || null;

    matchedPatterns.forEach(({ type, description, matches }) => {
      heuristicScore+=heuristicWeights[type] || 0.1;
      matches.forEach(() => {
        const detection = {
          type: type || 'Malicious things Found',
          source: source || 'DOM',
          content,
          description,
          url: window.location.href,
          screenshot: img,
          src: sourceUrl,
          dest: destinationUrl,
          fullChain,
          timestamp: new Date().toISOString()
        };
        addToDetectionHistory(detection);
        // showSecurityAlert(`We found the ${type}`, source || window.location.href);

        if (description.toLowerCase().includes('powershell')) {
          const psMatch = content.match(powershellCommandPattern);
          if (psMatch && psMatch[1]) {
            try {
              const decoded = atob(psMatch[1].replace(/\+/g, '+'));
              const decodedDetection = {
                type: 'Decoded PowerShell Command',
                source: source || 'DOM',
                content: decoded,
                description: 'Decoded PowerShell command from encoded input',
                url: window.location.href,
                screenshot: img,
                src: sourceUrl,
                dest: destinationUrl,
                   fullChain,
                timestamp: new Date().toISOString()
              };
              addToDetectionHistory(decodedDetection);
              // showSecurityAlert(`⚠️ PowerShell command detected:\n${decoded}`, source || window.location.href);
            } catch (e) {
              console.warn('Failed to decode PowerShell command:', e);
            }
          }
        }

        if (type === "Hexadecimal_Code") {
          shouldDeobfuscate = true;
        }
      });
    });

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