import express from 'express';
import multer from 'multer';
import path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { isAuthenticated } from '../auth/auth';
import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';
import { processDocumentWithOCR } from '../ocr/enhancedProcessor';
import { getConnection } from '../database/connection';

export const ocrRouter = express.Router();

// Set up temporary storage for uploaded files
const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(process.cwd(), 'temp');
    
    // Create directory if it doesn't exist
    if (!existsSync(tempDir)) {
      fs.mkdir(tempDir, { recursive: true })
        .then(() => cb(null, tempDir))
        .catch(err => cb(err, tempDir));
    } else {
      cb(null, tempDir);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueName}${ext}`);
  }
});

const upload = multer({ 
  storage: tempStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    // Accept only PDFs and images
    const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files and PDFs are allowed'));
    }
  }
});

// Process file with OCR
ocrRouter.post('/process', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const perfEnd = performance.start('ocr-api-process');
    const userId = (req.user as any).id;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    
    // Parse OCR options from request
    const options = {
      enhancedMode: req.body.enhancedMode === 'true',
      detectTables: req.body.detectTables === 'true',
      preprocess: req.body.preprocess === 'true',
      language: req.body.language || 'eng',
      detectStructure: req.body.detectStructure === 'true',
      oem: req.body.oem ? parseInt(req.body.oem) : undefined,
      psm: req.body.psm ? parseInt(req.body.psm) : undefined
    };
    
    // Process the document with OCR
    const result = await processDocumentWithOCR(filePath, options);
    
    // Record the OCR request for analytics
    const db = getConnection();
    await db.query(
      `INSERT INTO ocr_history 
       (user_id, original_filename, confidence, processing_time, ocr_engine, options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, 
        req.file.originalname,
        result.confidence,
        result.processingTime,
        'enhanced',
        JSON.stringify(options),
        new Date()
      ]
    );
    
    // Clean up the temporary file
    await fs.unlink(filePath).catch(() => {
      logger.warn(`Failed to delete temporary file: ${filePath}`);
    });
    
    logger.info(`OCR API processed file in ${perfEnd()}ms with confidence ${result.confidence.toFixed(2)}`);
    
    // Return OCR results
    res.json({
      text: result.text,
      confidence: result.confidence,
      tableCount: result.tables.length,
      formattedText: result.formattedText,
      pageCount: result.pages.length,
      processingTime: result.processingTime
    });
  } catch (error) {
    logger.error('Error in OCR processing API:', error);
    
    // Clean up file if it exists
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    
    res.status(500).json({
      error: 'OCR processing failed',
      message: error.message
    });
  }
});

// Process existing document with OCR
ocrRouter.post('/process/:documentId', isAuthenticated, async (req, res) => {
  try {
    const perfEnd = performance.start('ocr-existing-document');
    const documentId = parseInt(req.params.documentId);
    const userId = (req.user as any).id;
    const db = getConnection();
    const config = loadConfig();
    
    // Check document access
    const docs = await db.query(
      `SELECT d.*
       FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         )
       )`,
      [documentId, userId, userId]
    );
    
    if (!docs || docs.length === 0) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }
    
    const doc = docs[0];
    
    // Check if file exists
    if (!existsSync(doc.path)) {
      return res.status(404).json({ error: 'Document file not found' });
    }
    
    // Parse OCR options from request
    const options = {
      enhancedMode: req.body.enhancedMode === 'true',
      detectTables: req.body.detectTables === 'true',
      preprocess: req.body.preprocess === 'true',
      language: req.body.language || 'eng',
      detectStructure: req.body.detectStructure === 'true'
    };
    
    // Process the document with OCR
    const result = await processDocumentWithOCR(doc.path, options);
    
    // Update document index with improved OCR text
    await db.query(
      `INSERT OR REPLACE INTO document_index
       (document_id, text_content, updated_at)
       VALUES (?, ?, ?)`,
      [documentId, result.text, new Date()]
    );
    
    // Record OCR history
    await db.query(
      `INSERT INTO ocr_history 
       (user_id, document_id, confidence, processing_time, ocr_engine, options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, 
        documentId,
        result.confidence,
        result.processingTime,
        'enhanced',
        JSON.stringify(options),
        new Date()
      ]
    );
    
    // If tables were detected, store them
    if (result.tables.length > 0) {
      await db.query(
        `INSERT OR REPLACE INTO document_tables
         (document_id, table_data, updated_at)
         VALUES (?, ?, ?)`,
        [documentId, JSON.stringify(result.tables), new Date()]
      );
    }
    
    logger.info(`Re-OCR processed document ${documentId} in ${perfEnd()}ms with confidence ${result.confidence.toFixed(2)}`);
    
    res.json({
      success: true,
      textUpdated: true,
      text: result.text,
      confidence: result.confidence,
      tableCount: result.tables.length,
      formattedText: result.formattedText,
      pageCount: result.pages.length,
      processingTime: result.processingTime
    });
  } catch (error) {
    logger.error('Error in re-OCR processing API:', error);
    res.status(500).json({
      error: 'OCR processing failed',
      message: error.message
    });
  }
});

// Get OCR options/settings
ocrRouter.get('/options', isAuthenticated, (req, res) => {
  try {
    // Return available OCR languages and settings
    res.json({
      languages: [
        { code: 'eng', name: 'English' },
        { code: 'fra', name: 'French' },
        { code: 'deu', name: 'German' },
        { code: 'spa', name: 'Spanish' },
        { code: 'ita', name: 'Italian' },
        { code: 'jpn', name: 'Japanese' },
        { code: 'kor', name: 'Korean' },
        { code: 'chi_sim', name: 'Chinese Simplified' },
        { code: 'chi_tra', name: 'Chinese Traditional' },
        { code: 'rus', name: 'Russian' },
        { code: 'ara', name: 'Arabic' }
        // Add more languages as needed
      ],
      engineModes: [
        { value: 0, description: 'Legacy engine only' },
        { value: 1, description: 'Neural nets LSTM engine only' },
        { value: 2, description: 'Legacy + LSTM engines' },
        { value: 3, description: 'Default, based on what is available' }
      ],
      pageSegModes: [
        { value: 3, description: 'Fully automatic page segmentation (Default)' },
        { value: 4, description: 'Assume a single column of text' },
        { value: 6, description: 'Assume a single uniform block of text' },
        { value: 11, description: 'Sparse text. Find as much text as possible' },
        { value: 13, description: 'Raw line. Treat the image as a single text line' }
      ]
    });
  } catch (error) {
    logger.error('Error fetching OCR options:', error);
    res.status(500).json({ error: 'Failed to fetch OCR options' });
  }
});
