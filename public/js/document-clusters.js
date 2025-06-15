/**
 * Document Clusters Visualization
 * Shows groups of similar documents and their relationships
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('document-clusters-container')) {
        initializeDocumentClusters();
    }
});

/**
 * Initialize the document clusters view
 */
async function initializeDocumentClusters() {
    const clusterContainer = document.getElementById('document-clusters-container');
    if (!clusterContainer) return;

    // Show loading state
    clusterContainer.innerHTML = `
    <div class="clusters-loading">
      <div class="loading-spinner"></div>
      <p>Loading document clusters...</p>
    </div>
  `;

    try {
        // Fetch cluster data from API
        const response = await fetch('/api/clustering/clusters');
        if (!response.ok) {
            throw new Error('Failed to fetch document clusters');
        }

        const data = await response.json();
        const clusters = data.clusters || [];

        if (clusters.length === 0) {
            // No clusters found
            clusterContainer.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-collection"></i>
          <p>No document clusters found</p>
          <p class="empty-state-hint">We need at least 5 documents with text content to create clusters</p>
          <button class="modern-btn modern-btn-primary" onclick="refreshClusters()">
            Generate Document Clusters
          </button>
        </div>
      `;
            return;
        }

        // Render document clusters visualization
        renderDocumentClusters(clusterContainer, clusters);

    } catch (error) {
        console.error('Error initializing document clusters:', error);
        clusterContainer.innerHTML = `
      <div class="error-message">
        <i class="bi bi-exclamation-triangle"></i>
        <p>Failed to load document clusters</p>
        <p class="error-details">${error.message}</p>
        <button class="modern-btn modern-btn-primary" onclick="initializeDocumentClusters()">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Render document clusters visualization
 */
function renderDocumentClusters(container, clusters) {
    // Container for clusters
    container.innerHTML = `
    <div class="clusters-header">
      <div class="clusters-title">
        <h2>Document Clusters</h2>
        <span class="clusters-subtitle">${clusters.length} clusters found based on content similarity</span>
      </div>
      <div class="clusters-actions">
        <button class="modern-btn modern-btn-outline" onclick="refreshClusters()">
          <i class="bi bi-arrow-repeat"></i> Refresh Clusters
        </button>
      </div>
    </div>

    <div id="clusters-visualization" class="clusters-visualization">
      <div class="clusters-grid" id="clusters-grid">
        ${clusters.map((cluster, index) => renderCluster(cluster, index)).join('')}
      </div>
    </div>
  `;

    // Initialize cluster event handlers
    clusters.forEach((cluster, index) => {
        const clusterCard = document.getElementById(`cluster-${index}`);
        if (clusterCard) {
            clusterCard.addEventListener('click', () => {
                showClusterDetails(cluster);
            });
        }
    });
}

/**
 * Render a single cluster card
 */
function renderCluster(cluster, index) {
    // Extract some stats
    const documentCount = cluster.documents.length;
    const avgSimilarity = cluster.documents.reduce((sum, doc) => sum + doc.similarity, 0) / documentCount;

    return `
    <div class="cluster-card" id="cluster-${index}">
      <div class="cluster-header">
        <h3 class="cluster-name">${cluster.name}</h3>
        <span class="cluster-count">${documentCount} documents</span>
      </div>
      <div class="cluster-keywords">
        ${cluster.keywords.map(keyword => `<span class="keyword-tag">${keyword}</span>`).join('')}
      </div>
      <div class="cluster-meta">
        <span>Avg. similarity: ${(avgSimilarity * 100).toFixed(0)}%</span>
      </div>
      <div class="cluster-preview">
        ${cluster.documents.slice(0, 3).map(doc => `
          <div class="preview-doc">
            <i class="bi bi-file-text"></i>
            <span class="preview-doc-name">${truncateText(doc.name, 25)}</span>
          </div>
        `).join('')}
        ${documentCount > 3 ? `<div class="preview-more">+${documentCount - 3} more</div>` : ''}
      </div>
    </div>
  `;
}

/**
 * Show detailed view of a cluster
 */
function showClusterDetails(cluster) {
    // Create or get modal element
    const modalId = 'cluster-details-modal';
    let modal = document.getElementById(modalId);

    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('aria-hidden', 'true');

        modal.innerHTML = `
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Cluster Details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer">
            <button type="button" class="modern-btn" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(modal);
    }

    // Format content for the modal
    const modalBody = modal.querySelector('.modal-body');
    modalBody.innerHTML = `
    <div class="cluster-detail-container">
      <div class="cluster-detail-header">
        <h3>${cluster.name}</h3>
        <div class="cluster-detail-meta">
          <span>${cluster.documents.length} documents</span>
          <span>Created: ${new Date(cluster.created).toLocaleDateString()}</span>
        </div>
        <p class="cluster-description">${cluster.description}</p>
      </div>
      
      <div class="cluster-detail-section">
        <h4>Keywords</h4>
        <div class="cluster-keywords large">
          ${cluster.keywords.map(keyword => `<span class="keyword-tag">${keyword}</span>`).join('')}
        </div>
      </div>
      
      <div class="cluster-detail-section">
        <h4>Documents</h4>
        <div class="cluster-documents-list">
          <table class="modern-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Upload Date</th>
                <th>Similarity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cluster.documents.map(doc => `
                <tr>
                  <td>
                    <div class="document-name-cell">
                      <i class="bi bi-file-earmark-text document-icon"></i>
                      <span class="document-name">${doc.name}</span>
                    </div>
                  </td>
                  <td>${new Date(doc.uploadDate).toLocaleDateString()}</td>
                  <td>
                    <div class="similarity-indicator">
                      <div class="similarity-bar" style="width: ${doc.similarity * 100}%"></div>
                      <span>${(doc.similarity * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td>
                    <a href="/document/${doc.id}" class="action-btn" title="View Document">
                      <i class="bi bi-eye"></i>
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

    // Show the modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
}

/**
 * Refresh clusters data
 */
async function refreshClusters() {
    const clusterContainer = document.getElementById('document-clusters-container');
    if (!clusterContainer) return;

    // Show loading spinner
    clusterContainer.innerHTML = `
    <div class="clusters-loading">
      <div class="loading-spinner"></div>
      <p>Generating document clusters...</p>
      <p class="loading-note">This may take a moment as we analyze your documents</p>
    </div>
  `;

    try {
        // Call API to refresh clusters
        const response = await fetch('/api/clustering/clusters/refresh', {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to refresh clusters');
        }

        const data = await response.json();

        // Show success message briefly
        clusterContainer.innerHTML = `
      <div class="success-message">
        <i class="bi bi-check-circle"></i>
        <p>${data.message}</p>
      </div>
    `;

        // After a short delay, reload the clusters view
        setTimeout(() => {
            initializeDocumentClusters();
        }, 1500);

    } catch (error) {
        console.error('Error refreshing clusters:', error);
        clusterContainer.innerHTML = `
      <div class="error-message">
        <i class="bi bi-exclamation-triangle"></i>
        <p>Failed to refresh clusters</p>
        <p class="error-details">${error.message}</p>
        <button class="modern-btn modern-btn-primary" onclick="initializeDocumentClusters()">
          Back to Clusters
        </button>
      </div>
    `;
    }
}

/**
 * Helper function to truncate text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}
