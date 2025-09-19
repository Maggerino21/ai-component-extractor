const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');
const AIExtractor = require('./aiExtractor');
const logger = require('../utils/logger');

class FileProcessor {
    constructor() {
        this.supportedFormats = ['.pdf', '.xlsx', '.xls'];
        this.aiExtractor = new AIExtractor();
    }

    async processFiles(filePaths, positionMappings = []) {
        const results = [];
        
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            const fileName = path.basename(filePath);
            const fileExt = path.extname(filePath).toLowerCase();
            
            console.log(`Processing file ${i + 1}/${filePaths.length}: ${fileName}`);
            
            try {
                let extractedData;
                
                switch (fileExt) {
                    case '.pdf':
                        extractedData = await this.processPDF(filePath);
                        break;
                    case '.xlsx':
                    case '.xls':
                        extractedData = await this.processExcel(filePath);
                        break;
                    default:
                        throw new Error(`Unsupported file format: ${fileExt}`);
                }

                const aiResult = await this.aiExtractor.extractComponents({
                    fileName,
                    type: fileExt === '.pdf' ? 'pdf' : 'excel',
                    ...extractedData
                }, positionMappings);

                results.push({
                    fileName,
                    filePath,
                    fileType: fileExt,
                    success: true,
                    data: extractedData,
                    aiExtraction: aiResult,
                    processedAt: new Date().toISOString()
                });
                
            } catch (error) {
                console.error(`Error processing ${fileName}:`, error.message);
                results.push({
                    fileName,
                    filePath,
                    fileType: fileExt,
                    success: false,
                    error: error.message,
                    processedAt: new Date().toISOString()
                });
            }
        }
        
