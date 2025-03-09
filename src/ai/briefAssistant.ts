/**
 * AI-Powered Brief Writing Assistant
 * Helps draft legal briefs and other legal documents
 */

import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';
import { getConnection } from '../database/connection';
import { summarizeDocument } from './processor';
import { extractCitations } from '../integration/legalDatabases';
import { v4 as uuidv4 } from 'uuid';

// Brief types and formats
export const BRIEF_TYPES = {
  MOTION_DISMISS: 'Motion to Dismiss',
  MOTION_SUMMARY_JUDGMENT: 'Motion for Summary Judgment',
  MOTION_COMPEL: 'Motion to Compel',
  RESPONSE_MOTION: 'Response to Motion',
  MEMORANDUM_LAW: 'Memorandum of Law',
  COMPLAINT: 'Complaint',
  APPELLATE_BRIEF: 'Appellate Brief'
};

// Parts of a brief
export const BRIEF_SECTIONS = {
  INTRODUCTION: 'Introduction',
  FACTS: 'Statement of Facts',
  LEGAL_STANDARD: 'Legal Standard',
  ARGUMENT: 'Argument',
  CONCLUSION: 'Conclusion',
  AUTHORITIES: 'Table of Authorities'
};

// Interface for section generation request
export interface SectionGenerationRequest {
  briefType: string;
  sectionType: string;
  caseDescription: string;
  relevantFacts?: string[];
  existingContent?: string;
  tone?: 'persuasive' | 'neutral' | 'scholarly';
  length?: 'short' | 'medium' | 'long';
  keyPoints?: string[];
  jurisdiction?: string;
}

// Interface for section generation result
export interface SectionGenerationResult {
  content: string;
  citations?: string[];
  suggestions?: string[];
  wordCount?: number;
}

// Interface for full document generation request
export interface DocumentGenerationRequest {
  documentType: string;
  caseDescription: string;
  relevantFacts?: string[];
  legalIssues?: string[];
  clientGoals?: string[];
  jurisdiction?: string;
  tone?: 'persuasive' | 'neutral' | 'scholarly';
  existingDocumentIds?: number[];
  includeAuthorities?: boolean;
}

// Interface for generation result
export interface DocumentGenerationResult {
  sections: {
    title: string;
    content: string;
  }[];
  citations: string[];
  wordCount: number;
  suggestions: string[];
}

/**
 * Generate a complete legal document/brief draft
 */
export async function generateDocument(
  request: DocumentGenerationRequest,
  userId: number
): Promise<DocumentGenerationResult> {
  const perfEnd = performance.start('generate-document');
  const config = loadConfig();
  
  try {
    logger.info(`Starting document generation of type ${request.documentType} for user ${userId}`);
    
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
    const result = await summarizeDocument(fullPrompt, config.ai?.maxTokens || 3000);
    
    // Process the result to extract sections
    const processedResult = processGeneratedDocument(result, request.documentType);
    
    // Add citations found in the document
    const allText = processedResult.sections.map(s => s.content).join('\n\n');
    const citations = extractCitations(allText);
    processedResult.citations = citations;
    
    // Calculate word count
    const wordCount = allText.split(/\s+/).length;
    processedResult.wordCount = wordCount;
    
    logger.info(`Completed document generation in ${perfEnd()}ms, word count: ${wordCount}`);
    
    // Save generation history for analytics
    await saveGenerationHistory(request, userId, wordCount);
    
    return processedResult;
  } catch (error) {
    logger.error('Error generating document with AI:', error);
    throw new Error('Failed to generate document. Please try again later.');
  }
}

/**
 * Generate a specific section of a legal document
 */
export async function generateSection(
  request: SectionGenerationRequest,
  userId: number
): Promise<SectionGenerationResult> {
  const perfEnd = performance.start('generate-section');
  const config = loadConfig();
  
  try {
    // Create prompt for section generation
    const prompt = createSectionPrompt(request);
    
    // Generate section using AI
    const result = await summarizeDocument(prompt, config.ai?.maxTokens || 2000);
    
    // Extract citations
    const citations = extractCitations(result);
    
    // Calculate word count
    const wordCount = result.split(/\s+/).length;
    
    // Provide some writing suggestions
    const suggestions = generateWritingSuggestions(result, request.sectionType);
    
    logger.info(`Completed section generation in ${perfEnd()}ms, word count: ${wordCount}`);
    
    // Save section generation history
    await saveSectionGenerationHistory(
      request,
      userId,
      wordCount,
      request.sectionType
    );
    
    return {
      content: result,
      citations,
      suggestions,
      wordCount
    };
  } catch (error) {
    logger.error('Error generating section with AI:', error);
    throw new Error('Failed to generate section. Please try again later.');
  }
}

/**
 * Create a prompt for generating an entire document
 */
