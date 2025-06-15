"use strict";
/**
 * AI-Powered Brief Writing Assistant
 * Helps draft legal briefs and other legal documents
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIEF_SECTIONS = exports.BRIEF_TYPES = void 0;
exports.generateDocument = generateDocument;
exports.generateSection = generateSection;
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const connection_1 = require("../database/connection");
const processor_1 = require("./processor");
const legalDatabases_1 = require("../integration/legalDatabases");
// Brief types and formats
exports.BRIEF_TYPES = {
    MOTION_DISMISS: 'Motion to Dismiss',
    MOTION_SUMMARY_JUDGMENT: 'Motion for Summary Judgment',
    MOTION_COMPEL: 'Motion to Compel',
    RESPONSE_MOTION: 'Response to Motion',
    MEMORANDUM_LAW: 'Memorandum of Law',
    COMPLAINT: 'Complaint',
    APPELLATE_BRIEF: 'Appellate Brief'
};
// Parts of a brief
exports.BRIEF_SECTIONS = {
    INTRODUCTION: 'Introduction',
    FACTS: 'Statement of Facts',
    LEGAL_STANDARD: 'Legal Standard',
    ARGUMENT: 'Argument',
    CONCLUSION: 'Conclusion',
    AUTHORITIES: 'Table of Authorities'
};
/**
 * Generate a complete legal document/brief draft
 */
async function generateDocument(request, userId) {
    const perfEnd = logger_1.performance.start('generate-document');
    const config = (0, config_1.loadConfig)();
    try {
        logger_1.logger.info(`Starting document generation of type ${request.documentType} for user ${userId}`);
        // Create prompt with case context and guidelines
        const prompt = createDocumentPrompt(request);
        // Get information from any existing documents if provided
        const existingContent = await getExistingDocumentContent(request.existingDocumentIds || [], userId);
        // Add existing content to context if available
        let fullPrompt = prompt;
        if (existingContent && existingContent.length > 0) {
            fullPrompt += `\n\nHere is content from relevant existing documents that you can reference and incorporate as appropriate:\n\n${existingContent}`;
        }
        // Generate complete document using AI
        const result = await (0, processor_1.summarizeDocument)(fullPrompt, config.ai?.maxTokens || 3000);
        // Process the result to extract sections
        const processedResult = processGeneratedDocument(result, request.documentType);
        // Add citations found in the document
        const allText = processedResult.sections.map(s => s.content).join('\n\n');
        const citations = (0, legalDatabases_1.extractCitations)(allText);
        processedResult.citations = citations;
        // Calculate word count
        const wordCount = allText.split(/\s+/).length;
        processedResult.wordCount = wordCount;
        logger_1.logger.info(`Completed document generation in ${perfEnd()}ms, word count: ${wordCount}`);
        // Save generation history for analytics
        await saveGenerationHistory(request, userId, wordCount);
        return processedResult;
    }
    catch (error) {
        logger_1.logger.error('Error generating document with AI:', error);
        throw new Error('Failed to generate document. Please try again later.');
    }
}
/**
 * Generate a specific section of a legal document
 */
async function generateSection(request, userId) {
    const perfEnd = logger_1.performance.start('generate-section');
    const config = (0, config_1.loadConfig)();
    try {
        // Create prompt for section generation
        const prompt = createSectionPrompt(request);
        // Generate section using AI
        const result = await (0, processor_1.summarizeDocument)(prompt, config.ai?.maxTokens || 2000);
        // Extract citations
        const citations = (0, legalDatabases_1.extractCitations)(result);
        // Calculate word count
        const wordCount = result.split(/\s+/).length;
        // Provide some writing suggestions
        const suggestions = generateWritingSuggestions(result, request.sectionType);
        logger_1.logger.info(`Completed section generation in ${perfEnd()}ms, word count: ${wordCount}`);
        // Save section generation history
        await saveSectionGenerationHistory(request, userId, wordCount, request.sectionType);
        return {
            content: result,
            citations,
            suggestions,
            wordCount
        };
    }
    catch (error) {
        logger_1.logger.error('Error generating section with AI:', error);
        throw new Error('Failed to generate section. Please try again later.');
    }
}
/**
 * Create a prompt for generating an entire document
 */
