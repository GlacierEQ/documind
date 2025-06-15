"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.caseSummaryRouter = void 0;
const express_1 = __importDefault(require("express"));
const connection_1 = require("../database/connection");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const processor_1 = require("../ai/processor");
const timelineExtractor_1 = require("../case/timelineExtractor");
const deadlineTracker_1 = require("../case/deadlineTracker");
exports.caseSummaryRouter = express_1.default.Router();
// Get AI-generated case summary
exports.caseSummaryRouter.get('/summary', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('case-summary-generation');
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        const config = (0, config_1.loadConfig)();
        // Check if AI is enabled
        if (!config.ai || config.ai.provider === 'none') {
            return res.status(400).json({
                error: 'AI provider not configured',
                message: 'Please enable and configure an AI provider in your settings.'
            });
        }
        // Get case documents
        const documentsQuery = `
      SELECT d.id, d.name, d.uploaded_at, i.text_content
      FROM documents d
      LEFT JOIN document_index i ON d.id = i.document_id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND d.case_related = 1
      ORDER BY d.uploaded_at DESC
      LIMIT 50
    `;
        const documents = await db.query(documentsQuery, [userId, userId]);
        // Get key entities
        const entitiesQuery = `
      SELECT e.*, COUNT(de.document_id) as doc_count
      FROM case_entities e
      JOIN document_entities de ON e.id = de.entity_id
      JOIN documents d ON de.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      GROUP BY e.id
      ORDER BY e.importance DESC, doc_count DESC
      LIMIT 20
    `;
        const entities = await db.query(entitiesQuery, [userId, userId]);
        // Get timeline events
        const timelineEvents = await (0, timelineExtractor_1.getCaseTimeline)(userId, 90); // Last 90 days of events
        // Get upcoming deadlines
        const deadlines = await (0, deadlineTracker_1.getUpcomingDeadlines)(30); // Next 30 days of deadlines
        // Check for cache first before generating summary
        const cachedSummary = await db.query('SELECT * FROM case_summaries WHERE user_id = ? AND created_at > ?', [userId, new Date(Date.now() - 24 * 60 * 60 * 1000)] // Last 24 hours
        );
        let caseSummary;
        // If we have a recent cached summary, use it
        if (cachedSummary && cachedSummary.length > 0) {
            caseSummary = {
                overview: cachedSummary[0].overview,
                keyFacts: JSON.parse(cachedSummary[0].key_facts),
                keyIssues: JSON.parse(cachedSummary[0].key_issues),
                recommendations: JSON.parse(cachedSummary[0].recommendations),
                createdAt: new Date(cachedSummary[0].created_at)
            };
        }
        else {
            // Generate case summary using AI
            const summaryContent = await generateCaseSummary(documents, entities, timelineEvents, deadlines);
            // Store in database for caching
            await db.query(`INSERT INTO case_summaries
         (user_id, overview, key_facts, key_issues, recommendations, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`, [
                userId,
                summaryContent.overview,
                JSON.stringify(summaryContent.keyFacts),
                JSON.stringify(summaryContent.keyIssues),
                JSON.stringify(summaryContent.recommendations),
                new Date()
            ]);
            caseSummary = summaryContent;
        }
        const entitiesByType = entities.reduce((acc, entity) => {
            if (!acc[entity.type])
                acc[entity.type] = [];
            acc[entity.type].push({
                id: entity.id,
                name: entity.name,
                importance: entity.importance,
                documentCount: entity.doc_count
            });
            return acc;
        }, {});
        logger_1.logger.info(`Generated case summary in ${perfEnd()}ms`);
        res.json({
            summary: caseSummary,
            documentCount: documents.length,
            entities: entitiesByType,
            recentEvents: timelineEvents.slice(0, 5),
            upcomingDeadlines: deadlines.slice(0, 5)
        });
    }
    catch (error) {
        logger_1.logger.error('Error generating case summary:', error);
        res.status(500).json({ error: 'Failed to generate case summary' });
    }
});
/**
 * Generate a case summary using AI processing
 */
