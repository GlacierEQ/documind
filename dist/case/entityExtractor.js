"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityType = void 0;
exports.extractEntities = extractEntities;
exports.findReferences = findReferences;
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const connection_1 = require("../database/connection");
const natural_1 = __importDefault(require("natural"));
const tokenizer = new natural_1.default.WordTokenizer();
const nameEntityRegex = /([A-Z][a-z]+ (?:[A-Z][a-z]+ )*[A-Z][a-z]+)/g;
const dateRegex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi;
const caseNumberRegex = /\b(?:case|docket)(?:\s+(?:no|number|#|num))?\s*[:.-]?\s*([a-z0-9-]+)/gi;
const addressRegex = /\b\d+\s+[a-z0-9\s,]+(?:avenue|street|road|boulevard|place|drive|court|plaza|square|lane|way)\b/gi;
const currencyRegex = /\$\s*\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?|\b\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?\s*(?:dollars|usd)\b/gi;
// Entity types
var EntityType;
(function (EntityType) {
    EntityType["PERSON"] = "person";
    EntityType["ORGANIZATION"] = "organization";
    EntityType["LOCATION"] = "location";
    EntityType["DATE"] = "date";
    EntityType["LEGAL_REFERENCE"] = "legal_reference";
    EntityType["CASE_NUMBER"] = "case_number";
    EntityType["EXHIBIT"] = "exhibit";
    EntityType["CURRENCY"] = "currency";
    EntityType["OTHER"] = "other";
})(EntityType || (exports.EntityType = EntityType = {}));
/**
 * Extract entities from text
 */
async function extractEntities(text) {
    const entities = [];
    const config = (0, config_1.loadConfig)();
    try {
        // Use AI analysis if available
        if (config.ai && config.ai.provider !== 'none' && config.ai.analysisEnabled) {
            try {
                // This would typically be done with a document ID, but we're working with raw text
                return extractEntitiesRuleBased(text);
            }
            catch (error) {
                logger_1.logger.error('Error extracting entities with AI:', error);
                return extractEntitiesRuleBased(text);
            }
        }
        else {
            // Use rule-based extraction
            return extractEntitiesRuleBased(text);
        }
    }
    catch (error) {
        logger_1.logger.error('Error extracting entities:', error);
        return [];
    }
}
/**
 * Find references to other documents
 */
async function findReferences(text) {
    const references = [];
    const db = (0, connection_1.getConnection)();
    try {
        // Get all document names from the database
        const documents = await db.query('SELECT id, name FROM documents', []);
        for (const doc of documents) {
            // Skip very short document names to avoid false positives
            if (doc.name.length < 5)
                continue;
            // Look for document name in text
            const docNamePattern = new RegExp(`\\b${escapeRegExp(doc.name)}\\b`, 'i');
            const match = text.match(docNamePattern);
            if (match) {
                // Get context around the match
                const matchIndex = match.index || 0;
                const contextStart = Math.max(0, matchIndex - 100);
                const contextEnd = Math.min(text.length, matchIndex + match[0].length + 100);
                const context = text.substring(contextStart, contextEnd);
                references.push({
                    targetId: doc.id,
                    context: context,
                    confidence: 0.9 // High confidence for exact match
                });
                continue;
            }
            // Look for partial matches in document name
            // This is useful for documents like "Smith Declaration" being referenced as just "Declaration"
            const docNameParts = doc.name.split(/\s+/).filter(part => part.length > 5);
            for (const part of docNameParts) {
                const partPattern = new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i');
                const match = text.match(partPattern);
                if (match) {
                    // Get context around the match
                    const matchIndex = match.index || 0;
                    const contextStart = Math.max(0, matchIndex - 100);
                    const contextEnd = Math.min(text.length, matchIndex + match[0].length + 100);
                    const context = text.substring(contextStart, contextEnd);
                    // Check if we already have a reference to this document
                    if (!references.some(r => r.targetId === doc.id)) {
                        references.push({
                            targetId: doc.id,
                            context: context,
                            confidence: 0.6 // Lower confidence for partial match
                        });
                    }
                }
            }
        }
        return references;
    }
    catch (error) {
        logger_1.logger.error('Error finding document references:', error);
        return [];
    }
}
/**
 * Rule-based entity extraction
 */
function extractEntitiesRuleBased(text) {
    const entities = [];
    const foundEntities = new Set();
    // Extract potential names (pattern: First Last)
    const nameMatches = text.match(nameEntityRegex);
    if (nameMatches) {
        nameMatches.forEach(match => {
            // Skip common words and short matches
            if (match.length < 5 || /^(The|This|That|These|Those|Some|Any|What|When|Where|How|Why|District|Court|County)$/.test(match)) {
                return;
            }
            if (foundEntities.has(match))
                return;
            foundEntities.add(match);
            const nameParts = match.split(' ');
            // Heuristic: if name has 2-3 parts, it's more likely a person
            // Organizations usually have more words or specific patterns
            let type = EntityType.OTHER;
            let importance = 3; // Default importance
            if (nameParts.length <= 3) {
                // Look for organization keywords
                if (/Inc|LLC|Corp|Company|Association|Department|Bureau|Agency|Court/i.test(match)) {
                    type = EntityType.ORGANIZATION;
                    importance = 6;
                }
                else {
                    type = EntityType.PERSON;
                    importance = 7;
                }
            }
            else {
                // More than 3 words likely an organization or title
                type = EntityType.ORGANIZATION;
                importance = 5;
            }
            // Get name context (surrounding text)
            const nameIndex = text.indexOf(match);
            if (nameIndex >= 0) {
                const contextStart = Math.max(0, nameIndex - 50);
                const contextEnd = Math.min(text.length, nameIndex + match.length + 50);
                const context = text.substring(contextStart, contextEnd);
                entities.push({
                    name: match,
                    type: type,
                    importance: importance,
                    context: context
                });
            }
        });
    }
    // Extract dates
    const dateMatches = text.match(dateRegex);
    if (dateMatches) {
        dateMatches.forEach(match => {
            if (foundEntities.has(match))
                return;
            foundEntities.add(match);
            // Get date context
            const dateIndex = text.indexOf(match);
            if (dateIndex >= 0) {
                const contextStart = Math.max(0, dateIndex - 50);
                const contextEnd = Math.min(text.length, dateIndex + match.length + 50);
                const context = text.substring(contextStart, contextEnd);
                entities.push({
                    name: match,
                    type: EntityType.DATE,
                    importance: 5,
                    context: context
                });
            }
        });
    }
    // Extract case numbers
    const caseMatches = text.match(caseNumberRegex);
    if (caseMatches) {
        caseMatches.forEach(match => {
            if (foundEntities.has(match))
                return;
            foundEntities.add(match);
            // Get case number context
            const caseIndex = text.indexOf(match);
            if (caseIndex >= 0) {
                const contextStart = Math.max(0, caseIndex - 50);
                const contextEnd = Math.min(text.length, caseIndex + match.length + 50);
                const context = text.substring(contextStart, contextEnd);
                entities.push({
                    name: match,
                    type: EntityType.CASE_NUMBER,
                    importance: 9, // Case numbers are high importance
                    context: context
                });
            }
        });
    }
    // Extract addresses
    const addressMatches = text.match(addressRegex);
    if (addressMatches) {
        addressMatches.forEach(match => {
            if (foundEntities.has(match))
                return;
            foundEntities.add(match);
            // Get address context
            const addressIndex = text.indexOf(match);
            if (addressIndex >= 0) {
                const contextStart = Math.max(0, addressIndex - 50);
                const contextEnd = Math.min(text.length, addressIndex + match.length + 50);
                const context = text.substring(contextStart, contextEnd);
                entities.push({
                    name: match,
                    type: EntityType.LOCATION,
                    importance: 6,
                    context: context
                });
            }
        });
    }
    // Extract currency amounts
    const currencyMatches = text.match(currencyRegex);
    if (currencyMatches) {
        currencyMatches.forEach(match => {
            if (foundEntities.has(match))
                return;
            foundEntities.add(match);
            // Get currency context
            const currencyIndex = text.indexOf(match);
            if (currencyIndex >= 0) {
                const contextStart = Math.max(0, currencyIndex - 50);
                const contextEnd = Math.min(text.length, currencyIndex + match.length + 50);
                const context = text.substring(contextStart, contextEnd);
                entities.push({
                    name: match,
                    type: EntityType.CURRENCY,
                    importance: 7,
                    context: context
                });
            }
        });
    }
    return entities;
}
// Utility function to escape special characters for regex
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