function createDocumentPrompt(request) {
    const { documentType, caseDescription, relevantFacts, legalIssues, clientGoals, jurisdiction, tone } = request;
    // Start with basic document type and information
    let prompt = `Generate a complete ${documentType} for a legal case with the following description:\n\n`;
    prompt += `${caseDescription}\n\n`;
    // Add facts if provided
    if (relevantFacts && relevantFacts.length > 0) {
        prompt += `Relevant facts:\n`;
        relevantFacts.forEach(fact => {
            prompt += `- ${fact}\n`;
        });
        prompt += '\n';
    }
    // Add legal issues if provided
    if (legalIssues && legalIssues.length > 0) {
        prompt += `Legal issues to address:\n`;
        legalIssues.forEach(issue => {
            prompt += `- ${issue}\n`;
        });
        prompt += '\n';
    }
    // Add client goals if provided
    if (clientGoals && clientGoals.length > 0) {
        prompt += `Client goals:\n`;
        clientGoals.forEach(goal => {
            prompt += `- ${goal}\n`;
        });
        prompt += '\n';
    }
    // Add jurisdiction context if provided
    if (jurisdiction) {
        prompt += `Jurisdiction: ${jurisdiction}\n\n`;
    }
    // Set tone of the document
    if (tone) {
        prompt += `The tone should be ${tone}.\n\n`;
    }
    // Add instructions for the document structure
    prompt += `Please structure the document with appropriate headings and sections following standard legal document formatting for a ${documentType}. Include standard sections such as Introduction, Statement of Facts, Legal Standard, Argument, and Conclusion as appropriate for this document type.\n\n`;
    // Include instruction for table of authorities if requested
    if (request.includeAuthorities) {
        prompt += `Also include a Table of Authorities section listing all legal citations used in the document.\n\n`;
    }
    // Add final formatting guidance
    prompt += `Format each major section with a clear heading. Use proper legal citation format. Ensure arguments are well-structured and supported by relevant case law or statutes where appropriate.\n\n`;
    return prompt;
}
/**
 * Create a prompt for generating a specific section
 */
function createSectionPrompt(request) {
    const { briefType, sectionType, caseDescription, relevantFacts, existingContent, tone, length, keyPoints, jurisdiction } = request;
    // Start with basic section type and information
    let prompt = `Generate the "${sectionType}" section of a ${briefType} for a legal case with the following description:\n\n`;
    prompt += `${caseDescription}\n\n`;
    // Add facts if provided
    if (relevantFacts && relevantFacts.length > 0) {
        prompt += `Relevant facts:\n`;
        relevantFacts.forEach(fact => {
            prompt += `- ${fact}\n`;
        });
        prompt += '\n';
    }
    // Add key points to address if provided
    if (keyPoints && keyPoints.length > 0) {
        prompt += `Key points to address in this section:\n`;
        keyPoints.forEach(point => {
            prompt += `- ${point}\n`;
        });
        prompt += '\n';
    }
    // Add jurisdiction context if provided
    if (jurisdiction) {
        prompt += `Jurisdiction: ${jurisdiction}\n\n`;
    }
    // Add existing content if provided
    if (existingContent) {
        prompt += `Existing content to improve upon or incorporate:\n${existingContent}\n\n`;
    }
    // Set tone of the section
    if (tone) {
        prompt += `The tone should be ${tone}.\n\n`;
    }
    // Set length guidance
    if (length) {
        const wordCount = length === 'short' ? '250-500' : (length === 'medium' ? '500-1000' : '1000-1500');
        prompt += `This section should be approximately ${wordCount} words in length.\n\n`;
    }
    // Add section-specific guidance
    prompt += getSectionGuidance(sectionType);
    return prompt;
}
/**
 * Get section-specific guidance for the AI
 */
