document.addEventListener('DOMContentLoaded', function() {

    const alertsDiv = document.getElementById('alerts');
    
    // Load previous alerts
    chrome.storage.local.get(['clipboardAlerts'], function(result) {
        if (result.clipboardAlerts) {
            alertsDiv.innerHTML = result.clipboardAlerts.map(alert => 
                `<div class="alert">${new Date(alert.time).toLocaleString()}: ${alert.message}</div>`
            ).join('');
        }
    });

     const sendButton = document.getElementById("send");
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      console.log("[popup] Send button clicked");

      chrome.runtime.sendNativeMessage(
        'com.clipboard.guard',
        { action: "scan_processes" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("[popup] Native messaging error:", chrome.runtime.lastError.message);
          } else {
            console.log("[popup] Received from native app:", response);
          }
        }
      );
    });
  } else {
    console.error("[popup] Button with ID 'send' not found.");
  }
    

});





