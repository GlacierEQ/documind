import express from 'express';
import { getConnection } from '../database/connection';
import { isAuthenticated } from '../auth/auth';
import { logger } from '../utils/logger';

export const pdfDashboardRouter = express.Router();

// PDF Dashboard - Get user's recent PDF stats
pdfDashboardRouter.get('/stats', isAuthenticated, async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const db = getConnection();

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
    } catch (error) {
        logger.error('Error fetching PDF dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch PDF dashboard stats' });
    }
});

// Get PDF conversion options
pdfDashboardRouter.get('/conversion-options', isAuthenticated, (req, res) => {
    // Return supported conversion formats
    res.json({
        fromPdf: ['docx', 'txt', 'png', 'jpg', 'html'],
        toPdf: ['docx', 'doc', 'xlsx', 'pptx', 'jpg', 'png', 'html']
    });
});

// PDF Dashboard - Get annotation stats
pdfDashboardRouter.get('/annotation-stats', isAuthenticated, async (req, res) => {
    try {
        const userId = (req.user as any).id;
        const db = getConnection();

        // Get stats about annotations
        const annotationStats = await db.query(`
      SELECT 
        COUNT(DISTINCT document_id) as documents_with_annotations
      FROM document_annotations
      WHERE user_id = ?
    `, [userId]);

        res.json(annotationStats[0] || { documents_with_annotations: 0 });
    } catch (error) {
        logger.error('Error fetching annotation stats:', error);
        res.status(500).json({ error: 'Failed to fetch annotation stats' });
    }
});

// Register the PDF dashboard router with the application
export function setupPdfDashboard(app: express.Application): void {
    app.use('/api/pdf-dashboard', pdfDashboardRouter);
}