function getSectionGuidance(sectionType) {
    switch (sectionType) {
        case exports.BRIEF_SECTIONS.INTRODUCTION:
            return 'For the Introduction section, provide a concise overview of the case and clearly state the relief being sought or the position being taken. End with a brief summary of the main arguments.\n';
        case exports.BRIEF_SECTIONS.FACTS:
            return 'For the Statement of Facts section, present the relevant facts chronologically and objectively. Include only facts that are relevant to the legal issues and cite to the record where appropriate.\n';
        case exports.BRIEF_SECTIONS.LEGAL_STANDARD:
            return 'For the Legal Standard section, state the applicable legal standards that govern the issues in the case. Include relevant statutory provisions and case law that establish the standards of review.\n';
        case exports.BRIEF_SECTIONS.ARGUMENT:
            return 'For the Argument section, present logical, well-structured arguments supported by relevant legal authorities. Address counter-arguments when appropriate and explain why they should be rejected.\n';
        case exports.BRIEF_SECTIONS.CONCLUSION:
            return 'For the Conclusion section, briefly summarize the key arguments and clearly state the relief requested or the action that the court should take.\n';
        case exports.BRIEF_SECTIONS.AUTHORITIES:
            return 'For the Table of Authorities section, list all legal authorities cited in the document, organized by type (cases, statutes, regulations, etc.) and in alphabetical order within each category.\n';
        default:
            return 'Provide a well-structured, legally sound section that follows standard legal writing conventions and properly supports all claims with appropriate legal authorities where applicable.\n';
    }
}
/**
 * Process the AI-generated document to extract sections
 */
