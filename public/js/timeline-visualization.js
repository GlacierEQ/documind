/**
 * Interactive Timeline Visualization
 * Provides a rich, interactive timeline for case events
 */

document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('timeline-visualization')) {
        initializeTimeline();
    }
});

/**
 * Initialize the interactive timeline
 */
async function initializeTimeline() {
    const timelineContainer = document.getElementById('timeline-visualization');
    if (!timelineContainer) return;

    // Show loading indicator
    timelineContainer.innerHTML = `
    <div class="timeline-loading">
      <div class="loading-spinner"></div>
      <p>Loading case timeline...</p>
    </div>
  `;

    try {
        // Load timeline data from API
        const response = await fetch('/api/case/timeline?days=365');
        if (!response.ok) throw new Error('Failed to fetch timeline data');

        const data = await response.json();

        if (!data.events || data.events.length === 0) {
            timelineContainer.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-calendar-x"></i>
          <p>No timeline events found</p>
          <button class="modern-btn modern-btn-primary" onclick="scanDocumentsForEvents()">
            Scan Documents for Events
          </button>
        </div>
      `;
            return;
        }

        // Prepare data for timeline
        const events = prepareTimelineData(data.events);
        const entities = data.entities || [];

        // Render timeline container
        timelineContainer.innerHTML = `
      <div class="timeline-header">
        <div class="timeline-title">
          <h3>Case Timeline</h3>
          <span class="timeline-subtitle">${events.length} events found</span>
        </div>
        <div class="timeline-controls">
          <div class="timeline-filter">
            <select id="timeline-event-filter" class="form-select">
              <option value="all">All Event Types</option>
              ${getUniqueEventTypes(events).map(type =>
            `<option value="${type}">${type}</option>`).join('')}
            </select>
          </div>
          <div class="timeline-entity-filter">
            <select id="timeline-entity-filter" class="form-select">
              <option value="all">All Entities</option>
              ${entities.map(entity =>
                `<option value="${entity.name}">${entity.name} (${entity.type})</option>`).join('')}
            </select>
          </div>
          <div class="timeline-actions">
            <button id="timeline-zoom-in" class="modern-btn-icon" title="Zoom In">
              <i class="bi bi-zoom-in"></i>
            </button>
            <button id="timeline-zoom-out" class="modern-btn-icon" title="Zoom Out">
              <i class="bi bi-zoom-out"></i>
            </button>
            <button id="timeline-download" class="modern-btn-icon" title="Download Timeline">
              <i class="bi bi-download"></i>
            </button>
            <button id="timeline-fullscreen" class="modern-btn-icon" title="Toggle Fullscreen">
              <i class="bi bi-arrows-fullscreen"></i>
            </button>
          </div>
        </div>
      </div>
      <div id="timeline-vis" class="timeline-visualization-area"></div>
      <div class="timeline-legend">
        <div class="legend-title">Event Types:</div>
        <div id="timeline-legend-items" class="legend-items"></div>
      </div>
    `;

        // Create the timeline visualization using vis-timeline
        createVisTimeline(events, 'timeline-vis');

        // Create the legend
        createLegend(getUniqueEventTypes(events), 'timeline-legend-items');

        // Set up event handlers for controls
        setupTimelineControls(events);

    } catch (error) {
        console.error('Error initializing timeline:', error);
        timelineContainer.innerHTML = `
      <div class="error-message">
        <i class="bi bi-exclamation-triangle"></i>
        <p>Failed to load timeline</p>
        <button class="modern-btn modern-btn-primary" onclick="initializeTimeline()">
          Retry
        </button>
      </div>
    `;
    }
}

/**
 * Prepare timeline data for visualization
 */
function prepareTimelineData(events) {
    return events.map(event => {
        // Determine icon based on event type
        let icon = '';
        let className = '';

        switch (event.eventType.toLowerCase()) {
            case 'hearing':
                icon = 'bi bi-bank';
                className = 'event-hearing';
                break;
            case 'filing':
                icon = 'bi bi-file-text';
                className = 'event-filing';
                break;
            case 'deadline':
            case 'document-deadline':
                icon = 'bi bi-alarm';
                className = 'event-deadline';
                break;
            case 'meeting':
                icon = 'bi bi-people';
                className = 'event-meeting';
                break;
            case 'trial':
                icon = 'bi bi-building';
                className = 'event-trial';
                break;
            case 'document-date':
                icon = 'bi bi-calendar-date';
                className = 'event-document';
                break;
            case 'document-execution':
                icon = 'bi bi-pen';
                className = 'event-execution';
                break;
            case 'birth':
                icon = 'bi bi-person-plus';
                className = 'event-birth';
                break;
            case 'marriage-event':
                icon = 'bi bi-heart';
                className = 'event-marriage';
                break;
            case 'property-transaction':
                icon = 'bi bi-house';
                className = 'event-property';
                break;
            default:
                icon = 'bi bi-calendar-event';
                className = 'event-other';
        }

        // Format for vis-timeline
        return {
            id: event.id,
            content: `
        <div class="timeline-event ${className}">
          <div class="event-icon"><i class="${icon}"></i></div>
          <div class="event-content">
            <div class="event-title">${event.type}</div>
            <div class="event-description">${truncateText(event.description, 100)}</div>
          </div>
        </div>`,
            start: new Date(event.date),
            className: className,
            type: event.eventType,
            importance: event.importance,
            description: event.description,
            documentId: event.documentId,
            documentName: event.documentName,
            entities: event.entities || [],
            rawData: event // Store original data for reference
        };
    });
}

/**
 * Create the timeline visualization using vis-timeline
 */
function createVisTimeline(events, containerId) {
    const container = document.getElementById(containerId);

    // Create a DataSet for events
    const items = new vis.DataSet(events);

    // Calculate date range
    const dates = events.map(e => new Date(e.start));
    const minDate = dates.length ? new Date(Math.min.apply(null, dates)) : new Date();
    const maxDate = dates.length ? new Date(Math.max.apply(null, dates)) : new Date();

    // Set minimum span to 30 days
    if (maxDate - minDate < 30 * 24 * 60 * 60 * 1000) {
        maxDate.setDate(minDate.getDate() + 30);
    }

    // Configure the timeline
    const options = {
        min: new Date(minDate.getTime() - 7 * 24 * 60 * 60 * 1000), // 1 week before earliest event
        max: new Date(maxDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 1 week after latest event
        zoomMin: 1000 * 60 * 60 * 24 * 7,    // One week
        zoomMax: 1000 * 60 * 60 * 24 * 365,  // One year
        orientation: {
            axis: 'top',
            item: 'top'
        },
        minHeight: '400px',
        showCurrentTime: true,
        format: {
            minorLabels: {
                millisecond: 'SSS',
                second: 's',
                minute: 'HH:mm',
                hour: 'HH:mm',
                weekday: 'ddd D',
                day: 'D',
                week: 'w',
                month: 'MMM',
                year: 'YYYY'
            },
            majorLabels: {
                millisecond: 'HH:mm:ss',
                second: 'D MMMM HH:mm',
                minute: 'ddd D MMMM',
                hour: 'ddd D MMMM',
                weekday: 'MMMM YYYY',
                day: 'MMMM YYYY',
                week: 'MMMM YYYY',
                month: 'YYYY',
                year: ''
            }
        }
    };

    // Create the timeline
    window.timeline = new vis.Timeline(container, items, options);

    // Add click event handler
    timeline.on('click', function (properties) {
        if (properties.item) {
            const clickedEvent = items.get(properties.item);
            showEventDetails(clickedEvent);
        }
    });
}

/**
 * Show details for a timeline event
 */
function showEventDetails(event) {
    // Create or get modal element
    const modalId = 'timeline-event-modal';
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
            <h5 class="modal-title">Event Details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body"></div>
          <div class="modal-footer">
            <button type="button" class="modern-btn" data-bs-dismiss="modal">Close</button>
            <button type="button" class="modern-btn modern-btn-primary" id="view-document-btn">View Document</button>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(modal);
    }

    // Format date
    const eventDate = new Date(event.start).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Populate modal content
    const modalBody = modal.querySelector('.modal-body');

    modalBody.innerHTML = `
    <div class="event-detail-container">
      <div class="event-detail-header ${event.className}">
        <div class="event-detail-date">${eventDate}</div>
        <div class="event-detail-type">${event.type}</div>
      </div>
      
      <div class="event-detail-section">
        <h6>Description</h6>
        <p>${event.description}</p>
      </div>
      
      ${event.documentId ? `
        <div class="event-detail-section">
          <h6>Related Document</h6>
          <p><a href="/document/${event.documentId}" target="_blank">${event.documentName || `Document #${event.documentId}`}</a></p>
        </div>
      ` : ''}
      
      ${event.entities && event.entities.length > 0 ? `
        <div class="event-detail-section">
          <h6>Entities Mentioned</h6>
          <div class="entity-chips">
            ${event.entities.map(entity => `
              <span class="entity-chip entity-${entity.toLowerCase().replace(/\s+/g, '-')}">${entity}</span>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="event-detail-section">
        <h6>Event Context</h6>
        <div class="event-context-box">
          ${event.rawData.context || 'No additional context available.'}
        </div>
      </div>
    </div>
  `;

    // Initialize modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    // Set up document button
    const docButton = document.getElementById('view-document-btn');
    if (event.documentId) {
        docButton.style.display = 'block';
        docButton.onclick = function () {
            window.open(`/document/${event.documentId}`, '_blank');
        };
    } else {
        docButton.style.display = 'none';
    }
}

/**
 * Create legend for timeline events
 */
function createLegend(eventTypes, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let legendHTML = '';

    eventTypes.forEach(type => {
        let className = '';
        switch (type.toLowerCase()) {
            case 'hearing': className = 'event-hearing'; break;
            case 'filing': className = 'event-filing'; break;
            case 'deadline': className = 'event-deadline'; break;
            case 'meeting': className = 'event-meeting'; break;
            case 'trial': className = 'event-trial'; break;
            case 'document-date': className = 'event-document'; break;
            case 'document-execution': className = 'event-execution'; break;
            case 'birth': className = 'event-birth'; break;
            case 'marriage-event': className = 'event-marriage'; break;
            case 'property-transaction': className = 'event-property'; break;
            default: className = 'event-other';
        }

        legendHTML += `
      <div class="legend-item">
        <span class="legend-color ${className}"></span>
        <span class="legend-label">${formatEventType(type)}</span>
      </div>
    `;
    });

    container.innerHTML = legendHTML;
}

/**
 * Format event type for display
 */
function formatEventType(type) {
    return type
        .replace(/-/g, ' ')
        .replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Get unique event types from events array
 */
function getUniqueEventTypes(events) {
    const types = events.map(event => event.type);
    return [...new Set(types)];
}

/**
 * Set up timeline controls (filters, zoom, download)
 */
function setupTimelineControls(events) {
    // Event type filter
    const typeFilter = document.getElementById('timeline-event-filter');
    if (typeFilter) {
        typeFilter.addEventListener('change', function () {
            filterTimelineEvents();
        });
    }

    // Entity filter
    const entityFilter = document.getElementById('timeline-entity-filter');
    if (entityFilter) {
        entityFilter.addEventListener('change', function () {
            filterTimelineEvents();
        });
    }

    // Zoom in button
    const zoomInBtn = document.getElementById('timeline-zoom-in');
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', function () {
            if (window.timeline) {
                const range = window.timeline.getWindow();
                const interval = (range.end - range.start) * 0.5;
                const start = new Date(range.start.getTime() + interval * 0.25);
                const end = new Date(range.end.getTime() - interval * 0.25);
                window.timeline.setWindow(start, end);
            }
        });
    }

    // Zoom out button
    const zoomOutBtn = document.getElementById('timeline-zoom-out');
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', function () {
            if (window.timeline) {
                const range = window.timeline.getWindow();
                const interval = (range.end - range.start);
                const start = new Date(range.start.getTime() - interval * 0.25);
                const end = new Date(range.end.getTime() + interval * 0.25);
                window.timeline.setWindow(start, end);
            }
        });
    }

    // Download button
    const downloadBtn = document.getElementById('timeline-download');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', function () {
            downloadTimeline();
        });
    }

    // Fullscreen button
    const fullscreenBtn = document.getElementById('timeline-fullscreen');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', function () {
            const timelineContainer = document.getElementById('timeline-visualization');
            if (timelineContainer) {
                toggleFullscreen(timelineContainer);
            }
        });
    }
}

