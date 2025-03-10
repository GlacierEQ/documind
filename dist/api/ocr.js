"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ocrRouter = void 0;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const uuid_1 = require("uuid");
const auth_1 = require("../auth/auth");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const enhancedProcessor_1 = require("../ocr/enhancedProcessor");
const connection_1 = require("../database/connection");
exports.ocrRouter = express_1.default.Router();
// Set up temporary storage for uploaded files
const tempStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const tempDir = path_1.default.join(process.cwd(), 'temp');
        // Create directory if it doesn't exist
        if (!(0, fs_1.existsSync)(tempDir)) {
            fs.mkdir(tempDir, { recursive: true })
                .then(() => cb(null, tempDir))
                .catch(err => cb(err, tempDir));
        }
        else {
            cb(null, tempDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${(0, uuid_1.v4)()}`;
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${uniqueName}${ext}`);
    }
});
const upload = (0, multer_1.default)({
    storage: tempStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
    fileFilter: (req, file, cb) => {
        // Accept only PDFs and images
        const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|pdf/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        }
        else {
            cb(new Error('Only image files and PDFs are allowed'));
        }
    }
});
// Process file with OCR
exports.ocrRouter.post('/process', auth_1.isAuthenticated, upload.single('file'), async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('ocr-api-process');
        const userId = req.user.id;
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
        const result = await (0, enhancedProcessor_1.processDocumentWithOCR)(filePath, options);
        // Record the OCR request for analytics
        const db = (0, connection_1.getConnection)();
        await db.query(`INSERT INTO ocr_history 
       (user_id, original_filename, confidence, processing_time, ocr_engine, options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            userId,
            req.file.originalname,
            result.confidence,
            result.processingTime,
            'enhanced',
            JSON.stringify(options),
            new Date()
        ]);
        // Clean up the temporary file
        await fs.unlink(filePath).catch(() => {
            logger_1.logger.warn(`Failed to delete temporary file: ${filePath}`);
        });
        logger_1.logger.info(`OCR API processed file in ${perfEnd()}ms with confidence ${result.confidence.toFixed(2)}`);
        // Return OCR results
        res.json({
            text: result.text,
            confidence: result.confidence,
            tableCount: result.tables.length,
            formattedText: result.formattedText,
            pageCount: result.pages.length,
            processingTime: result.processingTime
        });
    }
    catch (error) {
        logger_1.logger.error('Error in OCR processing API:', error);
        // Clean up file if it exists
        if (req.file) {
            await fs.unlink(req.file.path).catch(() => { });
        }
        res.status(500).json({
            error: 'OCR processing failed',
            message: error.message
        });
    }
});
// Process existing document with OCR
exports.ocrRouter.post('/process/:documentId', auth_1.isAuthenticated, async (req, res) => {
    try {
        const perfEnd = logger_1.performance.start('ocr-existing-document');
        const documentId = parseInt(req.params.documentId);
        const userId = req.user.id;
        const db = (0, connection_1.getConnection)();
        const config = (0, config_1.loadConfig)();
        // Check document access
        const docs = await db.query(`SELECT d.*
       FROM documents d
       WHERE d.id = ? AND (
         d.uploaded_by = ? OR d.id IN (
           SELECT document_id FROM document_shares WHERE shared_with = ?
         )
       )`, [documentId, userId, userId]);
        if (!docs || docs.length === 0) {
            return res.status(404).json({ error: 'Document not found or access denied' });
        }
        const doc = docs[0];
        // Check if file exists
        if (!(0, fs_1.existsSync)(doc.path)) {
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
        const result = await (0, enhancedProcessor_1.processDocumentWithOCR)(doc.path, options);
        // Update document index with improved OCR text
        await db.query(`INSERT OR REPLACE INTO document_index
       (document_id, text_content, updated_at)
       VALUES (?, ?, ?)`, [documentId, result.text, new Date()]);
        // Record OCR history
        await db.query(`INSERT INTO ocr_history 
       (user_id, document_id, confidence, processing_time, ocr_engine, options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            userId,
            documentId,
            result.confidence,
            result.processingTime,
            'enhanced',
            JSON.stringify(options),
            new Date()
        ]);
        // If tables were detected, store them
        if (result.tables.length > 0) {
            await db.query(`INSERT OR REPLACE INTO document_tables
         (document_id, table_data, updated_at)
         VALUES (?, ?, ?)`, [documentId, JSON.stringify(result.tables), new Date()]);
        }
        logger_1.logger.info(`Re-OCR processed document ${documentId} in ${perfEnd()}ms with confidence ${result.confidence.toFixed(2)}`);
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
    }
    catch (error) {
        logger_1.logger.error('Error in re-OCR processing API:', error);
        res.status(500).json({
            error: 'OCR processing failed',
            message: error.message
        });
    }
});
// Get OCR options/settings
exports.ocrRouter.get('/options', auth_1.isAuthenticated, (req, res) => {
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
    }
    catch (error) {
        logger_1.logger.error('Error fetching OCR options:', error);
        res.status(500).json({ error: 'Failed to fetch OCR options' });
    }
});