function processGeneratedDocument(text, documentType) {
    // Initialize the result
    const result = {
        sections: [],
        citations: [],
        wordCount: 0,
        suggestions: []
    };
    // Split the document into sections based on headings
    const headingRegex = /^(#{1,3}\s+|\*\*|)([A-Z][A-Z\s\d.]*[A-Z\d])(\*\*|\s*\n|\s*$)/gm;
    let lastIndex = 0;
    let currentTitle = '';
    let match;
    while ((match = headingRegex.exec(text)) !== null) {
        // If we have a previous title, save the content between the previous heading and this one
        if (currentTitle) {
            const sectionContent = text.substring(lastIndex, match.index).trim();
            if (sectionContent) {
                result.sections.push({
                    title: currentTitle,
                    content: sectionContent
                });
            }
        }
        // Update for the next section
        currentTitle = match[2].trim();
        lastIndex = match.index + match[0].length;
    }
    // Add the last section
    if (currentTitle) {
        const sectionContent = text.substring(lastIndex).trim();
        if (sectionContent) {
            result.sections.push({
                title: currentTitle,
                content: sectionContent
            });
        }
    }
    // If no sections were found (no headings in text), treat the whole text as one section
    if (result.sections.length === 0) {
        result.sections.push({
            title: getDefaultTitle(documentType),
            content: text.trim()
        });
    }
    // Generate some writing suggestions
    result.suggestions = generateOverallSuggestions(text, documentType);
    return result;
}
/**
 * Get a default title based on document type
 */
function getDefaultTitle(documentType) {
    switch (documentType) {
        case exports.BRIEF_TYPES.MOTION_DISMISS:
            return 'Motion to Dismiss';
        case exports.BRIEF_TYPES.MOTION_SUMMARY_JUDGMENT:
            return 'Motion for Summary Judgment';
        case exports.BRIEF_TYPES.MOTION_COMPEL:
            return 'Motion to Compel';
        case exports.BRIEF_TYPES.RESPONSE_MOTION:
            return 'Response';
        case exports.BRIEF_TYPES.MEMORANDUM_LAW:
            return 'Memorandum of Law';
        case exports.BRIEF_TYPES.COMPLAINT:
            return 'Complaint';
        case exports.BRIEF_TYPES.APPELLATE_BRIEF:
            return 'Brief';
        default:
            return 'Legal Document';
    }
}
/**
 * Generate writing suggestions for a specific section
 */
function generateWritingSuggestions(text, sectionType) {
    const suggestions = [];
    // Common legal writing improvements
    if (text.includes(' very ') || text.includes(' really ')) {
        suggestions.push('Consider removing intensifiers like "very" and "really" for more precise language.');
    }
    if (text.includes(' clearly ') || text.includes(' obviously ')) {
        suggestions.push('Phrases like "clearly" and "obviously" can weaken arguments. Consider removing them and letting facts speak for themselves.');
    }
    // Check for passive voice (simple heuristic)
    const passiveMatches = text.match(/\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/g);
    if (passiveMatches && passiveMatches.length > 3) {
        suggestions.push('Consider reducing use of passive voice for more direct and forceful writing.');
    }
    // Section-specific suggestions
    switch (sectionType) {
        case exports.BRIEF_SECTIONS.INTRODUCTION:
            if (text.length > 2000) {
                suggestions.push('Your introduction may be too long. Consider condensing it to focus on key points.');
            }
            break;
        case exports.BRIEF_SECTIONS.FACTS:
            if (!text.match(/\b\d{4}\b/)) {
                suggestions.push('Consider adding specific dates to strengthen your factual narrative.');
            }
            break;
        case exports.BRIEF_SECTIONS.ARGUMENT:
            const citationCount = (text.match(/\d+\s+[A-Za-z.]+\s+\d+/g) || []).length;
            if (citationCount < 3 && text.length > 1000) {
                suggestions.push('Consider adding more legal citations to support your arguments.');
            }
            break;
        case exports.BRIEF_SECTIONS.CONCLUSION:
            if (text.length > 1000) {
                suggestions.push('Your conclusion may be too detailed. Consider making it more concise.');
            }
            break;
    }
    return suggestions;
}
/**
 * Generate overall document suggestions
 */
function generateOverallSuggestions(text, documentType) {
    const suggestions = [];
    // Check overall document length
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 5000) {
        suggestions.push('This document is quite long. Consider whether some sections could be condensed.');
    }
    else if (wordCount < 1000 && documentType !== exports.BRIEF_TYPES.MOTION_COMPEL) {
        suggestions.push('This document is relatively short. Consider whether additional detail would strengthen your position.');
    }
    // Check citation count
    const citationCount = (0, legalDatabases_1.extractCitations)(text).length;
    if (citationCount < 3 && documentType !== exports.BRIEF_TYPES.COMPLAINT) {
        suggestions.push('Consider adding more legal citations to support your arguments.');
    }
    // Check section balance
    const sections = text.split(/^#{1,3}\s+[A-Z].*$/m);
    if (sections.length >= 3) {
        const sectionLengths = sections.map(s => s.split(/\s+/).length);
        const maxLength = Math.max(...sectionLengths);
        const minLength = Math.min(...sectionLengths.filter(l => l > 20)); // Filter out very small sections
        if (maxLength > minLength * 3) {
            suggestions.push('The sections of this document vary significantly in length. Consider balancing them more evenly.');
        }
    }
    return suggestions;
}
/**
 * Get content from existing documents to use as reference
 */
async function getExistingDocumentContent(documentIds, userId) {
    if (!documentIds || documentIds.length === 0)
        return null;
    const db = (0, connection_1.getConnection)();
    let combinedContent = '';
    try {
        for (const docId of documentIds) {
            // Check document access
            const docs = await db.query(`SELECT d.*, i.text_content 
         FROM documents d
         LEFT JOIN document_index i ON d.id = i.document_id
         WHERE d.id = ? AND (d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         ))`, [docId, userId, userId]);
            if (docs && docs.length > 0) {
                const doc = docs[0];
                if (doc.text_content) {
                    // Add document content with a header
                    combinedContent += `== DOCUMENT: ${doc.name} ==\n\n${doc.text_content.substring(0, 5000)}\n\n`;
                }
            }
        }
        return combinedContent.trim();
    }
    catch (error) {
        logger_1.logger.error('Error retrieving existing document content:', error);
        return null;
    }
}
/**
 * Save document generation history for analytics
 */
async function saveGenerationHistory(request, userId, wordCount) {
    const db = (0, connection_1.getConnection)();
    try {
        await db.query(`INSERT INTO document_generation_history
       (user_id, document_type, word_count, jurisdiction, tone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            userId,
            request.documentType,
            wordCount,
            request.jurisdiction || null,
            request.tone || null,
            new Date()
        ]);
    }
    catch (error) {
        logger_1.logger.warn('Error saving document generation history:', error);
    }
}
/**
 * Save section generation history for analytics
 */
async function saveSectionGenerationHistory(request, userId, wordCount, sectionType) {
    const db = (0, connection_1.getConnection)();
    try {
        await db.query(`INSERT INTO section_generation_history
       (user_id, document_type, section_type, word_count, tone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`, [
            userId,
            request.briefType,
            sectionType,
            wordCount,
            request.tone || null,
            new Date()
        ]);
    }
    catch (error) {
        logger_1.logger.warn('Error saving section generation history:', error);
    }
}
