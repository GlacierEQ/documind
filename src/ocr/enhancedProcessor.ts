/**
 * Enhanced OCR Processing
 * Improved text extraction from scanned documents including complex layouts and tables
 */

import tesseract from 'node-tesseract-ocr';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { logger, performance } from '../utils/logger';
import { loadConfig } from '../config/config';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '../database/connection';
import sharp from 'sharp';
import * as pdf from 'pdf-parse';

// OCR Processing options
export interface OCROptions {
  enhancedMode?: boolean;
  detectTables?: boolean;
  preprocess?: boolean;
  language?: string;
  detectStructure?: boolean;
  oem?: number; // OCR Engine mode (0-3)
  psm?: number;  // Page segmentation mode (0-13)
}

// OCR result interface
export interface OCRResult {
  text: string;
  confidence: number;
  tables: OCRTable[];
  formattedText: string; // Text with layout preservation
  detectedLanguage?: string;
  pages: OCRPage[];
  processingTime: number;
}

// Table extracted from OCR
export interface OCRTable {
  id: string;
  rows: string[][];
  pageNum: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Page in OCR result
export interface OCRPage {
  pageNum: number;
  text: string;
  confidence: number;
  dimensions: {
    width: number;
    height: number;
  };
}

/**
 * Process a document with enhanced OCR
 */
export async function processDocumentWithOCR(
  filePath: string,
  options: OCROptions = {}
): Promise<OCRResult> {
  const perfEnd = performance.start('ocr-processing');
  const config = loadConfig();
  const tempDir = path.join(process.cwd(), 'temp');
  
  // Ensure temp directory exists
  await fs.mkdir(tempDir, { recursive: true });
  
  // Default result structure
  const result: OCRResult = {
    text: '',
    confidence: 0,
    tables: [],
    formattedText: '',
    pages: [],
    processingTime: 0
  };
  
  try {
    // Check file type
    const fileExt = path.extname(filePath).toLowerCase();
    const isPdf = fileExt === '.pdf';
    
    // Process based on file type
    if (isPdf) {
      result.pages = await processPdf(filePath, tempDir, options);
    } else {
      const singlePage = await processImage(filePath, tempDir, options);
      result.pages = [singlePage];
    }
    
    // Extract tables if requested
    if (options.detectTables) {
      result.tables = await detectTables(filePath, result.pages, tempDir, options);
    }
    
    // Combine page results
    result.text = result.pages.map(page => page.text).join('\n\n');
    
    // Calculate overall confidence
    const totalConfidence = result.pages.reduce((sum, page) => sum + page.confidence, 0);
    result.confidence = result.pages.length > 0 ? totalConfidence / result.pages.length : 0;
    
    // Generate structured text with layout preservation
    result.formattedText = await preserveLayout(result.pages, result.tables);
    
    // Record processing time
    const processingTime = perfEnd();
    result.processingTime = processingTime;
    
    logger.info(`Enhanced OCR completed in ${processingTime}ms with confidence ${result.confidence.toFixed(2)}`);
    
    return result;
  } catch (error) {
    logger.error('Error in enhanced OCR processing:', error);
    throw new Error(`OCR processing failed: ${error.message}`);
  }
}

/**
 * Process PDF document for OCR
 */
async function processPdf(
  filePath: string,
  tempDir: string,
  options: OCROptions
): Promise<OCRPage[]> {
  // Load PDF file
  const dataBuffer = await fs.readFile(filePath);
  const pdfData = await pdf(dataBuffer);
  
  const pageCount = pdfData.numpages;
  logger.info(`Processing PDF with ${pageCount} pages`);
  
  const pages: OCRPage[] = [];
  
  // Extract each page as an image and process with OCR
  for (let i = 1; i <= pageCount; i++) {
    try {
      // Generate page image 
      // Note: We're using a hypothetical function here - in a real implementation
      // you would use a PDF library like pdf-lib, pdf-poppler, or ghostscript to
      // convert PDF pages to images
      const pageImagePath = await extractPdfPage(filePath, i, tempDir);
      
      // OCR the page image
      const pageResult = await processImage(pageImagePath, tempDir, options, i);
      pages.push(pageResult);
      
      // Clean up temp page image
      await fs.unlink(pageImagePath).catch(() => {});
    } catch (pageError) {
      logger.error(`Error processing PDF page ${i}:`, pageError);
      // Continue with next page if one fails
    }
  }
  
  return pages;
}

/**
 * Extract a single page from a PDF as an image
 */
async function extractPdfPage(
  pdfPath: string,
  pageNum: number,
  tempDir: string
): Promise<string> {
  const outputPath = path.join(tempDir, `page-${uuidv4()}.png`);
  
  // Use PDFium, Ghostscript, pdf-poppler or similar to convert
  // For this example we'll invoke a hypothetical CLI tool
  return new Promise((resolve, reject) => {
    const process = spawn('pdf-to-image', [
      '--input', pdfPath,
      '--output', outputPath,
      '--page', pageNum.toString(),
      '--dpi', '300' // Higher DPI for better OCR results
    ]);
    
    process.on('close', code => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        // Fallback to a simpler method if the tool fails
        logger.warn(`PDF page extraction tool failed with code ${code}, using fallback`);
        extractPdfPageFallback(pdfPath, pageNum, outputPath)
          .then(() => resolve(outputPath))
          .catch(reject);
      }
    });
  });
}

