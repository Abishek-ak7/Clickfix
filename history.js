// Enhanced Clipboard Guard History JavaScript
class ClipboardHistory {
  constructor() {
    this.currentPage = 1;
    this.itemsPerPage = 25;
    this.filteredHistory = [];
    this.fullHistory = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupTheme();
    this.loadHistory();
    this.setupAutoRefresh();
  }

  setupEventListeners() {
    // Search input
    document.getElementById('searchInput').addEventListener('input',
      this.debounce(() => this.applyFilters(), 300));

      document.getElementById('history-container').addEventListener('click', (event) => {
  if (event.target.classList.contains('view-btn')) {
    const row = event.target.closest('.detection-row');
    if (row) {
      this.showDetectionDetailsFromElement(row);
    }
  }
});


    // Date filters
    document.getElementById('fromDate').addEventListener('change', () => this.applyFilters());
    document.getElementById('toDate').addEventListener('change', () => this.applyFilters());

    document.addEventListener('click',(event)=>{
      const detectionElement = event.target.closest('.detection');
      if(detectionElement){
        this.showDetectionDetailsFromElement(detectionElement);
      }
    });
    // Type filter
    document.getElementById('typeFilter').addEventListener('change', () => this.applyFilters());

    // Items per page
    document.getElementById('itemsPerPage').addEventListener('change', (e) => {
      this.itemsPerPage = parseInt(e.target.value);
      this.currentPage = 1;
      this.renderHistory();
    });

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      this.toggleTheme();
    });

    // Export buttons
    document.getElementById('exportJsonBtn').addEventListener('click', () => {
      this.exportHistory('json');
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      this.exportHistory('csv');
    });

    // Clear history buttons
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      this.showClearModal();
    });

    document.getElementById('cancelClearBtn').addEventListener('click', () => {
      this.hideClearModal();
    });

    document.getElementById('confirmClearBtn').addEventListener('click', () => {
      this.clearHistory();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
          case 'f':
            e.preventDefault();
            document.getElementById('searchInput').focus();
            break;
          case 'e':
            e.preventDefault();
            this.exportHistory('json');
            break;
        }
      }
    });
  }

  setupTheme() {
    const savedTheme = localStorage.getItem('clipboard-guard-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
  formatTimeTo12Hour(timestamp) {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12; // Convert 0 to 12 for 12 AM
  const paddedMinutes = minutes.toString().padStart(2, '0');
  return `${hours}:${paddedMinutes} ${ampm}`;
}


  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('clipboard-guard-theme', newTheme);
  }

  setupAutoRefresh() {
    // Refresh every 30 seconds if Chrome extension APIs are available
    if (typeof chrome !== 'undefined' && chrome.storage) {
      setInterval(() => {
        this.loadHistory(false); // Silent refresh
      }, 30000);
    }
  }

  loadHistory(showLoading = true) {
    chrome.storage.local.set({ historyCleared: false });
    if (showLoading) {
      this.showLoading();
    }

    // Check if we're in a Chrome extension context
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['detectionHistory'], (result) => {
        this.processHistoryData(result.detectionHistory || []);
      });
    } else {
      // Fallback with sample data for demonstration
      const sampleData = this.generateSampleData();
      this.processHistoryData(sampleData);
    }
  }

  processHistoryData(historyData) {
    this.fullHistory = historyData || [];
    this.updateStats();
    this.populateTypeFilter();
    this.applyFilters();
  }

  updateStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: this.fullHistory.length,
      today: this.fullHistory.filter(d => new Date(d.timestamp) >= today).length,
      uniqueSources: 0
    };

    // Calculate unique sources safely
    try {
      const uniqueHosts = new Set();
      this.fullHistory.forEach(d => {
        try {
          if (d.url && d.url.startsWith('http')) {
            const hostname = new URL(d.url).hostname;
            uniqueHosts.add(hostname);
          } else {
            // Handle non-HTTP URLs or malformed URLs
            uniqueHosts.add(d.url || 'unknown');
          }
        } catch (e) {
          // If URL parsing fails, just add the raw URL
          uniqueHosts.add(d.url || 'unknown');
        }
      });
      stats.uniqueSources = uniqueHosts.size;
    } catch (e) {
      console.warn('Error calculating unique sources:', e);
      stats.uniqueSources = 0;
    }

    document.getElementById('totalDetections').textContent = stats.total;
    document.getElementById('todayDetections').textContent = stats.today;
    document.getElementById('uniqueSources').textContent = stats.uniqueSources;
  }

  populateTypeFilter() {
    const types = [...new Set(this.fullHistory.map(d => d.type))].sort();
    const typeFilter = document.getElementById('typeFilter');
   
    // Clear existing options except "All Types"
    typeFilter.innerHTML = '<option value="">All Types</option>';
   
    types.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      typeFilter.appendChild(option);
    });
  }

  applyFilters() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const typeFilter = document.getElementById('typeFilter').value;

    this.filteredHistory = this.fullHistory.filter(detection => {
      // Search filter
      if (searchTerm && !this.searchInDetection(detection, searchTerm)) {
        return false;
      }

      // Date filters
      const detectionDate = new Date(detection.timestamp);
      if (fromDate && detectionDate < new Date(fromDate)) {
        return false;
      }
      if (toDate && detectionDate > new Date(toDate + 'T23:59:59')) {
        return false;
      }

      // Type filter
      if (typeFilter && detection.type !== typeFilter) {
        return false;
      }

      return true;
    });

    this.currentPage = 1;
    this.renderHistory();
  }

  searchInDetection(detection, searchTerm) {
    const searchableText = [
      detection.type,
      detection.content,
      detection.url,
      this.formatDateTime(detection.timestamp),
      // Include full chain URLs in search
      ...(Array.isArray(detection.fullChain) ? detection.fullChain : [detection.fullChain || ''])
    ].join(' ').toLowerCase();

    return searchableText.includes(searchTerm);
  }

  renderHistory() {
    const container = document.getElementById('history-container');
   
    if (this.filteredHistory.length === 0) {
      container.innerHTML = this.getEmptyStateHTML();
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageHistory = this.filteredHistory.slice(startIndex, endIndex);

    container.innerHTML = pageHistory.map(detection =>
      this.renderDetection(detection)).join('');

    this.renderPagination();
  }

  
renderDetection(detection) {
  return `
    <div class="detection-row" data-detection='${JSON.stringify(detection).replace(/'/g, "&apos;")}'>
      <div class="detection-item">${this.escapeHtml(detection.type)}</div>
      <div class="detection-item">${this.formatDateTime(detection.timestamp)}</div>
      <div class="detection-item detection-screenshot">
        ${detection.screenshot ? `<img src="${detection.screenshot}" alt="Screenshot" />` : 'No screenshot'}
      </div>
      <div class="detection-item detection-source">
        ${this.renderHalfChain(detection.fullChain) || 'No source'}
      </div>
      <div class="detection-item detection-content">
        ${this.escapeHtml(detection.content) || 'No content'}
      </div>
      <div class="detection-item">
        <button class="btn btn-secondary view-btn">View</button>
      </div>
    </div>
  `;
}

showDetectionDetails(detection) {
  const modal = document.getElementById('detectionModal');
  const content = document.getElementById('detectionDetails');
  
  // Format the full chain of URLs
  let fullChainHTML = '';
  if (detection.fullChain && detection.fullChain.length > 0) {
    const chainUrls = Array.isArray(detection.fullChain) ? detection.fullChain : [detection.fullChain];
    fullChainHTML = `
      <div class="full-chain-section">
        <p><strong>Full URL Chain:</strong></p>
        <div class="chain-container">
          ${chainUrls.map((url, index) => `
            <div class="chain-step">
              <span class="chain-number">${index + 1}</span>
              <a href="${url}" target="_blank" rel="noopener noreferrer" title="${this.escapeHtml(url)}">
                ${this.truncateUrl(url, 60)}
              </a>
            </div>
            ${index < chainUrls.length - 1 ? '<div class="chain-arrow">&#8595;</div>' : ''}
          `).join('')}
        </div>
      </div>
    `;
  }


  content.innerHTML = `
    <h2>${this.escapeHtml(detection.type)}</h2>
    <p><strong>Time:</strong> ${this.formatDateTime(detection.timestamp)}</p>
    <p><strong>Source:</strong> ${this.escapeHtml(detection.source || 'N/A')}</p>
    <div class="content-section">
      <p><strong>Content:</strong></p>
      <pre>${this.escapeHtml(detection.content || 'No content')}</pre>
    </div>
    <div class="content-section">
      <p><strong>Status:</strong></p>
      <pre>${this.escapeHtml(detection.analysis || 'No content')}</pre>
    </div>
    ${fullChainHTML}
    ${detection.screenshot ? `
    <div class="screenshot-section">
      <p><strong>Screenshot:</strong></p>
      <img src="${detection.screenshot}" alt="Screenshot" class="modal-screenshot">
    </div>
    ` : ''}
  `;

  modal.style.display = 'block';

  // Close modal when clicking the X button
  document.getElementById('closeModalBtn').onclick = () => {
    modal.style.display = 'none';
  };

  // Close modal when clicking outside
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };
}

