"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pdfDashboardRouter = void 0;
exports.setupPdfDashboard = setupPdfDashboard;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
exports.pdfDashboardRouter = express_1.default.Router();
// PDF Dashboard - Get user's recent PDF stats
exports.pdfDashboardRouter.get('/stats', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        // Get PDF document stats for the user
        const pdfStats = await db.query(`
      SELECT 
        COUNT(*) as totalPdfs,
        SUM(size) as totalSize,
        MAX(uploaded_at) as lastUploaded
      FROM documents
      WHERE mime_type = 'application/pdf' AND uploaded_by = ?
    `, [userId]);
        // Get recently accessed PDFs
        const recentPdfs = await db.query(`
      SELECT d.id, d.name, d.size, d.uploaded_at, d.indexed
      FROM documents d
      JOIN activity_log a ON d.id = a.entity_id
      WHERE d.mime_type = 'application/pdf' 
        AND a.user_id = ?
        AND a.entity_type = 'document'
      GROUP BY d.id
      ORDER BY MAX(a.created_at) DESC
      LIMIT 5
    `, [userId]);
        // Get AI processed documents
        const aiProcessed = await db.query(`
      SELECT d.id, d.name, 
        (SELECT COUNT(*) FROM ai_summaries WHERE document_id = d.id) as has_summary,
        (SELECT COUNT(*) FROM ai_analyses WHERE document_id = d.id) as has_analysis,
        (SELECT COUNT(*) FROM ai_tags WHERE document_id = d.id) as has_tags
      FROM documents d
      WHERE d.mime_type = 'application/pdf' 
        AND d.uploaded_by = ?
        AND (
          EXISTS (SELECT 1 FROM ai_summaries WHERE document_id = d.id)
          OR EXISTS (SELECT 1 FROM ai_analyses WHERE document_id = d.id)
          OR EXISTS (SELECT 1 FROM ai_tags WHERE document_id = d.id)
        )
      LIMIT 5
    `, [userId]);
        res.json({
            stats: pdfStats[0] || { totalPdfs: 0, totalSize: 0, lastUploaded: null },
            recentPdfs: recentPdfs || [],
            aiProcessed: aiProcessed || []
        });
    }
    catch (error) {
        logger_1.logger.error('Error fetching PDF dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch PDF dashboard stats' });
    }
});
// Get PDF conversion options
exports.pdfDashboardRouter.get('/conversion-options', auth_1.isAuthenticated, (req, res) => {
    // Return supported conversion formats
    res.json({
        fromPdf: ['docx', 'txt', 'png', 'jpg', 'html'],
        toPdf: ['docx', 'doc', 'xlsx', 'pptx', 'jpg', 'png', 'html']
    });
});
// PDF Dashboard - Get annotation stats
exports.pdfDashboardRouter.get('/annotation-stats', auth_1.isAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        // Get stats about annotations
        const annotationStats = await db.query(`
      SELECT 
        COUNT(DISTINCT document_id) as documents_with_annotations
      FROM document_annotations
      WHERE user_id = ?
    `, [userId]);
        res.json(annotationStats[0] || { documents_with_annotations: 0 });
    }
    catch (error) {
        logger_1.logger.error('Error fetching annotation stats:', error);
        res.status(500).json({ error: 'Failed to fetch annotation stats' });
    }
});
// Register the PDF dashboard router with the application
function setupPdfDashboard(app) {
    app.use('/api/pdf-dashboard', exports.pdfDashboardRouter);
}