        return results;
    }

    async processPDF(filePath) {
        const dataBuffer = fs.readFileSync(filePath);
        
        try {
            // Configure PDF parse without worker - use simple mode
            const pdfData = await pdfParse(dataBuffer, {
                normalizeWhitespace: false,
                disableCombineTextItems: false,
                // Don't set any worker options to avoid the PDFJS.workerSrc error
                max: 0  // No limit on pages
            });
            
            const result = {
                type: 'pdf',
                pageCount: pdfData.numpages,
                text: pdfData.text,
                extractionMethod: 'text',
                isEmpty: !pdfData.text || pdfData.text.trim().length === 0,
                keywords: this.extractKeywords(pdfData.text)
            };

            if (result.isEmpty) {
                console.log('No text found in PDF, attempting OCR...');
                result.text = await this.performOCR(dataBuffer);
                result.extractionMethod = 'ocr';
                result.keywords = this.extractKeywords(result.text);
            }

            result.possibleComponents = this.findPossibleComponents(result.text);
            result.possibleMooringLines = this.findPossibleMooringLines(result.text);

            return result;
        } catch (error) {
            console.error('PDF parsing error:', error);
            // If PDF parsing fails completely, try OCR as fallback
            try {
                console.log('PDF text extraction failed, trying OCR fallback...');
                const ocrText = await this.performOCR(dataBuffer);
                return {
                    type: 'pdf',
                    pageCount: 1, // Unknown
                    text: ocrText,
                    extractionMethod: 'ocr_fallback',
                    isEmpty: !ocrText || ocrText.trim().length === 0,
                    keywords: this.extractKeywords(ocrText),
                    possibleComponents: this.findPossibleComponents(ocrText),
                    possibleMooringLines: this.findPossibleMooringLines(ocrText)
                };
            } catch (ocrError) {
                throw new Error(`PDF processing failed: ${error.message}. OCR fallback also failed: ${ocrError.message}`);
            }
        }
    }

    async processExcel(filePath) {
        try {
            const workbook = XLSX.readFile(filePath);
            const result = {
                type: 'excel',
                sheetNames: workbook.SheetNames,
                sheets: []
            };

            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                const objectData = XLSX.utils.sheet_to_json(worksheet);
                
                const sheetInfo = {
                    name: sheetName,
                    rowCount: jsonData.length,
                    columnCount: jsonData[0] ? jsonData[0].length : 0,
                    headers: jsonData[0] || [],
                    rawData: jsonData,
                    objectData: objectData,
                    possibleComponents: this.findComponentsInSheet(objectData),
                    possibleMooringLines: this.findMooringLinesInSheet(objectData)
                };

                result.sheets.push(sheetInfo);
            });

            return result;
        } catch (error) {
            throw new Error(`Excel processing failed: ${error.message}`);
        }
    }

    async performOCR(dataBuffer) {
        try {
            const { data: { text } } = await Tesseract.recognize(dataBuffer, 'nor+eng', {
                logger: m => console.log(m)
            });
            return text;
        } catch (error) {
            console.error('OCR failed:', error);
            return '';
        }
    }

    extractKeywords(text) {
        if (!text) return [];
        
        const aquacultureKeywords = [
            'anker', 'anchor', 'sjakkel', 'shackle', 'kjetting', 'chain', 
            'trosse', 'rope', 'bøye', 'buoy', 'spleis', 'splice',
            'fortøyning', 'mooring', 'line', 'posisjon', 'position',
            'tonn', 'ton', 'meter', 'kg', 'diameter', 'lengde', 'length'
        ];
        
        const foundKeywords = [];
        const lowerText = text.toLowerCase();
        
        aquacultureKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = lowerText.match(regex);
            if (matches) {
                foundKeywords.push({
                    keyword: keyword,
                    count: matches.length
                });
            }
        });
        
        return foundKeywords;
    }

    findPossibleComponents(text) {
        if (!text) return [];
        
        const components = [];
        const lines = text.split('\n');
        
        lines.forEach((line, lineIndex) => {
            const lowerLine = line.toLowerCase();
            
            // Look for component indicators
            if (lowerLine.includes('anker') || lowerLine.includes('anchor')) {
                components.push({
                    type: 'anchor',
                    description: line.trim(),
                    lineNumber: lineIndex + 1,
                    confidence: 0.8
                });
            }
            
            if (lowerLine.includes('sjakkel') || lowerLine.includes('shackle')) {
                components.push({
                    type: 'shackle',
                    description: line.trim(),
                    lineNumber: lineIndex + 1,
                    confidence: 0.8
                });
            }
            
            if (lowerLine.includes('kjetting') || lowerLine.includes('chain')) {
                components.push({
                    type: 'chain',
                    description: line.trim(),
                    lineNumber: lineIndex + 1,
                    confidence: 0.8
                });
            }
            
            if (lowerLine.includes('trosse') || lowerLine.includes('rope')) {
                components.push({
                    type: 'rope',
                    description: line.trim(),
                    lineNumber: lineIndex + 1,
                    confidence: 0.8
                });
            }
            
            if (lowerLine.includes('bøye') || lowerLine.includes('buoy')) {
                components.push({
                    type: 'buoy',
                    description: line.trim(),
                    lineNumber: lineIndex + 1,
                    confidence: 0.8
                });
            }
        });
        
        return components;
    }

    findPossibleMooringLines(text) {
        if (!text) return [];
        
        const mooringLines = [];
        const patterns = [
            /line\s*(\d+[a-z]?)/gi,
            /linje\s*(\d+[a-z]?)/gi,
            /(\d+[a-z]?)\s*line/gi,
            /posisjon\s*(\d+[a-z]?)/gi,
            /position\s*(\d+[a-z]?)/gi
        ];
        
        patterns.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                mooringLines.push({
                    reference: match[1],
                    context: match[0],
                    fullMatch: match.input.substring(Math.max(0, match.index - 50), match.index + 50)
                });
            });
        });
        
        return mooringLines;
    }

    findComponentsInSheet(data) {
        const components = [];
        
        data.forEach((row, rowIndex) => {
            const rowText = Object.values(row).join(' ').toLowerCase();
            
            if (rowText.includes('anker') || rowText.includes('anchor') ||
                rowText.includes('sjakkel') || rowText.includes('shackle') ||
                rowText.includes('kjetting') || rowText.includes('chain') ||
                rowText.includes('trosse') || rowText.includes('rope') ||
                rowText.includes('bøye') || rowText.includes('buoy')) {
                
                components.push({
                    rowIndex: rowIndex + 1,
                    data: row,
                    description: rowText
                });
            }
        });
        
        return components;
    }

    findMooringLinesInSheet(data) {
        const mooringLines = [];
        
        data.forEach((row, rowIndex) => {
            const rowText = Object.values(row).join(' ').toLowerCase();
            
            if (rowText.includes('line') || rowText.includes('linje') ||
                rowText.includes('posisjon') || rowText.includes('position')) {
                
                mooringLines.push({
                    rowIndex: rowIndex + 1,
                    data: row,
                    description: rowText
                });
            }
        });
        
        return mooringLines;
    }

    findPossibleReference(text) {
        if (!text) return null;
        
        const patterns = [
            /([1-9]\d*[a-z]?)\s*(?:line|linje)/i,
            /(?:line|linje)\s*([1-9]\d*[a-z]?)/i,
            /position\s*([1-9]\d*[a-z]?)/i,
            /posisjon\s*([1-9]\d*[a-z]?)/i,
            /([1-9]\d*[a-z]?)[\s]*line/i,
            /position[\s]*([1-9]\d*[a-z]?)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1];
        }
        
        return null;
    }

    getProcessingSummary(results) {
        const summary = {
            totalFiles: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => r.success === false).length,
            pdfFiles: results.filter(r => r.fileType === '.pdf').length,
            excelFiles: results.filter(r => ['.xlsx', '.xls'].includes(r.fileType)).length,
            totalComponents: 0,
            totalMooringLines: 0,
            aiComponentsFound: 0,
            aiPositionsFound: 0,
            errors: []
        };

        results.forEach(result => {
            if (result.success) {
                const data = result.data;
                if (data.possibleComponents) {
                    summary.totalComponents += data.possibleComponents.length;
                }
                if (data.possibleMooringLines) {
                    summary.totalMooringLines += data.possibleMooringLines.length;
                }
                if (data.sheets) {
                    data.sheets.forEach(sheet => {
                        summary.totalComponents += sheet.possibleComponents?.length || 0;
                        summary.totalMooringLines += sheet.possibleMooringLines?.length || 0;
                    });
                }

                if (result.aiExtraction && result.aiExtraction.success) {
                    const aiData = result.aiExtraction.data;
                    summary.aiComponentsFound += aiData.extraction_summary?.total_components || 0;
                    summary.aiPositionsFound += aiData.extraction_summary?.total_configurations || 0;
                }
            } else {
                summary.errors.push({
                    file: result.fileName,
                    error: result.error
                });
            }
        });

        return summary;
    }

    validateFileSupport(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedFormats.includes(ext);
    }
}

module.exports = FileProcessor;