showDetectionDetailsFromElement(element) {
  const raw = element.getAttribute('data-detection');
  if (!raw) return;

  try {
    const detection = JSON.parse(raw.replace(/&apos;/g, "'"));
    this.showDetectionDetails(detection);
  } catch (e) {
    console.error("Failed to parse detection data:", e);
  }
}

  renderHalfChain(fullChain) {
  if (!fullChain) return '';

  const chainUrls = Array.isArray(fullChain) ? fullChain : [fullChain];
  if (chainUrls.length === 0) return '';

  const firstUrl = chainUrls[0];
  const lastUrl = chainUrls[chainUrls.length - 1];

  return `
    <div class="detection-urls">
      <div> <a href="${firstUrl}" target="_blank" rel="noopener noreferrer">${this.truncateUrl(firstUrl, 60)}</a></div>
    </div>
  `;
}

  // New method to render full chain array
  renderFullChain(fullChain) {
    if (!fullChain) return '';

    // Handle both array and single URL cases
    const chainUrls = Array.isArray(fullChain) ? fullChain : [fullChain];
    
    if (chainUrls.length === 0) return '';

    let html = '<div class="full-chain"><p>Full Chain:</p>';
    
    if (chainUrls.length === 1) {
      // Single URL case
      html += `
        <div class="chain-single">
          <a href="${chainUrls[0]}" target="_blank" rel="noopener noreferrer">
            ${this.escapeHtml(chainUrls[0])}
          </a>
        </div>
      `;
    } else {
      // Multiple URLs case - show as a chain with arrows
      html += '<div class="chain-multiple">';
      chainUrls.forEach((url, index) => {
        html += `
          <div class="chain-step" data-step="${index + 1}">
            <span class="chain-number">${index + 1}</span>
            <a href="${url}" target="_blank" rel="noopener noreferrer" title="${this.escapeHtml(url)}">
              ${this.truncateUrl(url, 60)}
            </a>
          </div>
        `;
        // Add arrow between steps (except for the last one)
        if (index < chainUrls.length - 1) {
          html += '<div class="chain-arrow"> &#8594;</div>';
        }
      });
      html += '</div>';
      
      // Add toggle for full/collapsed view if many URLs
      if (chainUrls.length > 3) {
        html += `
          <button class="chain-toggle" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="show-more">Show all ${chainUrls.length} URLs</span>
            <span class="show-less">Show less</span>
          </button>
        `;
      }
    }
    
    html += '</div>';
    return html;
  }

  // Utility method to truncate URLs for display
  truncateUrl(url, maxLength = 60) {
    if (!url || url.length <= maxLength) return this.escapeHtml(url);
    
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;
      
      if (domain.length + path.length <= maxLength) {
        return this.escapeHtml(url);
      }
      
      const availableLength = maxLength - domain.length - 3; // 3 for "..."
      if (availableLength > 0) {
        return this.escapeHtml(domain + path.substring(0, availableLength) + '...');
      } else {
        return this.escapeHtml(domain + '...');
      }
    } catch (e) {
      // If URL parsing fails, just truncate normally
      return this.escapeHtml(url.substring(0, maxLength - 3) + '...');
    }
  }

  renderPagination() {
    const totalPages = Math.ceil(this.filteredHistory.length / this.itemsPerPage);
    const pagination = document.getElementById('pagination');

    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }

    let paginationHTML = `
      <button ${this.currentPage === 1 ? 'disabled' : ''}
              data-page="${this.currentPage - 1}" class="pagination-btn">
        &#8592; Previous
      </button>
    `;

    // Page numbers
    const maxVisiblePages = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      paginationHTML += `
        <button class="${i === this.currentPage ? 'active' : ''} pagination-btn"
                data-page="${i}">
          ${i}
        </button>
      `;
    }

    paginationHTML += `
      <button ${this.currentPage === totalPages ? 'disabled' : ''}
              data-page="${this.currentPage + 1}" class="pagination-btn">
        Next &#8594;
      </button>
    `;

    pagination.innerHTML = paginationHTML;

    // Add event listeners to pagination buttons
    pagination.querySelectorAll('.pagination-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = parseInt(e.target.dataset.page);
        if (!isNaN(page)) {
          this.changePage(page);
        }
      });
    });
  }

  changePage(page) {
    const totalPages = Math.ceil(this.filteredHistory.length / this.itemsPerPage);
    if (page >= 1 && page <= totalPages) {
      this.currentPage = page;
      this.renderHistory();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  getEmptyStateHTML() {
    return `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9Z"/>
        </svg>
        <h3>No detections found</h3>
        <p>No security detections match your current filters.</p>
        <p>Try adjusting your search criteria or clearing filters.</p>
      </div>
    `;
  }

  showLoading() {
    const container = document.getElementById('history-container');
    container.innerHTML = `
      <div class="empty-state">
        <div style="animation: spin 1s linear infinite; width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid var(--secondary-color); border-radius: 50%; margin: 0 auto 20px;"></div>
        <p>Loading detection history...</p>
      </div>
    `;
  }

  // Utility functions
  formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      return `Today at ${date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    } else if (diffDays <= 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }
  

  escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Modal functions
  showClearModal() {
    document.getElementById('clearModal').style.display = 'flex';
  }

  hideClearModal() {
    document.getElementById('clearModal').style.display = 'none';
  }

  clearHistory() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'clear_history' }, (response) => {
        if (response?.success) {
          this.fullHistory = [];
          this.processHistoryData([]);
          this.hideClearModal();
        } else {
          console.warn('Failed to clear history in background.');
        }
      });
    } else {
      this.fullHistory = [];
      this.processHistoryData([]);
      this.hideClearModal();
    }
  }

  // Export functionality - Enhanced to handle full chain arrays
  exportHistory(format) {
    const dataToExport = this.filteredHistory.length > 0 ? this.filteredHistory : this.fullHistory;
   
    if (dataToExport.length === 0) {
      alert('No data to export');
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `clipboard-guard-history-${timestamp}`;

    if (format === 'json') {
      this.exportAsJSON(dataToExport, filename);
    } else if (format === 'csv') {
      this.exportAsCSV(dataToExport, filename);
    }
  }

  exportAsJSON(data, filename) {
    const exportData = {
      exportDate: new Date().toISOString(),
      totalRecords: data.length,
      records: data
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    this.downloadFile(blob, `${filename}.json`);
  }

  exportAsCSV(data, filename) {
    const headers = ['Timestamp', 'Type', 'Content', 'Source URL', 'Destination URL', 'Full Chain URLs'];
    const csvContent = [
      headers.join(','),
      ...data.map(record => [
        `"${record.timestamp}"`,
        `"${record.type.replace(/"/g, '""')}"`,
        `"${(record.content || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
        `"${(record.url || '').replace(/"/g, '""')}"`,
        `"${(record.dest || '').replace(/"/g, '""')}"`,
        `"${this.formatFullChainForCSV(record.fullChain)}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    this.downloadFile(blob, `${filename}.csv`);
  }

  // Helper method to format full chain for CSV export
  formatFullChainForCSV(fullChain) {
    if (!fullChain) return '';
    
    const chainUrls = Array.isArray(fullChain) ? fullChain : [fullChain];
    return chainUrls.map(url => url.replace(/"/g, '""')).join(' -> ');
  }

  downloadFile(blob, filename) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Sample data generator for testing (you can remove this in production)
}

// Initialize the application
let clipboardHistory;

document.addEventListener('DOMContentLoaded', () => {
  clipboardHistory = new ClipboardHistory();
 
  // Add spin animation for loading
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* Enhanced styles for full chain display */
    .full-chain {
      margin: 10px 0;
      padding: 10px;
      background: var(--bg-secondary, #f8f9fa);
      border-radius: 6px;
      border-left: 3px solid var(--accent-color, #007bff);
    }
    
    .full-chain p {
      margin: 0 0 8px 0;
      font-weight: 600;
      color: var(--text-primary, #333);
    }
    
    .chain-single a {
      color: var(--link-color, #007bff);
      text-decoration: none;
      word-break: break-all;
    }
    
    .chain-single a:hover {
      text-decoration: underline;
    }
    
    .chain-multiple {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      max-height: 120px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    
    .full-chain.expanded .chain-multiple {
      max-height: none;
    }
    
    .chain-step {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      min-width: 0;
    }
    
    .chain-number {
      background: var(--accent-color, #007bff);
      color: white;
      font-size: 12px;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 50%;
      min-width: 20px;
      text-align: center;
      flex-shrink: 0;
    }
    
    .chain-step a {
      color: var(--link-color, #007bff);
      text-decoration: none;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    
    .chain-step a:hover {
      text-decoration: underline;
    }
    
    .chain-arrow {
      color: var(--text-secondary, #666);
      font-weight: bold;
      font-size: 16px;
      flex-shrink: 0;
    }
    
    .chain-toggle {
      margin-top: 8px;
      padding: 4px 8px;
      background: none;
      border: 1px solid var(--accent-color, #007bff);
      color: var(--accent-color, #007bff);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s ease;
    }
    
    .chain-toggle:hover {
      background: var(--accent-color, #007bff);
      color: white;
    }
    
    .chain-toggle .show-less {
      display: none;
    }
    
    .full-chain.expanded .chain-toggle .show-more {
      display: none;
    }
    
    .full-chain.expanded .chain-toggle .show-less {
      display: inline;
    }
    
    @media (max-width: 768px) {
      .chain-multiple {
        flex-direction: column;
        align-items: stretch;
      }
      
      .chain-arrow {
        transform: rotate(90deg);
        align-self: center;
      }
      
      .chain-step {
        justify-content: flex-start;
      }
    }
  `;
  document.head.appendChild(style);
});

// Service Worker communication (if available)
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'HISTORY_UPDATED') {
      clipboardHistory.loadHistory(false);
    }
  });
}