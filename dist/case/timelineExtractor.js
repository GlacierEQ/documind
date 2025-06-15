"use strict";
/**
 * Timeline Event Extractor for legal documents
 * Extracts events, dates, and important milestones from document content
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTimelineFromDocument = extractTimelineFromDocument;
exports.getCaseTimeline = getCaseTimeline;
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const chrono_node_1 = __importDefault(require("chrono-node"));
// Event patterns to look for in documents
const EVENT_PATTERNS = [
    {
        type: 'hearing',
        patterns: [
            /(?:hearing|oral\s+argument)\s+(?:date|scheduled|set)?\s*(?:for|on)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:on|dated?)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+(?:a|the)\s+hearing/gi
        ]
    },
    {
        type: 'filing',
        patterns: [
            /(?:filed|submitted|lodged)\s+(?:on|dated?)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:on|dated?)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+(?:plaintiff|defendant|petitioner|respondent|party|counsel)\s+filed/gi
        ]
    },
    {
        type: 'deadline',
        patterns: [
            /(?:due|deadline|response\s+due)\s+(?:date|on|by)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:must\s+(?:be\s+)?(?:filed|submitted|responded|completed))\s+(?:on|by|before)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi
        ]
    },
    {
        type: 'trial',
        patterns: [
            /(?:trial\s+(?:date|scheduled|set))\s*(?:for|on)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:on|dated?)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+(?:a|the)\s+trial/gi
        ]
    },
    {
        type: 'document-date',
        patterns: [
            /(?:dated\s+(?:this)?\s+(?:the)?\s*)(\d{1,2}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?[A-Za-z]+,?\s+\d{4})/gi,
            /(?:executed\s+(?:this|on|as\s+of)\s+(?:the)?\s*)(\d{1,2}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?[A-Za-z]+,?\s+\d{4})/gi
        ]
    },
    {
        type: 'document-execution',
        patterns: [
            /(?:executed|signed)\s+(?:by|on|as\s+of)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:dated\s+and\s+signed\s+)(?:on|as\s+of)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi
        ]
    },
    {
        type: 'meeting',
        patterns: [
            /(?:meeting|conference)\s+(?:held|scheduled|occurred|took\s+place)\s+(?:on|for)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
            /(?:on|dated?)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+(?:a|the)\s+meeting/gi
        ]
    }
];
// Legal holidays to identify
const HOLIDAYS = [
    { name: 'New Year\'s Day', pattern: /(?:January|Jan\.?)\s+1(?:st)?/i },
    { name: 'Martin Luther King Jr. Day', pattern: /(?:MLK|Martin\s+Luther\s+King|MLK\s+Day)/i },
    { name: 'Presidents\' Day', pattern: /Presidents(?:\'|s|\s+Day)/i },
    { name: 'Memorial Day', pattern: /Memorial\s+Day/i },
    { name: 'Independence Day', pattern: /(?:July|Jul\.?)\s+4(?:th)?|Independence\s+Day/i },
    { name: 'Labor Day', pattern: /Labor\s+Day/i },
    { name: 'Veterans Day', pattern: /Veterans(?:\'|s|\s+Day)/i },
    { name: 'Thanksgiving', pattern: /Thanksgiving(?:\s+Day)?/i },
    { name: 'Christmas', pattern: /(?:December|Dec\.?)\s+25(?:th)?|Christmas(?:\s+Day)?/i }
];
/**
 * Extract timeline events from document text
 */
