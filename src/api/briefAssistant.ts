import express from 'express';
import { isAuthenticated } from '../auth/auth';
import { logger, performance } from '../utils/logger';
import { 
  generateDocument,
  generateSection,
  BRIEF_TYPES,
  BRIEF_SECTIONS
} from '../ai/briefAssistant';
import { loadConfig } from '../config/config';

export const briefAssistantRouter = express.Router();

// Get available brief types and sections
briefAssistantRouter.get('/options', isAuthenticated, (req, res) => {
  try {
    const options = {
      briefTypes: BRIEF_TYPES,
      sectionTypes: BRIEF_SECTIONS
    };
    
    res.json(options);
  } catch (error) {
    logger.error('Error fetching brief assistant options:', error);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// Generate a complete document
briefAssistantRouter.post('/generate-document', isAuthenticated, async (req, res) => {
  try {
    const perfEnd = performance.start('generate-document-api');
    const userId = (req.user as any).id;
    const config = loadConfig();
    
    // Check if AI is enabled
    if (!config.ai?.provider || config.ai.provider === 'none') {
      return res.status(400).json({ 
        error: 'AI provider not configured',
        message: 'Please enable and configure an AI provider in your settings.'
      });
    }
    
    const {
      documentType,
      caseDescription,
      relevantFacts,
      legalIssues,
      clientGoals,
      jurisdiction,
      tone,
      existingDocumentIds,
      includeAuthorities
    } = req.body;
    
    // Validate required fields
    if (!documentType || !caseDescription) {
      return res.status(400).json({ error: 'Document type and case description are required' });
    }
    
    // Generate the document
    const result = await generateDocument(
      {
        documentType,
        caseDescription,
        relevantFacts,
        legalIssues,
        clientGoals,
        jurisdiction,
        tone,
        existingDocumentIds,
        includeAuthorities
      },
      userId
    );
    
    logger.info(`Document generation API completed in ${perfEnd()}ms`);
    res.json(result);
    
  } catch (error) {
    logger.error('Error in generate document API:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate document',
    });
  }
});

// Generate a specific section
briefAssistantRouter.post('/generate-section', isAuthenticated, async (req, res) => {
  try {
    const perfEnd = performance.start('generate-section-api');
    const userId = (req.user as any).id;
    const config = loadConfig();
    
    // Check if AI is enabled
    if (!config.ai?.provider || config.ai.provider === 'none') {
      return res.status(400).json({ 
        error: 'AI provider not configured',
        message: 'Please enable and configure an AI provider in your settings.'
      });
    }
    
    const {
      briefType,
      sectionType,
      caseDescription,
      relevantFacts,
      existingContent,
      tone,
      length,
      keyPoints,
      jurisdiction
    } = req.body;
    
    // Validate required fields
    if (!briefType || !sectionType || !caseDescription) {
      return res.status(400).json({ error: 'Brief type, section type, and case description are required' });
    }
    
    // Generate the section
    const result = await generateSection(
      {
        briefType,
        sectionType,
        caseDescription,
        relevantFacts,
        existingContent,
        tone: tone as any,
        length: length as any,
        keyPoints,
        jurisdiction
      },
      userId
    );
    
    logger.info(`Section generation API completed in ${perfEnd()}ms`);
    res.json(result);
    
  } catch (error) {
    logger.error('Error in generate section API:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate section',
    });
  }
});

// Save generated content as document
briefAssistantRouter.post('/save-as-document', isAuthenticated, async (req, res) => {
  try {
    const userId = (req.user as any).id;
    
    const {
      title,
      content,
      folderId
    } = req.body;
    
    // Validate required fields
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    
    // Import document creation functionality
    const { createDocumentFromText } = await import('../api/documents');
    
    // Create the document
    const documentId = await createDocumentFromText(
      title,
      content,
      userId,
      folderId
    );
    
    res.json({ 
      success: true, 
      documentId,
      message: 'Document created successfully'
    });
    
  } catch (error) {
    logger.error('Error saving generated content as document:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});
