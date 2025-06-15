import express from 'express';
import { isAuthenticated } from '../auth/auth';
import { logger, performance } from '../utils/logger';
import { createDocumentClusters, getDocumentClusters } from '../clustering/documentClustering';

export const clusteringRouter = express.Router();

// Get document clusters
clusteringRouter.get('/clusters', isAuthenticated, async (req, res) => {
    try {
        const perfEnd = performance.start('get-document-clusters');
        const userId = (req.user as any).id;
        const refresh = req.query.refresh === 'true';

        // Get clusters, optionally refreshing them
        let clusters;
        if (refresh) {
            clusters = await createDocumentClusters(userId);
        } else {
            clusters = await getDocumentClusters(userId);
        }

        logger.info(`Retrieved ${clusters.length} document clusters in ${perfEnd()}ms`);
        res.json({ clusters });

    } catch (error) {
        logger.error('Error getting document clusters:', error);
        res.status(500).json({ error: 'Failed to get document clusters' });
    }
});

// Refresh document clusters
clusteringRouter.post('/clusters/refresh', isAuthenticated, async (req, res) => {
    try {
        const perfEnd = performance.start('refresh-document-clusters');
        const userId = (req.user as any).id;

        // Create new clusters
        const clusters = await createDocumentClusters(userId);

        logger.info(`Refreshed ${clusters.length} document clusters in ${perfEnd()}ms`);
        res.json({
            success: true,
            clusters,
            message: `Created ${clusters.length} document clusters based on content similarity`
        });

    } catch (error) {
        logger.error('Error refreshing document clusters:', error);
        res.status(500).json({ error: 'Failed to refresh document clusters' });
    }
});