async function generateCaseSummary(documents, entities, timelineEvents, deadlines) {
    const config = (0, config_1.loadConfig)();
    try {
        // Create a summary context for the AI to use
        const context = createSummaryContext(documents, entities, timelineEvents, deadlines);
        // Use AI processor to generate summary
        const prompt = `
      I need a comprehensive legal case summary based on the following context:
      
      ${context}
      
      Please provide:
      1. A concise overview of the case (3-4 paragraphs)
      2. Key facts (bullet points)
      3. Key legal issues (bullet points)
      4. Recommendations or next steps (bullet points)
      
      Format your response in JSON as follows:
      {
        "overview": "The overview text...",
        "keyFacts": ["Fact 1", "Fact 2", ...],
        "keyIssues": ["Issue 1", "Issue 2", ...],
        "recommendations": ["Recommendation 1", "Recommendation 2", ...]
      }
    `;
        const summaryText = await (0, processor_1.summarizeDocument)(prompt, config.ai.maxTokens || 2000);
        // Parse the JSON response
        let summaryJson;
        try {
            // Find JSON in the response (in case the AI added extra text)
            const jsonMatch = summaryText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                summaryJson = JSON.parse(jsonMatch[0]);
            }
            else {
                throw new Error('No JSON found in response');
            }
        }
        catch (parseError) {
            logger_1.logger.error('Error parsing AI summary response:', parseError);
            // Fallback to a structured approach if JSON parsing fails
            return {
                overview: extractSection(summaryText, 'overview') || 'No overview available.',
                keyFacts: extractListItems(summaryText, 'key facts'),
                keyIssues: extractListItems(summaryText, 'key legal issues'),
                recommendations: extractListItems(summaryText, 'recommendations') || extractListItems(summaryText, 'next steps'),
                createdAt: new Date()
            };
        }
        return {
            overview: summaryJson.overview || 'No overview available.',
            keyFacts: summaryJson.keyFacts || [],
            keyIssues: summaryJson.keyIssues || [],
            recommendations: summaryJson.recommendations || [],
            createdAt: new Date()
        };
    }
    catch (error) {
        logger_1.logger.error('Error generating AI case summary:', error);
        // Return a fallback summary
        return {
            overview: 'Unable to generate case summary due to an error. Please try again later.',
            keyFacts: ['No facts could be automatically extracted'],
            keyIssues: ['No issues could be automatically identified'],
            recommendations: ['Please review your documents manually'],
            createdAt: new Date()
        };
    }
}
/**
 * Create a context for AI summary generation
 */
function createSummaryContext(documents, entities, timelineEvents, deadlines) {
    // Start with basic document stats
    let context = `Documents reviewed: ${documents.length}\n\n`;
    // Add document contents (limited)
    if (documents.length > 0) {
        context += `Document summaries:\n`;
        documents.slice(0, 10).forEach((doc, idx) => {
            if (doc.text_content) {
                // Limit text to prevent excessive token usage
                const textSummary = doc.text_content.substring(0, 800) + (doc.text_content.length > 800 ? '...' : '');
                context += `Document ${idx + 1}: ${doc.name}\n${textSummary}\n\n`;
            }
            else {
                context += `Document ${idx + 1}: ${doc.name} (No text content available)\n\n`;
            }
        });
    }
    // Add key entities
    if (entities.length > 0) {
        context += `Key entities:\n`;
        const importantEntities = entities.filter((e) => e.importance >= 7);
        importantEntities.forEach((entity) => {
            context += `- ${entity.name} (${entity.type})\n`;
        });
        context += '\n';
    }
    // Add recent timeline events
    if (timelineEvents.length > 0) {
        context += `Recent timeline events:\n`;
        timelineEvents.slice(0, 7).forEach(event => {
            const date = new Date(event.date).toLocaleDateString();
            context += `- ${date}: ${event.description}\n`;
        });
        context += '\n';
    }
    // Add upcoming deadlines
    if (deadlines.length > 0) {
        context += `Upcoming deadlines:\n`;
        deadlines.forEach(deadline => {
            const date = new Date(deadline.deadline).toLocaleDateString();
            context += `- ${date}: ${deadline.description}\n`;
        });
        context += '\n';
    }
    return context;
}
/**
 * Helper to extract a section from unstructured text
 */
function extractSection(text, sectionName) {
    const regex = new RegExp(`(?:^|\\n)\\s*(?:\\d\\.\\s*)?${sectionName}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\d\\.\\s*)?\\w+\\s*:|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}
/**
 * Helper to extract list items from unstructured text
 */
function extractListItems(text, listName) {
    // Find the section
    const section = extractSection(text, listName);
    if (!section)
        return [];
    // Extract bullet points
    const bulletItems = section.split(/\n\s*[•\-*]\s*/).filter(Boolean);
    if (bulletItems.length > 1)
        return bulletItems.map(item => item.trim());
    // Try numbered items if bullet points aren't found
    const numberedItems = section.split(/\n\s*\d+\.\s*/).filter(Boolean);
    return numberedItems.map(item => item.trim());
}
