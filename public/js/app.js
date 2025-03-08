notepad .env// Utility functions for Documind client-side application

/**
 * Show admin dashboard
 */
async function showAdminDashboard() {
    if (!app.isAuthenticated || app.user.role !== 'admin') {
        window.location.hash = '#/documents';
        return;
    }

    try {
        showLoading();

        const response = await fetch('/api/admin/stats');

        if (!response.ok) {
            throw new Error('Failed to fetch admin statistics');
        }

        const stats = await response.json();

        const html = `
            <h2 class="mb-4">Admin Dashboard</h2>
            
            <div class="row">
                <div class="col-md-6 mb-4">
                    <div class="card h-100">
                        <div class="card-header bg-primary text-white">
                            <h5 class="card-title mb-0">Document Statistics</h5>
                        </div>
                        <div class="card-body">
                            <ul class="list-group list-group-flush">
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    Total Documents
                                    <span class="badge bg-primary rounded-pill">${stats.documents.count}</span>
                                </li>
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    Total Size
                                    <span class="badge bg-primary rounded-pill">${formatFileSize(stats.documents.totalSize)}</span>
                                </li>
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    Unique Uploaders
                                    <span class="badge bg-primary rounded-pill">${stats.documents.uniqueUploaders}</span>
                                </li>
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    Last Upload
                                    <span>${stats.documents.lastUpload ? new Date(stats.documents.lastUpload).toLocaleString() : 'Never'}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="col-md-6 mb-4">
                    <div class="card h-100">
                        <div class="card-header bg-success text-white">
                            <h5 class="card-title mb-0">User Statistics</h5>
                        </div>
                        <div class="card-body">
                            <ul class="list-group list-group-flush">
                                <li class="list-group-item d-flex justify-content-between align-items-center">
                                    Total Users
                                    <span class="badge bg-success rounded-pill">${stats.users.count}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card mb-4">
                <div class="card-header bg-info text-white">
                    <h5 class="card-title mb-0">System Information</h5>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <p><strong>Version:</strong> 1.0.0</p>
                            <p><strong>Database:</strong> ${config.database.driver}</p>
                            <p><strong>Auth Mode:</strong> ${config.auth.mode}</p>
                        </div>
                        <div class="col-md-6">
                            <p><strong>Indexing Threads:</strong> ${config.indexing.threads}</p>
                            <p><strong>OCR Enabled:</strong> ${config.indexing.enableOcr ? 'Yes' : 'No'}</p>
                            <p><strong>NLP Enabled:</strong> ${config.indexing.enableNlp ? 'Yes' : 'No'}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        elements.contentArea.innerHTML = html;
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
        showError('Failed to load admin dashboard. Please try again.');
    }
}

/**
 * Show user profile
 */
function showUserProfile() {
    if (!app.isAuthenticated) {
        showLoginRequired();
        return;
    }

    const user = app.user;

    const html = `
        <h2 class="mb-4">User Profile</h2>
        
        <div class="card mb-4">
            <div class="card-header">
                <h5 class="card-title mb-0">Account Information</h5>
            </div>
            <div class="card-body">
                <div class="row mb-4">
                    <div class="col-md-4 text-center">
                        <div class="bg-light rounded-circle d-inline-flex justify-content-center align-items-center" style="width: 150px; height: 150px;">
                            <i class="bi bi-person" style="font-size: 5rem;"></i>
                        </div>
                    </div>
                    <div class="col-md-8">
                        <h3>${user.displayName}</h3>
                        <p class="text-muted">${user.role === 'admin' ? 'Administrator' : 'Standard User'}</p>
                        <p><strong>Username:</strong> ${user.username}</p>
                        <p><strong>Email:</strong> ${user.email}</p>
                    </div>
                </div>
                
                <hr>
                
                <h5>Change Password</h5>
                <form id="change-password-form">
                    <div class="mb-3">
                        <label for="current-password" class="form-label">Current Password</label>
                        <input type="password" class="form-control" id="current-password" required>
                    </div>
                    <div class="mb-3">
                        <label for="new-password" class="form-label">New Password</label>
                        <input type="password" class="form-control" id="new-password" required>
                    </div>
                    <div class="mb-3">
                        <label for="confirm-password" class="form-label">Confirm New Password</label>
                        <input type="password" class="form-control" id="confirm-password" required>
                    </div>
                    <div class="alert alert-danger" id="password-error" style="display: none;"></div>
                    <button type="submit" class="btn btn-primary">Change Password</button>
                </form>
            </div>
        </div>
    `;

    elements.contentArea.innerHTML = html;

    // Add change password event handler
    document.getElementById('change-password-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorEl = document.getElementById('password-error');

        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'New passwords do not match.';
            errorEl.style.display = 'block';
            return;
        }

        try {
            const response = await fetch('/api/users/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to change password');
            }

            // Show success message
            errorEl.textContent = 'Password changed successfully!';
            errorEl.className = 'alert alert-success';
            errorEl.style.display = 'block';

            // Reset form
            event.target.reset();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.className = 'alert alert-danger';
            errorEl.style.display = 'block';
        }
    });
}

/**
 * Show login required message
 */
function showLoginRequired() {
    const html = `
        <div class="text-center my-5">
            <div class="mb-4">
                <i class="bi bi-lock-fill" style="font-size: 4rem;"></i>
            </div>
            <h2>Login Required</h2>
            <p class="lead">Please sign in to access this content.</p>
            <button id="login-prompt-btn" class="btn btn-primary btn-lg">Login</button>
        </div>
    `;

    elements.contentArea.innerHTML = html;

    document.getElementById('login-prompt-btn').addEventListener('click', () => {
        const loginModal = new bootstrap.Modal(document.getElementById('loginModal'));
        loginModal.show();
    });
}

/**
 * Show loading indicator
 */
function showLoading() {
    elements.contentArea.innerHTML = `
        <div class="text-center my-5">
            <div class="spinner-border" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading...</p>
        </div>
    `;
}

/**
 * Show error message
 */
function showError(message) {
    elements.contentArea.innerHTML = `
        <div class="alert alert-danger" role="alert">
            <h4 class="alert-heading">Error</h4>
            <p>${message}</p>
            <hr>
            <button class="btn btn-outline-danger" onclick="handleRouteChange()">Try Again</button>
        </div>
    `;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes === 0 || !bytes) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Render document view
 */
function renderDocumentView() {
    const doc = app.currentDocument;
    if (!doc) return;

    // ...existing code...

    // Add "Edit with..." button that shows available editors
    const fileExt = doc.name.split('.').pop().toLowerCase();
    let editButtonHtml = '';

    // Fetch available editors for this document
    fetch(`/api/editors/document/${doc.id}/editors`)
        .then(response => response.json())
        .then(data => {
            if (data.editors && data.editors.length > 0) {
                const editorsListItems = data.editors.map(editor =>
                    `<li><a class="dropdown-item" href="#" data-editor-id="${editor.id}">
                        <i class="bi bi-${editor.icon}"></i> Edit with ${editor.name}
                    </a></li>`
                ).join('');

                const editorDropdown = `
                    <div class="dropdown d-inline-block">
                        <button class="btn btn-success dropdown-toggle" type="button" data-bs-toggle="dropdown">
                            <i class="bi bi-pencil-square"></i> Edit
                        </button>
                        <ul class="dropdown-menu">
                            ${editorsListItems}
                        </ul>
                    </div>
                `;

                // Insert editor dropdown next to download button
                const downloadBtn = document.querySelector('[href^="/api/documents/"][download]');
                if (downloadBtn) {
                    downloadBtn.insertAdjacentHTML('afterend', editorDropdown);

                    // Add click handlers for each editor option
                    document.querySelectorAll('[data-editor-id]').forEach(editorLink => {
                        editorLink.addEventListener('click', async (e) => {
                            e.preventDefault();
                            const editorId = e.currentTarget.dataset.editorId;

                            try {
                                const response = await fetch(`/api/editors/document/${doc.id}/edit/${editorId}`);
                                const data = await response.json();

                                if (data.editorUrl) {
                                    // For desktop apps, we might need to handle the protocol differently
                                    if (data.editorUrl.startsWith('http')) {
                                        window.open(data.editorUrl, '_blank');
                                    } else {
                                        // For protocol handlers like ms-word:, pdfelement:, etc.
                                        window.location.href = data.editorUrl;
                                    }
                                }
                            } catch (error) {
                                console.error('Error launching editor', error);
                                alert('Failed to launch editor. Please try again.');
                            }
                        });
                    });
                }
            }
        })
        .catch(error => {
            console.error('Error fetching document editors:', error);
        });

    // ...existing code...
}

// Initialize the application when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initialize);