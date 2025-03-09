import express from 'express';
import { semanticSearch, SemanticSearchOptions } from '../search/semanticSearch';
import { isAuthenticated } from '../auth/auth';
import { logger, performance } from '../utils/logger';
import { getConnection } from '../database/connection';

export const advancedSearchRouter = express.Router();

// Get filter options for search interface
advancedSearchRouter.get('/filters', isAuthenticated, async (req, res) => {
    try {
        const db = getConnection();
        const userId = (req.user as any).id;

        // Get document types
        const docTypesQuery = `
      SELECT DISTINCT
        CASE 
          WHEN mime_type LIKE '%pdf%' THEN 'PDF'
          WHEN mime_type LIKE '%doc%' THEN 'Word'
          WHEN mime_type LIKE '%xls%' THEN 'Excel'
          WHEN mime_type LIKE '%ppt%' THEN 'PowerPoint'
          WHEN mime_type LIKE '%image%' THEN 'Image'
          WHEN mime_type LIKE '%text%' THEN 'Text'
          ELSE 'Other'
        END as type
      FROM documents d
      WHERE d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      )
    `;
        const documentTypes = await db.query(docTypesQuery, [userId, userId]);

        // Get folders
        const foldersQuery = `
      SELECT id, name
      FROM folders
      WHERE created_by = ? OR id IN (
        SELECT folder_id FROM folder_shares WHERE shared_with = ?
      )
      ORDER BY name
    `;
        const folders = await db.query(foldersQuery, [userId, userId]);

        // Get entities for filtering
        const entitiesQuery = `
      SELECT DISTINCT e.type, COUNT(*) as count
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN documents d ON de.document_id = d.id
      WHERE d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      )
      GROUP BY e.type
      ORDER BY count DESC
    `;
        const entityTypes = await db.query(entitiesQuery, [userId, userId]);

        res.json({
            documentTypes: documentTypes.map((t: any) => t.type),
            folders,
            entityTypes: entityTypes.map((t: any) => ({
                type: t.type,
                count: t.count
            }))
        });
    } catch (error) {
        logger.error('Error fetching search filters:', error);
        res.status(500).json({ error: 'Failed to fetch search filters' });
    }
});

// Perform advanced search
advancedSearchRouter.post('/search', isAuthenticated, async (req, res) => {
    try {
        const perfEnd = performance.start('advanced-search');
        const userId = (req.user as any).id;
        const {
            query,
            page = 1,
            pageSize = 10,
            folderId,
            dateFrom,
            dateTo,
            fileTypes = [],
            entityTypes = [],
            importanceMin,
            useSemantic = true
        } = req.body;

        // Basic validation
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({
                error: 'Search query is required'
            });
        }

        // Build search options
        const searchOptions: SemanticSearchOptions = {
            query,
            page,
            pageSize,
            userId,
            useAI: useSemantic
        };

        // Add filters
        if (folderId) {
            searchOptions.folderId = parseInt(folderId);
        }

        if (dateFrom) {
            searchOptions.dateFrom = new Date(dateFrom);
        }

        if (dateTo) {
            searchOptions.dateTo = new Date(dateTo);
        }

        if (fileTypes && fileTypes.length > 0) {
            searchOptions.fileTypes = fileTypes;
        }

        // Perform search
        const results = await semanticSearch(searchOptions);

        // Add entity filters if needed (post-search filtering)
        if (entityTypes && entityTypes.length > 0) {
            const filteredResults = await filterResultsByEntityTypes(results.results, entityTypes, userId);
            results.results = filteredResults;
            results.total = filteredResults.length;
        }

        // If importance filter specified, filter results
        if (importanceMin !== undefined && importanceMin > 0) {
            const filteredResults = await filterResultsByImportance(results.results, importanceMin, userId);
            results.results = filteredResults;
            results.total = filteredResults.length;
        }

        logger.info(`Advanced search completed in ${perfEnd()}ms, found ${results.total} results`);
        res.json(results);

    } catch (error) {
        logger.error('Error performing advanced search:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Filter search results by entity types
async function filterResultsByEntityTypes(results: any[], entityTypes: string[], userId: number) {
    if (!entityTypes.length) return results;

    const db = getConnection();
    const filteredResults = [];

    for (const result of results) {
        const query = `
      SELECT COUNT(*) as hasEntity 
      FROM document_entities de
      JOIN case_entities e ON de.entity_id = e.id
      WHERE de.document_id = ? 
      AND e.type IN (${entityTypes.map(() => '?').join(',')})
    `;

        const params = [result.documentId, ...entityTypes];
        const entityCheck = await db.query(query, params);

        if (entityCheck[0].hasEntity > 0) {
            filteredResults.push(result);
        }
    }

    return filteredResults;
}

// Filter search results by minimum importance
async function filterResultsByImportance(results: any[], importanceMin: number, userId: number) {
    if (!importanceMin) return results;

    const db = getConnection();
    const filteredResults = [];

    for (const result of results) {
        const query = `
      SELECT AVG(e.importance) as avg_importance
      FROM document_entities de
      JOIN case_entities e ON de.entity_id = e.id
      WHERE de.document_id = ?
    `;

        const importanceCheck = await db.query(query, [result.documentId]);
        const avgImportance = importanceCheck[0]?.avg_importance || 0;

        if (avgImportance >= importanceMin) {
            filteredResults.push(result);
        }
    }

    return filteredResults;
}
