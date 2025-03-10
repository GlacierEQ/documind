"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractLegalDeadlines = extractLegalDeadlines;
exports.getUpcomingDeadlines = getUpcomingDeadlines;
const connection_1 = require("../database/connection");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const googleCalendar_1 = require("../integration/googleCalendar");
const knowledgeBase_1 = require("./knowledgeBase");
const chrono_node_1 = __importDefault(require("chrono-node"));
// Common legal deadline patterns (these depend on jurisdiction and case types)
const DEADLINE_PATTERNS = [
    /respond\s+within\s+(\d+)\s+(day|days|business\s+day|business\s+days)/gi,
    /response\s+due\s+(?:by|on|before)?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /(\d{1,2})(?:st|nd|rd|th)?\s+day\s+(?:to|for)\s+(?:respond|file|answer)/gi,
    /(?:due|file|submit|respond)\s+(?:by|on|before)?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /(\d+)[-\s]day\s+deadline/gi,
    /deadline[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /hearing\s+(?:date|scheduled)?\s+(?:for|on)?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /motion\s+hearing\s+(?:on|set\s+for)?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /(?:trial|court\s+date)\s+(?:on|set\s+for)?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi
];
// Court filing types
const LEGAL_DOCUMENT_TYPES = [
    'motion', 'response', 'reply', 'notice', 'petition', 'complaint',
    'answer', 'discovery', 'subpoena', 'order', 'brief', 'memorandum',
    'affidavit', 'declaration', 'stipulation', 'judgment', 'trial', 'hearing'
];
/**
 * Extract legal deadlines from document text
 */
async function extractLegalDeadlines(documentId, text) {
    if (!text) {
        logger_1.logger.warn(`No text provided for deadline extraction, document ID: ${documentId}`);
        return [];
    }
    const db = (0, connection_1.getConnection)();
    const deadlines = [];
    const now = new Date();
    try {
        // First pass: check for explicit deadline mentions using patterns
        for (const pattern of DEADLINE_PATTERNS) {
            pattern.lastIndex = 0; // Reset regex for multiple uses
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const matchedText = match[0];
                const contextStart = Math.max(0, match.index - 100);
                const contextEnd = Math.min(text.length, match.index + matchedText.length + 100);
                const context = text.substring(contextStart, contextEnd);
                // Try to parse the date from the matched text or context
                const parsedDates = chrono_node_1.default.parse(context, now, { forwardDate: true });
                if (parsedDates.length > 0) {
                    const deadlineDate = parsedDates[0].start.date();
                    // Only consider future dates or dates within the past 2 days (accounting for recent filings)
                    const twoDaysAgo = new Date();
                    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                    if (deadlineDate >= twoDaysAgo) {
                        // Determine if response is required
                        const responseRequired = /respond|answer|reply|file|response/i.test(context);
                        // Determine deadline type
                        let type = 'Other';
                        for (const legalType of LEGAL_DOCUMENT_TYPES) {
                            if (new RegExp(`\\b${legalType}\\b`, 'i').test(context)) {
                                type = legalType.charAt(0).toUpperCase() + legalType.slice(1);
                                break;
                            }
                        }
                        // Create deadline description
                        const description = `${type} deadline: ${context.substring(0, 150)}...`;
                        deadlines.push({
                            documentId,
                            description,
                            deadline: deadlineDate,
                            responseRequired,
                            type,
                            created: new Date()
                        });
                    }
                }
            }
        }
        // Second pass: AI-assisted extraction for complex cases
        // This would be implemented separately if needed
        // Save extracted deadlines to database
        for (const deadline of deadlines) {
            const result = await db.query(`INSERT INTO legal_deadlines 
                 (document_id, description, deadline_date, response_required, type, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`, [
                deadline.documentId,
                deadline.description,
                deadline.deadline,
                deadline.responseRequired ? 1 : 0,
                deadline.type,
                deadline.created
            ]);
            const deadlineId = result.insertId || result.lastID;
            deadline.id = deadlineId;
            // Add to knowledge base
            await (0, knowledgeBase_1.addToKnowledgeBase)(documentId, `Legal deadline extracted: ${deadline.type} due on ${deadline.deadline.toLocaleDateString()}. ${deadline.responseRequired ? 'Response required.' : ''}`);
            // Add to Google Calendar if integration is enabled
            const config = (0, config_1.loadConfig)();
            if (config.googleCalendar?.enabled) {
                try {
                    // Create calendar event
                    const eventTitle = `Legal Deadline: ${deadline.type}${deadline.responseRequired ? ' (Response Required)' : ''}`;
                    const description = `From document: ${await getDocumentName(documentId)}\n\n${deadline.description}`;
                    // Set reminder for 3 days before (or earlier if deadline is sooner)
                    const reminderDays = Math.min(3, Math.max(1, Math.floor((deadline.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))));
                    const calendarEventId = await (0, googleCalendar_1.addEventToGoogleCalendar)(eventTitle, description, deadline.deadline, reminderDays);
                    if (calendarEventId) {
                        // Update deadline with calendar event ID
                        await db.query('UPDATE legal_deadlines SET calendar_event_id = ? WHERE id = ?', [calendarEventId, deadlineId]);
                        logger_1.logger.info(`Added deadline to Google Calendar: ${eventTitle}, event ID: ${calendarEventId}`);
                    }
                }
                catch (error) {
                    logger_1.logger.error(`Error adding deadline to Google Calendar:`, error);
                }
            }
        }
        return deadlines;
    }
    catch (error) {
        logger_1.logger.error(`Error extracting legal deadlines from document ${documentId}:`, error);
        return [];
    }
}
/**
 * Get upcoming legal deadlines
 */
async function getUpcomingDeadlines(days = 30) {
    const db = (0, connection_1.getConnection)();
    const now = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);
    try {
        const deadlines = await db.query(`SELECT ld.*, d.name as document_name 
             FROM legal_deadlines ld
             JOIN documents d ON ld.document_id = d.id
             WHERE ld.deadline_date BETWEEN ? AND ?
             ORDER BY ld.deadline_date ASC`, [now, deadline]);
        return deadlines.map((row) => {
            const deadlineDate = new Date(row.deadline_date);
            const diffTime = deadlineDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return {
                id: row.id,
                documentId: row.document_id,
                description: row.description,
                deadline: deadlineDate,
                responseRequired: Boolean(row.response_required),
                remainingDays: diffDays,
                type: row.type,
                calendarEventId: row.calendar_event_id,
                created: new Date(row.created_at),
                documentName: row.document_name
            };
        });
    }
    catch (error) {
        logger_1.logger.error('Error getting upcoming deadlines:', error);
        return [];
    }
}
/**
 * Get document name
 */
async function getDocumentName(documentId) {
    const db = (0, connection_1.getConnection)();
    try {
        const docs = await db.query('SELECT name FROM documents WHERE id = ?', [documentId]);
        if (docs && docs.length > 0) {
            return docs[0].name;
        }
        return `Document #${documentId}`;
    }
    catch (error) {
        logger_1.logger.error(`Error getting document name for document ${documentId}:`, error);
        return `Document #${documentId}`;
    }
}
