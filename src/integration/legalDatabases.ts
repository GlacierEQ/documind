/**
 * External Legal Database Integration
 * Connects to LexisNexis and Westlaw for legal research capabilities
 */

import axios from 'axios';
import { logger, performance } from '../utils/logger';
import { getConnection } from '../database/connection';
import { loadConfig } from '../config/config';
import { parseHtml } from '../utils/text';
import { v4 as uuidv4 } from 'uuid';

// API response interfaces
export interface LegalSearchResult {
  id: string;
  title: string;
  source: 'westlaw' | 'lexisnexis' | 'other';
  citation: string;
  court?: string;
  date?: Date;
  snippet?: string;
  url?: string;
  score: number;
}

export interface LegalDocument {
  id: string;
  title: string;
  source: 'westlaw' | 'lexisnexis' | 'other';
  citation: string;
  court?: string;
  date?: Date;
  content: string;
  contentType: string;
  metadata: Record<string, any>;
}

export interface SearchOptions {
  query: string;
  source?: 'westlaw' | 'lexisnexis' | 'all';
  jurisdiction?: string;
  dateFrom?: Date;
  dateTo?: Date;
  courtLevel?: string;
  documentTypes?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * Search external legal databases
 */
export async function searchLegalDatabases(
  options: SearchOptions,
  userId: number
): Promise<{ results: LegalSearchResult[]; total: number }> {
  const perfEnd = performance.start('legal-db-search');
  const config = loadConfig();
  const db = getConnection();
  
  // Track search for analytics
  await db.query(
    `INSERT INTO search_history (user_id, query, source, created_at)
     VALUES (?, ?, ?, ?)`,
    [userId, options.query, options.source || 'all', new Date()]
  );

  try {
    // Determine which sources to search
    let sources: ('westlaw' | 'lexisnexis')[] = [];
    
    if (!options.source || options.source === 'all') {
      sources = ['westlaw', 'lexisnexis'];
    } else {
      sources = [options.source];
    }
    
    // Run searches in parallel
    const searchPromises = sources.map(source => {
      if (source === 'westlaw' && config.integration?.westlaw?.apiKey) {
        return searchWestlaw(options, config.integration.westlaw);
      } else if (source === 'lexisnexis' && config.integration?.lexisnexis?.apiKey) {
        return searchLexisNexis(options, config.integration.lexisnexis);
      }
      return { results: [], total: 0 };
    });
    
    // Wait for all searches to complete
    const searchResults = await Promise.all(searchPromises);
    
    // Combine results
    const combinedResults: LegalSearchResult[] = [];
    let totalResults = 0;
    
    searchResults.forEach(result => {
      combinedResults.push(...result.results);
      totalResults += result.total;
    });
    
    // Sort by score
    combinedResults.sort((a, b) => b.score - a.score);
    
    // Apply pagination if needed
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const startIdx = (page - 1) * pageSize;
    const pagedResults = combinedResults.slice(startIdx, startIdx + pageSize);
    
    logger.info(`Legal database search completed in ${perfEnd()}ms, found ${totalResults} results`);
    
    return {
      results: pagedResults,
      total: totalResults
    };
  } catch (error) {
    logger.error('Error searching legal databases:', error);
    return { results: [], total: 0 };
  }
}

/**
 * Search Westlaw database
 */
async function searchWestlaw(
  options: SearchOptions,
  config: any
): Promise<{ results: LegalSearchResult[]; total: number }> {
  try {
    // Build Westlaw-specific query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('q', options.query);
    
    if (options.jurisdiction) {
      queryParams.append('jurisdiction', options.jurisdiction);
    }
    
    if (options.dateFrom) {
      queryParams.append('date-from', options.dateFrom.toISOString().split('T')[0]);
    }
    
    if (options.dateTo) {
      queryParams.append('date-to', options.dateTo.toISOString().split('T')[0]);
    }
    
    if (options.courtLevel) {
      queryParams.append('court', options.courtLevel);
    }
    
    if (options.documentTypes && options.documentTypes.length) {
      queryParams.append('doc-types', options.documentTypes.join(','));
    }
    
    // Call Westlaw API
    const response = await axios.get(`${config.baseUrl}/v2/search?${queryParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Parse results
    const data = response.data;
    const results: LegalSearchResult[] = data.results.map((item: any) => ({
      id: item.id,
      title: item.title,
      source: 'westlaw',
      citation: item.citation || 'N/A',
      court: item.court,
      date: item.date ? new Date(item.date) : undefined,
      snippet: item.snippet,
      url: item.url,
      score: item.score || 0.5
    }));
    
    return {
      results,
      total: data.total || results.length
    };
  } catch (error) {
    logger.error('Westlaw search error:', error);
    return { results: [], total: 0 };
  }
}

/**
 * Search LexisNexis database
 */
async function searchLexisNexis(
  options: SearchOptions,
  config: any
): Promise<{ results: LegalSearchResult[]; total: number }> {
  try {
    // Build LexisNexis-specific query
    const queryBody = {
      query: options.query,
      filters: {}
    };
    
    if (options.jurisdiction) {
      queryBody.filters.jurisdiction = options.jurisdiction;
    }
    
    if (options.dateFrom || options.dateTo) {
      queryBody.filters.date = {};
      if (options.dateFrom) {
        queryBody.filters.date.from = options.dateFrom.toISOString().split('T')[0];
      }
      if (options.dateTo) {
        queryBody.filters.date.to = options.dateTo.toISOString().split('T')[0];
      }
    }
    
    if (options.courtLevel) {
      queryBody.filters.court = options.courtLevel;
    }
    
    if (options.documentTypes && options.documentTypes.length) {
      queryBody.filters.documentTypes = options.documentTypes;
    }
    
    // Call LexisNexis API
    const response = await axios.post(`${config.baseUrl}/search`, queryBody, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Parse results
    const data = response.data;
    const results: LegalSearchResult[] = data.results.map((item: any) => ({
      id: item.id || uuidv4(),
      title: item.title,
      source: 'lexisnexis',
      citation: item.citation || 'N/A',
      court: item.court,
      date: item.date ? new Date(item.date) : undefined,
      snippet: item.snippet || item.summary,
      url: item.url,
      score: item.relevance || 0.5
    }));
    
    return {
      results,
      total: data.totalCount || results.length
    };
  } catch (error) {
    logger.error('LexisNexis search error:', error);
    return { results: [], total: 0 };
  }
}

/**
 * Retrieve a specific legal document
 */
export async function getLegalDocument(
  id: string,
  source: 'westlaw' | 'lexisnexis',
  userId: number
): Promise<LegalDocument | null> {
  const config = loadConfig();
  const db = getConnection();
  
  try {
    // First check if we have it cached
    const cached = await db.query(
      'SELECT * FROM legal_document_cache WHERE external_id = ? AND source = ?',
      [id, source]
    );
    
    if (cached && cached.length > 0) {
      return {
        id: cached[0].external_id,
        title: cached[0].title,
        source: cached[0].source,
        citation: cached[0].citation,
        court: cached[0].court,
        date: cached[0].date ? new Date(cached[0].date) : undefined,
        content: cached[0].content,
        contentType: cached[0].content_type,
        metadata: JSON.parse(cached[0].metadata || '{}')
      };
    }
    
    // Not cached, retrieve from source
    let document: LegalDocument | null = null;
    
    if (source === 'westlaw' && config.integration?.westlaw?.apiKey) {
      document = await getWestlawDocument(id, config.integration.westlaw);
    } else if (source === 'lexisnexis' && config.integration?.lexisnexis?.apiKey) {
      document = await getLexisNexisDocument(id, config.integration.lexisnexis);
    }
    
    if (document) {
      // Cache the document
      await db.query(
        `INSERT INTO legal_document_cache 
         (external_id, source, title, citation, court, date, content, content_type, metadata, retrieved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          document.id,
          document.source,
          document.title,
          document.citation,
          document.court || null,
          document.date || null,
          document.content,
          document.contentType,
          JSON.stringify(document.metadata),
          new Date()
        ]
      );
      
      // Track retrieval for analytics
      await db.query(
        `INSERT INTO document_retrieve_history (user_id, external_id, source, retrieved_at)
         VALUES (?, ?, ?, ?)`,
        [userId, document.id, document.source, new Date()]
      );
    }
    
    return document;
  } catch (error) {
    logger.error(`Error retrieving legal document ${id} from ${source}:`, error);
    return null;
  }
}

