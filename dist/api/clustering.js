"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusteringRouter = void 0;
const express_1 = __importDefault(require("express"));
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const documentClustering_1 = require("../clustering/documentClustering");
exports.clusteringRouter = express_1.default.Router();
// Get document clusters
exports.clusteringRouter.get('/clusters', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('get-document-clusters');
        const userId = req.user.id;
        const refresh = req.query.refresh === 'true';
        // Get clusters, optionally refreshing them
        let clusters;
        if (refresh) {
            clusters = await (0, documentClustering_1.createDocumentClusters)(userId);
        }
        else {
            clusters = await (0, documentClustering_1.getDocumentClusters)(userId);
        }
        logger_1.logger.info(`Retrieved ${clusters.length} document clusters in ${perfEnd()}ms`);
        res.json({ clusters });
    }
    catch (error) {
        logger_1.logger.error('Error getting document clusters:', error);
        res.status(500).json({ error: 'Failed to get document clusters' });
    }
});
// Refresh document clusters
exports.clusteringRouter.post('/clusters/refresh', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('refresh-document-clusters');
        const userId = req.user.id;
        // Create new clusters
        const clusters = await (0, documentClustering_1.createDocumentClusters)(userId);
        logger_1.logger.info(`Refreshed ${clusters.length} document clusters in ${perfEnd()}ms`);
        res.json({
            success: true,
            clusters,
            message: `Created ${clusters.length} document clusters based on content similarity`
        });
    }
    catch (error) {
        logger_1.logger.error('Error refreshing document clusters:', error);
        res.status(500).json({ error: 'Failed to refresh document clusters' });
    }
});