/**
 * Fallback method for PDF page extraction
 */
async function extractPdfPageFallback(
  pdfPath: string,
  pageNum: number,
  outputPath: string
): Promise<void> {
  // This is a placeholder for a fallback implementation
  // In a real system, you might use another library or approach
  throw new Error('Fallback PDF extraction not implemented');
}

/**
 * Process an image for OCR
 */
async function processImage(
  imagePath: string,
  tempDir: string,
  options: OCROptions,
  pageNum: number = 1
): Promise<OCRPage> {
  let processedImagePath = imagePath;
  
  // Apply image preprocessing if requested
  if (options.preprocess) {
    processedImagePath = await preprocessImage(imagePath, tempDir);
  }
  
  // Set up tesseract options
  const tesseractConfig: any = {
    lang: options.language || 'eng',
    oem: options.oem !== undefined ? options.oem : 1,
    psm: options.psm !== undefined ? options.psm : 3,
  };
  
  // Add configuration for enhanced mode
  if (options.enhancedMode) {
    tesseractConfig.tessedit_create_hocr = '1';
    tesseractConfig.tessedit_create_box = '1';
    tesseractConfig.tessedit_create_unlv = '1';
  }
  
  // Run OCR
  const ocrResult = await tesseract.recognize(processedImagePath, tesseractConfig);
  
  // Get image dimensions
  const imageInfo = await sharp(processedImagePath).metadata();
  const dimensions = {
    width: imageInfo.width || 0,
    height: imageInfo.height || 0
  };
  
  // Clean up if we created a processed image
  if (processedImagePath !== imagePath) {
    await fs.unlink(processedImagePath).catch(() => {});
  }
  
  // Parse HOCR for confidence and boxes if available
  let confidence = 0;
  
  if (typeof ocrResult === 'string') {
    // Basic result as string
    confidence = estimateConfidence(ocrResult);
  } else if (ocrResult.confidence) {
    // Direct confidence value
    confidence = ocrResult.confidence;
  }
  
  return {
    pageNum,
    text: typeof ocrResult === 'string' ? ocrResult : ocrResult.text || '',
    confidence,
    dimensions
  };
}

/**
 * Preprocess image for better OCR
 */
async function preprocessImage(
  imagePath: string,
  tempDir: string
): Promise<string> {
  // Create output path for processed image
  const processedPath = path.join(tempDir, `processed-${uuidv4()}${path.extname(imagePath)}`);
  
  try {
    // Apply a series of image processing steps to improve OCR
    await sharp(imagePath)
      // Convert to grayscale
      .grayscale()
      // Increase contrast
      .normalize()
      // Remove noise with mild blur
      .median(1)
      // Sharpen the image
      .sharpen({
        sigma: 1.5,
        flat: 1.0,
        jagged: 0.7
      })
      // Threshold to make text more distinct (if needed)
      //.threshold(128)
      // Save the processed image
      .toFile(processedPath);
    
    return processedPath;
  } catch (error) {
    logger.error('Image preprocessing failed:', error);
    return imagePath; // Return original if processing fails
  }
}

/**
 * Detect tables in document
 */
async function detectTables(
  filePath: string,
  pages: OCRPage[],
  tempDir: string,
  options: OCROptions
): Promise<OCRTable[]> {
  const tables: OCRTable[] = [];
  
  // For PDF files, we'd need to process each page
  for (let i = 0; i < pages.length; i++) {
    try {
      // Extract image for the current page
      let pageImagePath: string;
      
      if (pages.length > 1) {
        // This is a multi-page document (e.g. PDF)
        pageImagePath = await extractPdfPage(filePath, i + 1, tempDir);
      } else {
        // Single image document
        pageImagePath = filePath;
      }
      
      // Detect tables on this page
      const pageTables = await detectTablesInImage(pageImagePath, i + 1, tempDir);
      tables.push(...pageTables);
      
      // Clean up temp images if needed
      if (pages.length > 1) {
        await fs.unlink(pageImagePath).catch(() => {});
      }
    } catch (error) {
      logger.error(`Error detecting tables on page ${i + 1}:`, error);
    }
  }
  
  return tables;
}