/**
 * Get document from Westlaw
 */
async function getWestlawDocument(id: string, config: any): Promise<LegalDocument | null> {
  try {
    const response = await axios.get(`${config.baseUrl}/v2/documents/${id}`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json'
      }
    });
    
    const data = response.data;
    
    return {
      id: data.id,
      title: data.title,
      source: 'westlaw',
      citation: data.citation,
      court: data.court,
      date: data.date ? new Date(data.date) : undefined,
      content: data.content,
      contentType: data.format || 'text/html',
      metadata: data.metadata || {}
    };
  } catch (error) {
    logger.error(`Westlaw document retrieval error for ${id}:`, error);
    return null;
  }
}

/**
 * Get document from LexisNexis
 */
async function getLexisNexisDocument(id: string, config: any): Promise<LegalDocument | null> {
  try {
    const response = await axios.get(`${config.baseUrl}/documents/${id}`, {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json'
      }
    });
    
    const data = response.data;
    
    return {
      id: data.id,
      title: data.title,
      source: 'lexisnexis',
      citation: data.citation,
      court: data.court,
      date: data.date ? new Date(data.date) : undefined,
      content: data.content,
      contentType: data.contentType || 'text/html',
      metadata: data.metadata || {}
    };
  } catch (error) {
    logger.error(`LexisNexis document retrieval error for ${id}:`, error);
    return null;
  }
}