async function extractTimelineFromDocument(documentId, text) {
    if (!text) {
        logger_1.logger.warn(`No text provided for timeline extraction, document ID: ${documentId}`);
        return [];
    }
    const perfEnd = logger_1.performance.start('timeline-extraction');
    const db = (0, connection_1.getConnection)();
    const events = [];
    try {
        // Clean and normalize the text
        const normalizedText = text
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // Process each event pattern
        for (const eventDef of EVENT_PATTERNS) {
            for (const pattern of eventDef.patterns) {
                pattern.lastIndex = 0; // Reset regex state
                let match;
                while ((match = pattern.exec(normalizedText)) !== null) {
                    try {
                        // Extract the date string
                        const dateString = match[1];
                        // Parse the date using Chrono
                        const parsedDates = chrono_node_1.default.parse(dateString);
                        if (parsedDates.length > 0) {
                            const eventDate = parsedDates[0].start.date();
                            // Get context around the match
                            const matchIndex = match.index;
                            const contextStart = Math.max(0, matchIndex - 100);
                            const contextEnd = Math.min(normalizedText.length, matchIndex + match[0].length + 100);
                            const context = normalizedText.substring(contextStart, contextEnd);
                            // Determine importance based on event type
                            let importance = 5; // Default importance
                            if (eventDef.type === 'trial' || eventDef.type === 'hearing') {
                                importance = 8;
                            }
                            else if (eventDef.type === 'deadline') {
                                importance = 7;
                            }
                            else if (eventDef.type === 'filing') {
                                importance = 6;
                            }
                            // Check if this is a holiday
                            for (const holiday of HOLIDAYS) {
                                if (holiday.pattern.test(dateString)) {
                                    importance = 4; // Lower importance for holidays
                                    break;
                                }
                            }
                            // Create event object
                            const event = {
                                documentId,
                                type: eventDef.type.charAt(0).toUpperCase() + eventDef.type.slice(1),
                                eventType: eventDef.type,
                                date: eventDate,
                                description: match[0].trim(),
                                importance,
                                context
                            };
                            // Check for duplicate events (same date and type)
                            const isDuplicate = events.some(e => e.eventType === event.eventType &&
                                e.date.toDateString() === event.date.toDateString() &&
                                e.description === event.description);
                            if (!isDuplicate) {
                                events.push(event);
                            }
                        }
                    }
                    catch (error) {
                        logger_1.logger.warn(`Error parsing date in timeline extraction: ${match[1]}`, error);
                    }
                }
            }
        }
        // Also try to extract any NLP-identified dates that might have been missed
        const allMatches = normalizedText.match(/[A-Z][a-z]+ \d{1,2}, \d{4}/g) || [];
        for (const dateStr of allMatches) {
            try {
                const parsedDates = chrono_node_1.default.parse(dateStr);
                if (parsedDates.length > 0) {
                    const eventDate = parsedDates[0].start.date();
                    // Get context around the date
                    const dateIndex = normalizedText.indexOf(dateStr);
                    const contextStart = Math.max(0, dateIndex - 50);
                    const contextEnd = Math.min(normalizedText.length, dateIndex + dateStr.length + 100);
                    const context = normalizedText.substring(contextStart, contextEnd);
                    // Determine if this looks like a meaningful event
                    // (We're looking for verb patterns near the date)
                    const verbPatterns = /(?:filed|issued|ordered|signed|held|scheduled|due|executed)/i;
                    if (verbPatterns.test(context)) {
                        // Try to identify the event type from context
                        let eventType = 'document-date';
                        if (/hearing|argument/i.test(context)) {
                            eventType = 'hearing';
                        }
                        else if (/trial/i.test(context)) {
                            eventType = 'trial';
                        }
                        else if (/filed|filing/i.test(context)) {
                            eventType = 'filing';
                        }
                        else if (/due|deadline/i.test(context)) {
                            eventType = 'deadline';
                        }
                        else if (/meeting|conference/i.test(context)) {
                            eventType = 'meeting';
                        }
                        // Create event object
                        const event = {
                            documentId,
                            type: eventType.charAt(0).toUpperCase() + eventType.slice(1).replace(/\-/g, ' '),
                            eventType,
                            date: eventDate,
                            description: context.substring(0, 150).trim(),
                            importance: 4,
                            context
                        };
                        // Check for duplicate events
                        const isDuplicate = events.some(e => e.eventType === event.eventType &&
                            e.date.toDateString() === event.date.toDateString());
                        if (!isDuplicate) {
                            events.push(event);
                        }
                    }
                }
            }
            catch (error) {
                logger_1.logger.warn(`Error parsing additional date in timeline extraction: ${dateStr}`, error);
            }
        }
        // Save events to database
        for (const event of events) {
            try {
                const result = await db.query(`INSERT INTO timeline_events 
           (document_id, event_type, event_date, description, importance, context, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                    event.documentId,
                    event.eventType,
                    event.date,
                    event.description,
                    event.importance,
                    event.context || '',
                    new Date()
                ]);
                event.id = result.insertId || result.lastID;
            }
            catch (error) {
                logger_1.logger.error(`Error saving timeline event to database:`, error);
            }
        }
        logger_1.logger.info(`Extracted ${events.length} timeline events in ${perfEnd()}ms from document ${documentId}`);
        return events;
    }
    catch (error) {
        logger_1.logger.error(`Error extracting timeline from document ${documentId}:`, error);
        return [];
    }
}
/**
 * Get timeline events for a case
 */
async function getCaseTimeline(userId, days = 365) {
    const db = (0, connection_1.getConnection)();
    try {
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        // Query events from the database
        const eventsQuery = `
      SELECT te.*, d.name as document_name
      FROM timeline_events te
      JOIN documents d ON te.document_id = d.id
      WHERE (d.uploaded_by = ? OR d.id IN (
        SELECT document_id FROM document_shares WHERE shared_with = ?
      ))
      AND te.event_date BETWEEN ? AND ?
      ORDER BY te.event_date ASC
    `;
        const events = await db.query(eventsQuery, [userId, userId, startDate, endDate]);
        // Format events
        return events.map((row) => ({
            id: row.id,
            documentId: row.document_id,
            type: formatEventType(row.event_type),
            eventType: row.event_type,
            date: new Date(row.event_date),
            description: row.description,
            importance: row.importance,
            context: row.context,
            documentName: row.document_name
        }));
    }
    catch (error) {
        logger_1.logger.error('Error fetching case timeline:', error);
        return [];
    }
}
/**
 * Format event type for display
 */
function formatEventType(type) {
    return type
        .replace(/-/g, ' ')
        .replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}