/**
 * Detect tables in a single image
 */
async function detectTablesInImage(
  imagePath: string,
  pageNum: number,
  tempDir: string
): Promise<OCRTable[]> {
  // This would normally use a dedicated table detection library or model
  // such as Tabula, camelot-py, or a custom CV model
  
  // For this example, we'll use a hypothetical table detection CLI tool
  const outputJsonPath = path.join(tempDir, `tables-${uuidv4()}.json`);
  
  return new Promise((resolve, reject) => {
    const process = spawn('detect-tables', [
      '--input', imagePath,
      '--output', outputJsonPath,
      '--format', 'json'
    ]);
    
    process.on('close', async code => {
      if (code === 0) {
        try {
          // Read and parse the detected tables
          const jsonData = await fs.readFile(outputJsonPath, 'utf8');
          const tableData = JSON.parse(jsonData);
          
          // Convert to our format
          const tables: OCRTable[] = tableData.tables.map((table: any, idx: number) => ({
            id: `table-${pageNum}-${idx}`,
            rows: table.data || [],
            pageNum: pageNum,
            boundingBox: table.bbox || { x: 0, y: 0, width: 0, height: 0 }
          }));
          
          // Clean up
          await fs.unlink(outputJsonPath).catch(() => {});
          
          resolve(tables);
        } catch (error) {
          logger.error('Error parsing table detection results:', error);
          resolve([]);
        }
      } else {
        // If table detection fails, return empty result
        logger.warn(`Table detection failed with code ${code}`);
        resolve([]);
      }
    });
  });
}

/**
 * Format OCR result to preserve document layout
 */
async function preserveLayout(
  pages: OCRPage[],
  tables: OCRTable[]
): Promise<string> {
  // In a real implementation, this would use positioning data from HOCR
  // to rebuild the document layout. For this example, we'll do a simpler approach.
  
  let result = '';
  
  // Process each page
  for (const page of pages) {
    // Add page separator
    if (result) {
      result += '\n\n------ Page Break ------\n\n';
    }
    
    // Get tables for this page
    const pageTables = tables.filter(t => t.pageNum === page.pageNum);
    
    // If no tables, just use the page text
    if (pageTables.length === 0) {
      result += page.text;
      continue;
    }
    
    // We have tables, need to merge tables with text
    // This is a simplified approach - real implementation would be more complex
    result += `${page.text}\n\n`;
    
    // Add table data
    for (let i = 0; i < pageTables.length; i++) {
      const table = pageTables[i];
      result += `\n[TABLE ${i + 1}]\n`;
      
      // Format table rows
      for (const row of table.rows) {
        result += row.join(' | ') + '\n';
      }
      
      result += `[END TABLE ${i + 1}]\n\n`;
    }
  }
  
  return result;
}

/**
 * Estimate OCR confidence from text output
 */
function estimateConfidence(text: string): number {
  // This is a naive approach - real confidence estimation would use
  // more sophisticated metrics from the OCR engine
  
  // Check for common OCR errors
  const totalChars = text.length;
  if (totalChars === 0) return 0;
  
  // Count suspicious character sequences
  const suspiciousPatterns = [
    /[a-z][A-Z][a-z]/g,  // Unexpected capitalization
    /\d[a-zA-Z]\d/g,     // Mixed digit-letter-digit
    /[a-zA-Z]\d[a-zA-Z]/g, // Mixed letter-digit-letter
    /[^\x00-\x7F]/g,     // Non-ASCII characters
    /[^a-zA-Z0-9\s.,;:!?()[\]{}@#$%^&*+\-=_"'`~<>\/\\|]/g // Unusual symbols
  ];
  
  let suspiciousCount = 0;
  for (const pattern of suspiciousPatterns) {
    const matches = text.match(pattern) || [];
    suspiciousCount += matches.length;
  }
  
  // Check for missing spaces between words
  const missingSpaces = (text.match(/[a-z][A-Z]/g) || []).length;
  suspiciousCount += missingSpaces;
  
  // Calculate basic confidence score
  let confidence = 1 - (suspiciousCount / totalChars);
  
  // Adjust for text length - very short results are less reliable
  if (totalChars < 20) {
    confidence *= 0.8;
  }
  
  // Clamp to valid range
  return Math.max(0, Math.min(1, confidence));
}