/**
 * Filter timeline events based on selected type and entity
 */
function filterTimelineEvents() {
    if (!window.timeline) return;

    const typeFilter = document.getElementById('timeline-event-filter');
    const entityFilter = document.getElementById('timeline-entity-filter');

    const selectedType = typeFilter ? typeFilter.value : 'all';
    const selectedEntity = entityFilter ? entityFilter.value : 'all';

    const allItems = window.timeline.itemsData.get();

    // Apply filters
    const filteredItems = allItems.filter(item => {
        // Filter by type
        if (selectedType !== 'all' && item.type !== selectedType) {
            return false;
        }

        // Filter by entity
        if (selectedEntity !== 'all') {
            // Check if this item mentions the selected entity
            return item.entities && item.entities.includes(selectedEntity);
        }

        return true;
    });

    // Update timeline with filtered items
    window.timeline.setItems(new vis.DataSet(filteredItems));

    // Update counter
    const subtitle = document.querySelector('.timeline-subtitle');
    if (subtitle) {
        subtitle.textContent = `${filteredItems.length} events shown`;
    }
}

/**
 * Download timeline as image
 */
function downloadTimeline() {
    if (!window.timeline) return;

    try {
        // Create a div that will contain the timeline for export
        const exportContainer = document.createElement('div');
        exportContainer.className = 'timeline-export-container';
        exportContainer.style.width = '1200px';
        exportContainer.style.height = '800px';
        exportContainer.style.position = 'absolute';
        exportContainer.style.left = '-9999px';
        document.body.appendChild(exportContainer);

        // Clone the timeline to the export container
        const timelineElement = document.querySelector('.vis-timeline');
        const clone = timelineElement.cloneNode(true);
        exportContainer.appendChild(clone);

        // Use html2canvas to create image
        html2canvas(exportContainer, {
            scale: 2,
            logging: false,
            backgroundColor: '#fff'
        }).then(canvas => {
            // Create download link
            const link = document.createElement('a');
            link.download = `case-timeline-${new Date().toISOString().split('T')[0]}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            // Clean up
            document.body.removeChild(exportContainer);
        });
    } catch (error) {
        console.error('Error exporting timeline:', error);
        alert('Failed to download timeline. Please try again.');
    }
}

/**
 * Toggle fullscreen for an element
 */
function toggleFullscreen(element) {
    if (!document.fullscreenElement &&
        !document.mozFullScreenElement &&
        !document.webkitFullscreenElement &&
        !document.msFullscreenElement) {
        // Enter fullscreen
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        }

        // Add fullscreen class for styling
        element.classList.add('fullscreen');

    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }

        // Remove fullscreen class
        element.classList.remove('fullscreen');
    }
}

/**
 * Helper function to truncate text
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Trigger scanning documents for events
 */
function scanDocumentsForEvents() {
    const scanBtn = event.target;
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Scanning...';

    fetch('/api/case/scan-documents-for-events', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(`Found ${data.eventsExtracted} events from your documents. The timeline will now update.`);
                initializeTimeline();
            } else {
                alert('Failed to scan documents. Please try again or contact support.');
                scanBtn.disabled = false;
                scanBtn.innerHTML = 'Scan Documents for Events';
            }
        })
        .catch(error => {
            console.error('Error scanning documents:', error);
            alert('An error occurred while scanning documents. Please try again.');
            scanBtn.disabled = false;
            scanBtn.innerHTML = 'Scan Documents for Events';
        });
}
