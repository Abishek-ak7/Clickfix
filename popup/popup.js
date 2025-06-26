document.addEventListener('DOMContentLoaded', function() {
    const alertsDiv = document.getElementById('alerts');
    const todayCountEl = document.getElementById('todayCount');
    const uniqueSourcesEl = document.getElementById('uniqueSources');
    const totalBlockedEl = document.getElementById('totalBlocked');
    
    // Get today's date for filtering
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Load and process clipboard data from detectionHistory (same as history.js)
    chrome.storage.local.get(['detectionHistory'], function(result) {
        if (result.detectionHistory && result.detectionHistory.length > 0) {
            const detections = result.detectionHistory;
            
            // Calculate statistics
            const todayDetections = detections.filter(detection => 
                new Date(detection.timestamp) >= today
            );
            
            // Calculate unique sources safely (same logic as history.js)
            let uniqueSourcesCount = 0;
            try {
                const uniqueHosts = new Set();
                detections.forEach(d => {
                    try {
                        if (d.url && d.url.startsWith('http')) {
                            const hostname = new URL(d.url).hostname;
                            uniqueHosts.add(hostname);
                        } else {
                            uniqueHosts.add(d.url || 'unknown');
                        }
                    } catch (e) {
                        uniqueHosts.add(d.url || 'unknown');
                    }
                });
                uniqueSourcesCount = uniqueHosts.size;
            } catch (e) {
                console.warn('Error calculating unique sources:', e);
                uniqueSourcesCount = 0;
            }
            
            // Update statistics
            todayCountEl.textContent = todayDetections.length;
            uniqueSourcesEl.textContent = uniqueSourcesCount;
            totalBlockedEl.textContent = detections.length;
            
            // Show recent detections (last 5)
            const recentDetections = detections.slice(-5).reverse();
            alertsDiv.innerHTML = recentDetections.map(detection => {
                const timeString = formatTime(detection.timestamp);
                const typeString = escapeHtml(detection.type || 'Unknown');
                const sourceString = getSourceFromUrl(detection.url);
                
                return `<div class="alert">
                    <div class="alert-time">${timeString}</div>
                    <div class="alert-type">${typeString}</div>
                    <div class="alert-source">${sourceString}</div>
                </div>`;
            }).join('');
        } else {
            // No detections yet
            todayCountEl.textContent = '0';
            uniqueSourcesEl.textContent = '0';
            totalBlockedEl.textContent = '0';
            alertsDiv.innerHTML = '<div class="no-alerts">No clipboard activities detected yet</div>';
        }
    });
    
    // Add event listener for history button
    const historyButton = document.getElementById("viewHistory");
    if (historyButton) {
        historyButton.addEventListener("click", () => {
            console.log("[popup] View History button clicked");
            
            // Open history page in a new tab
            chrome.tabs.create({
                url: chrome.runtime.getURL('history.html')
            });
        });
    } else {
        console.error("[popup] Button with ID 'viewHistory' not found.");
    }
});

// Helper functions to match history.js formatting
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } else if (diffDays <= 7) {
        return `${diffDays}d ago`;
    } else {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    }
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSourceFromUrl(url) {
    if (!url) return 'Unknown';
    try {
        if (url.startsWith('http')) {
            const hostname = new URL(url).hostname;
            return hostname.replace('www.', '');
        } else {
            return url.length > 20 ? url.substring(0, 20) + '...' : url;
        }
    } catch (e) {
        return url.length > 20 ? url.substring(0, 20) + '...' : url;
    }
}