function createDocumentPrompt(request: DocumentGenerationRequest): string {
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
function createSectionPrompt(request: SectionGenerationRequest): string {
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
function getSectionGuidance(sectionType: string): string {
  switch (sectionType) {
    case BRIEF_SECTIONS.INTRODUCTION:
      return 'For the Introduction section, provide a concise overview of the case and clearly state the relief being sought or the position being taken. End with a brief summary of the main arguments.\n';
    
    case BRIEF_SECTIONS.FACTS:
      return 'For the Statement of Facts section, present the relevant facts chronologically and objectively. Include only facts that are relevant to the legal issues and cite to the record where appropriate.\n';
    
    case BRIEF_SECTIONS.LEGAL_STANDARD:
      return 'For the Legal Standard section, state the applicable legal standards that govern the issues in the case. Include relevant statutory provisions and case law that establish the standards of review.\n';
    
    case BRIEF_SECTIONS.ARGUMENT:
      return 'For the Argument section, present logical, well-structured arguments supported by relevant legal authorities. Address counter-arguments when appropriate and explain why they should be rejected.\n';
    
    case BRIEF_SECTIONS.CONCLUSION:
      return 'For the Conclusion section, briefly summarize the key arguments and clearly state the relief requested or the action that the court should take.\n';
    
    case BRIEF_SECTIONS.AUTHORITIES:
      return 'For the Table of Authorities section, list all legal authorities cited in the document, organized by type (cases, statutes, regulations, etc.) and in alphabetical order within each category.\n';
    
    default:
      return 'Provide a well-structured, legally sound section that follows standard legal writing conventions and properly supports all claims with appropriate legal authorities where applicable.\n';
  }
}

/**
 * Process the AI-generated document to extract sections
 */
function processGeneratedDocument(text: string, documentType: string): DocumentGenerationResult {
  // Initialize the result
  const result: DocumentGenerationResult = {
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
function getDefaultTitle(documentType: string): string {
  switch (documentType) {
    case BRIEF_TYPES.MOTION_DISMISS:
      return 'Motion to Dismiss';
    case BRIEF_TYPES.MOTION_SUMMARY_JUDGMENT:
      return 'Motion for Summary Judgment';
    case BRIEF_TYPES.MOTION_COMPEL:
      return 'Motion to Compel';
    case BRIEF_TYPES.RESPONSE_MOTION:
      return 'Response';
    case BRIEF_TYPES.MEMORANDUM_LAW:
      return 'Memorandum of Law';
    case BRIEF_TYPES.COMPLAINT:
      return 'Complaint';
    case BRIEF_TYPES.APPELLATE_BRIEF:
      return 'Brief';
    default:
      return 'Legal Document';
  }
}

/**
 * Generate writing suggestions for a specific section
 */
function generateWritingSuggestions(text: string, sectionType: string): string[] {
  const suggestions: string[] = [];
  
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
    case BRIEF_SECTIONS.INTRODUCTION:
      if (text.length > 2000) {
        suggestions.push('Your introduction may be too long. Consider condensing it to focus on key points.');
      }
      break;
      
    case BRIEF_SECTIONS.FACTS:
      if (!text.match(/\b\d{4}\b/)) {
        suggestions.push('Consider adding specific dates to strengthen your factual narrative.');
      }
      break;
      
    case BRIEF_SECTIONS.ARGUMENT:
      const citationCount = (text.match(/\d+\s+[A-Za-z.]+\s+\d+/g) || []).length;
      if (citationCount < 3 && text.length > 1000) {
        suggestions.push('Consider adding more legal citations to support your arguments.');
      }
      break;
      
    case BRIEF_SECTIONS.CONCLUSION:
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
function generateOverallSuggestions(text: string, documentType: string): string[] {
  const suggestions: string[] = [];
  
  // Check overall document length
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 5000) {
    suggestions.push('This document is quite long. Consider whether some sections could be condensed.');
  } else if (wordCount < 1000 && documentType !== BRIEF_TYPES.MOTION_COMPEL) {
    suggestions.push('This document is relatively short. Consider whether additional detail would strengthen your position.');
  }
  
  // Check citation count
  const citationCount = extractCitations(text).length;
  if (citationCount < 3 && documentType !== BRIEF_TYPES.COMPLAINT) {
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
async function getExistingDocumentContent(documentIds: number[], userId: number): Promise<string | null> {
  if (!documentIds || documentIds.length === 0) return null;
  
  const db = getConnection();
  let combinedContent = '';
  
  try {
    for (const docId of documentIds) {
      // Check document access
      const docs = await db.query(
        `SELECT d.*, i.text_content 
         FROM documents d
         LEFT JOIN document_index i ON d.id = i.document_id
         WHERE d.id = ? AND (d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         ))`,
        [docId, userId, userId]
      );
      
      if (docs && docs.length > 0) {
        const doc = docs[0];
        if (doc.text_content) {
          // Add document content with a header
          combinedContent += `== DOCUMENT: ${doc.name} ==\n\n${doc.text_content.substring(0, 5000)}\n\n`;
        }
      }
    }
    
    return combinedContent.trim();
  } catch (error) {
    logger.error('Error retrieving existing document content:', error);
    return null;
  }
}

/**
 * Save document generation history for analytics
 */
async function saveGenerationHistory(
  request: DocumentGenerationRequest,
  userId: number,
  wordCount: number
): Promise<void> {
  const db = getConnection();
  
  try {
    await db.query(
      `INSERT INTO document_generation_history
       (user_id, document_type, word_count, jurisdiction, tone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        request.documentType,
        wordCount,
        request.jurisdiction || null,
        request.tone || null,
        new Date()
      ]
    );
  } catch (error) {
    logger.warn('Error saving document generation history:', error);
  }
}

/**
 * Save section generation history for analytics
 */
async function saveSectionGenerationHistory(
  request: SectionGenerationRequest,
  userId: number,
  wordCount: number,
  sectionType: string
): Promise<void> {
  const db = getConnection();
  
  try {
    await db.query(
      `INSERT INTO section_generation_history
       (user_id, document_type, section_type, word_count, tone, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        request.briefType,
        sectionType,
        wordCount,
        request.tone || null,
        new Date()
      ]
    );
  } catch (error) {
    logger.warn('Error saving section generation history:', error);
  }
}
