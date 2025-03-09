/**
 * Document Comparison Tool
 * Compare different versions of documents with visual diff highlighting
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('document-comparison')) {
        initializeDocumentCompare();
    }
});

/**
 * Initialize document comparison viewer
 */
async function initializeDocumentCompare() {
    const compareContainer = document.getElementById('document-comparison');
    if (!compareContainer) return;

    // Show loading indicator
    compareContainer.innerHTML = `
    <div class="compare-loading">
      <div class="loading-spinner"></div>
      <p>Loading document comparison...</p>
    </div>
  `;

    try {
        // Get document and version IDs from URL
        const urlParams = new URLSearchParams(window.location.search);
        const documentId = urlParams.get('documentId') || getDocumentIdFromPath();
        const versionId = urlParams.get('versionId');

        if (!documentId || !versionId) {
            throw new Error('Missing document or version ID');
        }

        // Fetch comparison data
        const response = await fetch(`/api/document-editor/${documentId}/compare/${versionId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to load comparison data');
        }

        const data = await response.json();

        // Render comparison UI
        renderComparisonUI(compareContainer, data);

        // Initialize diff viewer with the content
        initDiffViewer(data.currentContent, data.versionContent);

    } catch (error) {
        console.error('Error initializing document comparison:', error);
        compareContainer.innerHTML = `
      <div class="error-message">
        <i class="bi bi-exclamation-triangle"></i>
        <p>Failed to load document comparison</p>
        <p class="error-details">${error.message}</p>
        <button class="modern-btn modern-btn-primary" onclick="window.history.back()">
          Back to Document
        </button>
      </div>
    `;
    }
}

/**
 * Get document ID from URL path
 */
function getDocumentIdFromPath() {
    const pathMatch = window.location.pathname.match(/\/document\/(\d+)\/compare/);
    return pathMatch ? pathMatch[1] : null;
}

/**
 * Render the comparison UI
 */
function renderComparisonUI(container, data) {
    const versionDate = new Date(data.version.createdAt).toLocaleString();

    container.innerHTML = `
    <div class="comparison-container">
      <div class="comparison-header">
        <div class="comparison-title">
          <h2>Document Comparison</h2>
          <div class="comparison-metadata">
            <div class="metadata-item">
              <span class="label">Document:</span>
              <span class="value">${data.document.name}</span>
            </div>
            <div class="metadata-item">
              <span class="label">Version Date:</span>
              <span class="value">${versionDate}</span>
            </div>
          </div>
        </div>
        <div class="comparison-actions">
          <div class="view-mode-toggle">
            <button id="side-by-side-btn" class="view-mode-btn active" title="Side by Side View">
              <i class="bi bi-layout-split"></i>
            </button>
            <button id="unified-btn" class="view-mode-btn" title="Unified View">
              <i class="bi bi-layout-text-window"></i>
            </button>
          </div>
          <button id="restore-version-btn" class="modern-btn modern-btn-outline">
            <i class="bi bi-arrow-counterclockwise"></i> Restore This Version
          </button>
        </div>
      </div>
      
      <div class="comparison-content">
        <div id="diff-viewer" class="diff-viewer"></div>
      </div>
      
      <div class="comparison-footer">
        <div class="legend">
          <div class="legend-item">
            <span class="legend-indicator removed"></span>
            <span class="legend-label">Removed</span>
          </div>
          <div class="legend-item">
            <span class="legend-indicator added"></span>
            <span class="legend-label">Added</span>
          </div>
          <div class="legend-item">
            <span class="legend-indicator changed"></span>
            <span class="legend-label">Changed</span>
          </div>
        </div>
      </div>
    </div>
  `;

    // Set up event handlers
    document.getElementById('side-by-side-btn').addEventListener('click', () => {
        setViewMode('side-by-side');
    });

    document.getElementById('unified-btn').addEventListener('click', () => {
        setViewMode('unified');
    });

    document.getElementById('restore-version-btn').addEventListener('click', () => {
        restoreVersion(data.document.id, data.version.id, data.versionContent);
    });
}

/**
 * Initialize the diff viewer
 */
function initDiffViewer(currentContent, versionContent) {
    // Process HTML content to clean it up
    const cleanCurrent = cleanHtmlForDiff(currentContent);
    const cleanVersion = cleanHtmlForDiff(versionContent);

    const diffViewer = document.getElementById('diff-viewer');

    // Use DiffMatch library to calculate diff
    const dmp = new diff_match_patch();
    const diff = dmp.diff_main(cleanVersion, cleanCurrent);
    dmp.diff_cleanupSemantic(diff);

    // Set initial view mode
    currentViewMode = 'side-by-side';
    renderDiff(diff, diffViewer, currentViewMode);
}

/**
 * Clean HTML before diffing to reduce irrelevant formatting differences
 */
function cleanHtmlForDiff(html) {
    if (!html) return '';

    return html
        // Normalize spaces
        .replace(/\s+/g, ' ')
        // Normalize common HTML entities
        .replace(/&nbsp;/g, ' ')
        // Remove style attributes that cause noise in the diff
        .replace(/\sstyle="[^"]*"/g, '')
        // Remove data attributes
        .replace(/\sdata-[^=]*="[^"]*"/g, '')
        // Remove empty tags with only whitespace
        .replace(/<([a-z][a-z0-9]*)[^>]*>(\s*)<\/\1>/gi, ' ')
        // Normalize self-closing tags
        .replace(/<([a-z][a-z0-9]*)[^>]*\/>/gi, '<$1></\1>')
        // Trim
        .trim();
}

/**
 * Render the diff based on the selected view mode
 */
function renderDiff(diff, container, viewMode) {
    if (viewMode === 'side-by-side') {
        renderSideBySideDiff(diff, container);
    } else {
        renderUnifiedDiff(diff, container);
    }
}

/**
 * Render side-by-side diff view
 */
function renderSideBySideDiff(diff, container) {
    // Create side-by-side containers
    container.innerHTML = `
    <div class="diff-view side-by-side">
      <div class="diff-left">
        <div class="diff-header">Previous Version</div>
        <div class="diff-content" id="diff-left"></div>
      </div>
      <div class="diff-right">
        <div class="diff-header">Current Version</div>
        <div class="diff-content" id="diff-right"></div>
      </div>
    </div>
  `;

    const leftContainer = document.getElementById('diff-left');
    const rightContainer = document.getElementById('diff-right');

    let oldText = '';
    let newText = '';

    // Process diff
    diff.forEach(part => {
        const [type, text] = [part[0], part[1]];

        if (type === -1) {
            // Deletion - show in left only
            oldText += `<span class="diff-deleted">${escapeHtml(text)}</span>`;
        } else if (type === 1) {
            // Addition - show in right only
            newText += `<span class="diff-added">${escapeHtml(text)}</span>`;
        } else {
            // Context - show in both
            oldText += `<span class="diff-context">${escapeHtml(text)}</span>`;
            newText += `<span class="diff-context">${escapeHtml(text)}</span>`;
        }
    });

    leftContainer.innerHTML = formatHtmlForDisplay(oldText);
    rightContainer.innerHTML = formatHtmlForDisplay(newText);

    // Synchronize scrolling between panes
    synchronizeScrolling('diff-left', 'diff-right');
}

/**
 * Render unified diff view
 */
function renderUnifiedDiff(diff, container) {
    container.innerHTML = `
    <div class="diff-view unified">
      <div class="diff-header">Unified View</div>
      <div class="diff-content" id="diff-unified"></div>
    </div>
  `;

    const unifiedContainer = document.getElementById('diff-unified');
    let unifiedText = '';

    // Process diff
    diff.forEach(part => {
        const [type, text] = [part[0], part[1]];

        if (type === -1) {
            // Deletion
            unifiedText += `<span class="diff-deleted">${escapeHtml(text)}</span>`;
        } else if (type === 1) {
            // Addition
            unifiedText += `<span class="diff-added">${escapeHtml(text)}</span>`;
        } else {
            // Context
            unifiedText += `<span class="diff-context">${escapeHtml(text)}</span>`;
        }
    });

    unifiedContainer.innerHTML = formatHtmlForDisplay(unifiedText);
}

/**
 * Set the diff view mode
 */
function setViewMode(mode) {
    const sideBySideBtn = document.getElementById('side-by-side-btn');
    const unifiedBtn = document.getElementById('unified-btn');

    if (mode === 'side-by-side') {
        sideBySideBtn.classList.add('active');
        unifiedBtn.classList.remove('active');
    } else {
        unifiedBtn.classList.add('active');
        sideBySideBtn.classList.remove('active');
    }

    // Update the view
    const diffViewer = document.getElementById('diff-viewer');
    const dmp = new diff_match_patch();
    const cleanCurrent = window.currentDocument || '';
    const cleanVersion = window.versionDocument || '';
    const diff = dmp.diff_main(cleanVersion, cleanCurrent);
    dmp.diff_cleanupSemantic(diff);

    renderDiff(diff, diffViewer, mode);
}

/**
 * Restore a previous version
 */
async function restoreVersion(documentId, versionId, versionContent) {
    if (!confirm('Are you sure you want to restore this version? This will replace the current content with this version.')) {
        return;
    }

    try {
        const response = await fetch(`/api/document-editor/${documentId}/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: versionContent })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to restore version');
        }

        // Redirect to the document view
        window.location.href = `/document/${documentId}/view`;
    } catch (error) {
        console.error('Error restoring version:', error);
        alert('Failed to restore version: ' + error.message);
    }
}

/**
 * Synchronize scrolling between two elements
 */
function synchronizeScrolling(leftId, rightId) {
    const leftElem = document.getElementById(leftId);
    const rightElem = document.getElementById(rightId);

    if (!leftElem || !rightElem) return;

    leftElem.addEventListener('scroll', () => {
        rightElem.scrollTop = leftElem.scrollTop;
        rightElem.scrollLeft = leftElem.scrollLeft;
    });

    rightElem.addEventListener('scroll', () => {
        leftElem.scrollTop = rightElem.scrollTop;
        leftElem.scrollLeft = rightElem.scrollLeft;
    });
}

/**
 * Helper to escape HTML
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format HTML for better diff display
 */
function formatHtmlForDisplay(html) {
    // Here you could add syntax highlighting or other formatting
    // For now, we just return the HTML with proper spacing
    return html
        .replace(/([;{}()])/g, '$1 ')
        .replace(/([\n])/g, '<br>');
}