/**
 * Extract legal citations from text
 */
export function extractCitations(text: string): string[] {
  // Find common legal citation formats
  const citations: string[] = [];
  
  // U.S. Reports citations (e.g., 347 U.S. 483)
  const usReportsRegex = /\d+\s+U\.S\.\s+\d+/g;
  const usReports = text.match(usReportsRegex) || [];
  citations.push(...usReports);
  
  // Federal Reporter citations (e.g., 410 F.2d 701)
  const fedReporterRegex = /\d+\s+F\.\d+d\s+\d+/g;
  const fedReporter = text.match(fedReporterRegex) || [];
  citations.push(...fedReporter);
  
  // State reporter citations (e.g., 160 N.E.2d 542)
  const stateReporterRegex = /\d+\s+[A-Z]\.[A-Z]\.\d+d\s+\d+/g;
  const stateReporter = text.match(stateReporterRegex) || [];
  citations.push(...stateReporter);
  
  // Statutes (e.g., 42 U.S.C. § 1983)
  const statuteRegex = /\d+\s+U\.S\.C\.\s+§\s+\d+/g;
  const statutes = text.match(statuteRegex) || [];
  citations.push(...statutes);
  
  return [...new Set(citations)]; // Remove duplicates
}

/**
 * Add a legal database document reference to a case document
 */
export async function addLegalReference(
  documentId: number,
  externalId: string,
  source: 'westlaw' | 'lexisnexis',
  citation: string,
  context: string,
  userId: number
): Promise<boolean> {
  const db = getConnection();
  
  try {
    await db.query(
      `INSERT INTO legal_references
       (document_id, external_id, source, citation, context, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        documentId,
        externalId,
        source,
        citation,
        context,
        userId,
        new Date()
      ]
    );
    
    return true;
  } catch (error) {
    logger.error('Error adding legal reference:', error);
    return false;
  }
}

/**
 * Get legal references for a document
 */
export async function getDocumentLegalReferences(documentId: number): Promise<any[]> {
  const db = getConnection();
  
  try {
    const references = await db.query(
      `SELECT lr.*, u.username as added_by_username
       FROM legal_references lr
       JOIN users u ON lr.added_by = u.id
       WHERE lr.document_id = ?
       ORDER BY lr.added_at DESC`,
      [documentId]
    );
    
    return references;
  } catch (error) {
    logger.error(`Error getting legal references for document ${documentId}:`, error);
    return [];
  }
}
