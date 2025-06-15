"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apryseRouter = void 0;
exports.setupApryseViewer = setupApryseViewer;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
exports.apryseRouter = express_1.default.Router();
// Serve WebViewer assets (after installing the package)
exports.apryseRouter.use('/webviewer', express_1.default.static(path_1.default.join(process.cwd(), 'node_modules/@pdftron/webviewer/public')));
/**
 * Configure document viewing with Apryse WebViewer
 * @param app Express application
 */
function setupApryseViewer(app) {
    logger_1.logger.info('Setting up Apryse PDF viewer integration');
    // Register the Apryse router
    app.use('/pdf', exports.apryseRouter);
    // Endpoint to get WebViewer configuration for a specific document
    exports.apryseRouter.get('/viewer/:id', async (req, res) => {
        try {
            const documentId = req.params.id;
            const licenseKey = process.env.APRYSE_LICENSE_KEY || 'demo:1741412283339:6140ab060300000000e30d4612abaccc3cb7b7e434cc30ef8c5aed70a9';
            // Get document from database
            const db = (0, connection_1.getConnection)();
            const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
            if (!docs || docs.length === 0) {
                return res.status(404).send('Document not found');
            }
            const doc = docs[0];
            const userName = req.user ? req.user.username : 'Guest';
            const config = (0, config_1.loadConfig)();
            const isAdmin = req.user?.role === 'admin';
            const darkMode = config.ui.theme === 'dark' || (config.ui.theme === 'auto' && req.headers['prefers-color-scheme'] === 'dark');
            // Generate a viewer HTML page with the specific document loaded
            const viewerHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${doc.name} - Documind PDF Editor</title>
  <link rel="stylesheet" href="/pdf/webviewer/ui/style.css">
  <style>
    body, html, #viewer { height: 100%; margin: 0; padding: 0; }
    .header { 
      background: #1a1a2e; color: white; padding: 8px 16px; display: flex; 
      justify-content: space-between; align-items: center; border-bottom: 1px solid #333;
    }
    .header h3 { margin: 0; }
    .btn-close { background: none; border: none; color: white; cursor: pointer; font-size: 16px; }
    .btn-close:hover { color: #ff6b6b; }
    .btn-action { 
      background: #0f3460; color: white; border: none; border-radius: 4px; 
      padding: 6px 12px; margin-left: 8px; cursor: pointer; 
    }
    .btn-action:hover { background: #16213e; }
    .btn-primary { background: #e94560; }
    .btn-primary:hover { background: #d83a56; }
    .documind-toolbar {
      background: #16213e;
      color: white;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .toolbar-section {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .ai-processing {
      display: none;
      background: rgba(23, 44, 60, 0.9);
      color: white;
      padding: 20px;
      border-radius: 8px;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 1000;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
    }
    /* Modern dark theme styles */
    .ui-dark-mode .Header { background: #1a1a2e !important; }
    .ui-dark-mode .ToolGroupButton { background: #0f3460 !important; }
    .ui-dark-mode .Button { background: #16213e !important; color: white !important; }
    .ui-dark-mode .Button:hover { background: #0f3460 !important; }
    .ui-dark-mode .MenuItem { background: #1a1a2e !important; color: white !important; }
    .ui-dark-mode .MenuItem:hover { background: #0f3460 !important; }
  </style>
</head>
<body>
  <div class="documind-toolbar">
    <div class="toolbar-section">
      <h3>${doc.name}</h3>
    </div>
    <div class="toolbar-section">
      <button id="btn-ai-summary" class="btn-action">AI Summary</button>
      <button id="btn-ai-extract" class="btn-action">Extract Data</button>
      <button id="btn-ai-ocr" class="btn-action">OCR</button>
      <button class="btn-action btn-primary" onclick="window.close()">Close</button>
    </div>
  </div>
  
  <div id="viewer"></div>
  
  <div id="ai-processing" class="ai-processing">
    <h3>AI Processing...</h3>
    <div id="ai-status">Analyzing document content</div>
    <div style="margin-top: 15px;">
      <div style="width: 60px; height: 60px; border: 5px solid #e94560; border-top-color: transparent; border-radius: 50%; margin: 0 auto; animation: spin 1s linear infinite;"></div>
    </div>
  </div>

  <script src="/pdf/webviewer/lib/webviewer.min.js"></script>
  <script>
    // Animation for loading spinner
    document.head.insertAdjacentHTML('beforeend', 
      '<style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>'
    );

    // Initialize the WebViewer
    WebViewer({
      path: '/pdf/webviewer',
      licenseKey: '${licenseKey}',
      initialDoc: '/api/documents/${documentId}/raw',
      fullAPI: true,
      enableAnnotations: true,
      enableRedaction: ${isAdmin},
      annotationUser: '${userName}',
      autoSaveTimeout: 3000,
      css: 'body { --theme-background: #1a1a2e; --theme-primary: #e94560; --theme-secondary: #0f3460; }',
      ui: '${darkMode ? 'dark' : 'light'}'
    }, document.getElementById('viewer')).then(instance => {
      // Store the WebViewer instance for later use
      window.instance = instance;
      
      // Access the various modules
      const { Core, UI, annotManager, docViewer } = instance;
      
      // Add custom class for our dark mode styling
      if (${darkMode}) {
        document.body.classList.add('ui-dark-mode');
      }
      
      // Show AI processing dialog
      function showAIProcessing(message) {
        document.getElementById('ai-status').textContent = message;
        document.getElementById('ai-processing').style.display = 'block';
      }
      
      // Hide AI processing dialog
      function hideAIProcessing() {
        document.getElementById('ai-processing').style.display = 'none';
      }

      // Setup AI Summary button
      document.getElementById('btn-ai-summary').addEventListener('click', async () => {
        try {
          showAIProcessing('Generating document summary...');
          
          // Call the AI summary endpoint
          const response = await fetch('/api/documents/${documentId}/ai/summary');
          if (!response.ok) throw new Error('Failed to generate summary');
          
          const summaryData = await response.json();
          hideAIProcessing();
          
          // Create a notes panel with the summary
          if (summaryData.summary) {
            const summaryContent = \`
              <h3>AI-Generated Summary</h3>
              <p>\${summaryData.summary}</p>
              <h4>Key Points:</h4>
              <ul>\${summaryData.keyPoints.map(point => \`<li>\${point}</li>\`).join('')}</ul>
            \`;
            
            UI.openElements(['notesPanel']);
            const notesPanel = UI.getAnnotationNotesPanelElement();
            
            // Create a custom note in the notes panel
            const noteElement = document.createElement('div');
            noteElement.innerHTML = summaryContent;
            noteElement.className = 'custom-note';
            noteElement.style.padding = '10px';
            noteElement.style.margin = '10px';
            noteElement.style.border = '1px solid #ccc';
            noteElement.style.borderRadius = '5px';
            
            notesPanel.appendChild(noteElement);
          } else {
            UI.showErrorMessage('Could not generate summary. Try again later.');
          }
        } catch (error) {
          console.error('Error generating AI summary:', error);
          hideAIProcessing();
          UI.showErrorMessage('Error generating summary: ' + error.message);
        }
      });

      // Setup AI Extract Data button
      document.getElementById('btn-ai-extract').addEventListener('click', async () => {
        try {
          showAIProcessing('Extracting data from document...');
          
          // Call the AI analysis endpoint
          const response = await fetch('/api/documents/${documentId}/ai/analysis');
          if (!response.ok) throw new Error('Failed to extract data');
          
          const analysisData = await response.json();
          hideAIProcessing();
          
          // Create a modal with the extracted data
          if (analysisData) {
            // Format entities for display
            const entitiesHTML = analysisData.entities?.map(entity => 
              \`<div><b>\${entity.name}</b> (\${entity.type}) - Importance: \${entity.importance}/10</div>\`
            ).join('') || 'No entities found';
            
            // Create modal content
            const modalHTML = \`
              <div style="max-height: 70vh; overflow-y: auto; padding: 10px;">
                <h3>Document Analysis</h3>
                
                <h4>Topics:</h4>
                <ul>\${(analysisData.topics || []).map(topic => \`<li>\${topic}</li>\`).join('')}</ul>
                
                <h4>Key Entities:</h4>
                <div>\${entitiesHTML}</div>
                
                <h4>Sentiment:</h4>
                <div>Score: \${analysisData.sentiment?.score || 0} (\${analysisData.sentiment?.label || 'neutral'})</div>
                
                <h4>Complexity:</h4>
                <div>Score: \${analysisData.complexity?.score || 0.5} (\${analysisData.complexity?.label || 'moderate'})</div>
              </div>
            \`;
            
            instance.UI.openModal({
              title: 'AI Data Extraction',
              message: modalHTML
            });
          } else {
            UI.showErrorMessage('Could not extract data. Try again later.');
          }
        } catch (error) {
          console.error('Error extracting data:', error);
          hideAIProcessing();
          UI.showErrorMessage('Error extracting data: ' + error.message);
        }
      });

      // Setup OCR button
      document.getElementById('btn-ai-ocr').addEventListener('click', async () => {
        try {
          // Check if this is a PDF with text already
          const text = await docViewer.getDocument().getText();
          if (text && text.length > 100) {
            // Confirm if user wants to run OCR anyway
            if (!confirm('This document already contains text. Do you want to run OCR anyway?')) {
              return;
            }
          }
          
          showAIProcessing('Running OCR on document...');
          
          // Call the OCR endpoint
          const formData = new FormData();
          formData.append('documentId', '${documentId}');
          
          const response = await fetch('/api/documents/${documentId}/ocr', {
            method: 'POST'
          });
          
          if (!response.ok) throw new Error('Failed to run OCR');
          
          const result = await response.json();
          hideAIProcessing();
          
          // Reload the document to show OCR results
          if (result.success) {
            UI.showSuccessMessage('OCR completed. Reloading document...');
            setTimeout(() => {
              docViewer.loadDocument('/api/documents/${documentId}/raw?t=' + Date.now());
            }, 1500);
          } else {
            UI.showErrorMessage('OCR failed: ' + (result.error || 'Unknown error'));
          }
        } catch (error) {
          console.error('Error running OCR:', error);
          hideAIProcessing();
          UI.showErrorMessage('Error running OCR: ' + error.message);
        }
      });

      // Setup document save handler
      instance.docViewer.on('documentChanged', () => {
        console.log('Document changed');
        
        // Save annotations when document changes
        instance.annotManager.on('annotationChanged', async () => {
          console.log('Annotations changed');
          try {
            const xfdf = await instance.annotManager.exportAnnotations();
            
            // Send annotations to server
            fetch('/api/documents/${documentId}/annotations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ annotations: xfdf })
            });
          } catch (e) {
            console.error('Error saving annotations', e);
          }
        });
      });

      // Load existing annotations if available
      fetch('/api/documents/${documentId}/annotations')
        .then(response => response.json())
        .then(data => {
          if (data.annotations) {
            instance.annotManager.importAnnotations(data.annotations);
          }
        })
        .catch(error => {
          console.error('Error loading annotations:', error);
        });

      // Set up custom toolbar with advanced options
      UI.setHeaderItems(header => {
        // Add a save button
        header.push({
          type: 'actionButton',
          img: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>',
          title: 'Save document',
          onClick: async () => {
            const doc = instance.docViewer.getDocument();
            const data = await doc.getFileData();
            const blob = new Blob([data], { type: 'application/pdf' });
            
            // Show saving indicator
            UI.openElement('loadingModal');
            
            // Save to server
            const formData = new FormData();
            formData.append('file', blob, '${doc.name}');
            
            try {
              const response = await fetch('/api/documents/${documentId}/update', {
                method: 'POST',
                body: formData
              });
              
              if (response.ok) {
                UI.closeElement('loadingModal');
                UI.showSuccessMessage('Document saved successfully');
              } else {
                UI.closeElement('loadingModal');
                UI.showErrorMessage('Failed to save document');
              }
            } catch (error) {
              UI.closeElement('loadingModal');
              UI.showErrorMessage('Error saving document: ' + error.message);
            }
          }
        });
        
        // Add download button
        header.push({
          type: 'actionButton',
          img: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>',
          title: 'Download document',
          onClick: async () => {
            const doc = instance.docViewer.getDocument();
            const data = await doc.getFileData();
            const blob = new Blob([data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '${doc.name}';
            a.click();
            URL.revokeObjectURL(url);
          }
        });
      });
    });
  </script>
</body>
</html>`;
            res.send(viewerHtml);
        }
        catch (error) {
            logger_1.logger.error('Error generating PDF viewer:', error);
            res.status(500).send('Error generating PDF viewer');
        }
    });
    // Endpoint to save annotations
    exports.apryseRouter.post('/documents/:id/annotations', async (req, res) => {
        try {
            const documentId = req.params.id;
            const { annotations } = req.body;
            if (!annotations) {
                return res.status(400).json({ error: 'No annotations provided' });
            }
            const db = (0, connection_1.getConnection)();
            // Save annotations to database
            await db.query(`INSERT INTO document_annotations (document_id, user_id, annotations, created_at)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE annotations = ?, updated_at = ?`, [
                documentId,
                req.user?.id || null,
                annotations,
                new Date(),
                annotations,
                new Date()
            ]);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error('Error saving annotations:', error);
            res.status(500).json({ error: 'Failed to save annotations' });
        }
    });
    // Endpoint to get annotations
    exports.apryseRouter.get('/documents/:id/annotations', async (req, res) => {
        try {
            const documentId = req.params.id;
            const db = (0, connection_1.getConnection)();
            const results = await db.query('SELECT * FROM document_annotations WHERE document_id = ?', [documentId]);
            if (results && results.length > 0) {
                res.json({ annotations: results[0].annotations });
            }
            else {
                res.json({ annotations: null });
            }
        }
        catch (error) {
            logger_1.logger.error('Error getting annotations:', error);
            res.status(500).json({ error: 'Failed to get annotations' });
        }
    });
    // New endpoint for AI-powered OCR
    exports.apryseRouter.post('/documents/:id/ocr', async (req, res) => {
        try {
            const documentId = req.params.id;
            const db = (0, connection_1.getConnection)();
            // Get document from database
            const docs = await db.query('SELECT * FROM documents WHERE id = ?', [documentId]);
            if (!docs || docs.length === 0) {
                return res.status(404).json({ error: 'Document not found' });
            }
            const doc = docs[0];
            // Process OCR using appropriate service based on config
            logger_1.logger.info(`Processing OCR for document ${documentId}`);
            // Execute OCR (implementation depends on your OCR service)
            // This is a placeholder - you would call your actual OCR service
            await processOcr(doc.path, documentId);
            res.json({ success: true });
        }
        catch (error) {
            logger_1.logger.error(`Error processing OCR for document ${req.params.id}:`, error);
            res.status(500).json({ error: 'Failed to process OCR', details: error.message });
        }
    });
}
/**
 * Process OCR on a document
 * @param filePath Path to the document file
 * @param documentId Document ID
 */
async function processOcr(filePath, documentId) {
    // This is a placeholder for the actual OCR implementation
    // You would use a library like Tesseract.js, or call an external OCR API
    // Example OCR processing logic:
    // 1. Read the PDF file
    // 2. Extract images from pages
    // 3. Process OCR on images
    // 4. Create a new PDF with text layer
    // 5. Save the new PDF
    // For now, we'll just log and delay to simulate processing
    logger_1.logger.info(`OCR processing started for document ${documentId} at ${filePath}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    logger_1.logger.info(`OCR processing completed for document ${documentId}`);
}
