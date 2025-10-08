const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');
const AzureDocumentExtractor = require('./azureDocumentExtractor');
const GPTExcelEnhancer = require('./gptExcelEnhancer');
const logger = require('../utils/logger');

class FileProcessor {
    constructor() {
        this.azureExtractor = new AzureDocumentExtractor();
        this.gptExcelEnhancer = new GPTExcelEnhancer();
        this.supportedFileTypes = ['.pdf', '.xlsx', '.xls'];
    }

    async processFiles(filePaths, positionMappings = []) {
        const results = [];
        
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            console.log(`Processing file ${i + 1}/${filePaths.length}: ${path.basename(filePath)}`);
            
            try {
                const result = await this.processFile(filePath, positionMappings);
                results.push(result);
            } catch (error) {
                logger.error(`File processing failed for ${filePath}`, error);
                results.push({
                    fileName: path.basename(filePath),
                    filePath: filePath,
                    success: false,
                    error: error.message,
                    fileType: path.extname(filePath).toLowerCase(),
                    data: null,
                    aiExtraction: null
                });
            }
        }
        
        return results;
    }

    async processFile(filePath, positionMappings = []) {
        const fileName = path.basename(filePath);
        const fileType = path.extname(filePath).toLowerCase();
        
        if (!this.validateFileSupport(filePath)) {
            throw new Error(`Unsupported file type: ${fileType}`);
        }
        
        let fileData;
        let aiExtraction;
        
        if (fileType === '.pdf') {
            fileData = await this.processPDF(filePath);
            logger.info('Using Azure Document Intelligence for PDF');
            aiExtraction = await this.azureExtractor.extractComponents(fileData, positionMappings);
        } else if (['.xlsx', '.xls'].includes(fileType)) {
            fileData = await this.processExcel(filePath);
            logger.info('Using GPT-4o-mini for Excel enhancement');
            aiExtraction = await this.gptExcelEnhancer.enhanceExcelData(fileData, positionMappings);
        }
        
        fileData.fileName = fileName;
        fileData.filePath = filePath;
        fileData.fileType = fileType;
        
        return {
            fileName,
            filePath,
            fileType,
            success: true,
            data: fileData,
            aiExtraction: aiExtraction,
            processedAt: new Date().toISOString()
        };
    }

    async processExcel(filePath) {
        const workbook = XLSX.readFile(filePath);
        const sheets = [];
        let totalComponents = 0;
        
        workbook.SheetNames.forEach(sheetName => {
            console.log(`Processing sheet: ${sheetName}`);
            
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            console.log(`Parsing ${jsonData.length} rows from sheet ${sheetName}`);
            
            const possibleComponents = [];
            
            jsonData.forEach((row, rowIndex) => {
                if (Array.isArray(row) && row.length >= 3) {
                    const rowText = row.filter(cell => cell !== null && cell !== undefined && cell !== '').join(' | ');
                    
                    if (rowText.trim() && this.isLikelyComponentRow(rowText)) {
                        possibleComponents.push(rowText);
                        console.log(`Found component: ${rowText}`);
                    }
                }
            });
            
            console.log(`Extracted ${possibleComponents.length} components from ${sheetName}`);
            totalComponents += possibleComponents.length;
            
            sheets.push({
                name: sheetName,
                rowCount: jsonData.length,
                possibleComponents: possibleComponents,
                rawData: jsonData.slice(0, 10)
            });
        });
        
        return {
            type: 'excel',
            totalSheets: sheets.length,
            totalComponents: totalComponents,
            sheets: sheets,
            possibleComponents: []
        };
    }

    isLikelyComponentRow(rowText) {
        const componentIndicators = [
            /sjakkel|ploganker|anker|kjetting|trosse|tau|wire|kause/i,
            /fortøyning|mooring|anchor|chain|rope|shackle|connector/i,
            /^[A-Z]\d{2}[A-Z]?\s*\|/i,
            /^[A-Z]+\d+\s*\|/i,
            /\|\s*\d+\s*\|/,
            /\d{4,}/,
            /koblingspunkt|koblingsskive/i
        ];
        
        return componentIndicators.some(pattern => pattern.test(rowText));
    }

    async processPDF(filePath) {
        const buffer = fs.readFileSync(filePath);
        let parsedData;
        let extractionMethod = 'text';
        
        try {
            parsedData = await pdfParse(buffer);
        } catch (error) {
            logger.warn('PDF text extraction failed, trying OCR', error);
            parsedData = await this.extractPDFWithOCR(buffer);
            extractionMethod = 'ocr';
        }
        
        const text = parsedData.text || '';
        
        return {
            type: 'pdf',
            pageCount: parsedData.numpages || 0,
            text: text,
            extractionMethod: extractionMethod,
            keywords: this.extractKeywords(text),
            possibleMooringLines: this.findMooringLineReferences(text)
        };
    }

    async extractPDFWithOCR(buffer) {
        try {
            const result = await Tesseract.recognize(buffer, 'nor', {
                logger: m => console.log('OCR progress:', m)
            });
            
            return {
                text: result.data.text,
                numpages: 1
            };
        } catch (error) {
            logger.error('OCR extraction failed', error);
            throw new Error('Both text extraction and OCR failed');
        }
    }

    extractKeywords(text) {
        const keywords = [
            'fortøyning', 'mooring', 'anchor', 'anker', 'ploganker',
            'sjakkel', 'shackle', 'kjetting', 'chain', 'trosse', 'rope',
            'tau', 'wire', 'kause', 'thimble', 'bøye', 'buoy'
        ];
        
        return keywords.filter(keyword => 
            new RegExp(keyword, 'i').test(text)
        );
    }

    findMooringLineReferences(text) {
        const mooringLines = [];
        
        const patterns = [
            /line\s+(\d+[a-z]?)/gi,
            /linje\s+(\d+[a-z]?)/gi,
            /(\d+[a-z]?)\s*line/gi,
            /posisjon\s*(\d+[a-z]?)/gi,
            /position\s*(\d+[a-z]?)/gi,
            /[HS]\d{2}[AB]?/gi,
            /langsgående/gi,
            /tverrgående/gi,
            /kf-ho|ko-kn|kn-km/gi
        ];
        
        patterns.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                mooringLines.push({
                    reference: match[1] || match[0],
                    context: match[0],
                    fullMatch: match.input ? match.input.substring(Math.max(0, match.index - 50), match.index + 50) : ''
                });
            });
        });
        
        return mooringLines;
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
            totalCost: 0,
            totalTokens: 0,
            errors: []
        };

        results.forEach(result => {
            if (result.success) {
                const data = result.data;
                
                if (data.totalComponents) {
                    summary.totalComponents += data.totalComponents;
                }
                
                if (result.aiExtraction && result.aiExtraction.success) {
                    const aiData = result.aiExtraction.data;
                    if (aiData.component_groups) {
                        summary.aiPositionsFound += aiData.component_groups.length;
                        aiData.component_groups.forEach(group => {
                            summary.aiComponentsFound += group.components?.length || 0;
                        });
                    }
                    
                    if (aiData.metadata) {
                        summary.totalCost += aiData.metadata.estimated_cost || 0;
                        summary.totalTokens += aiData.metadata.tokens_used || 0;
                    }
                }
            } else {
                summary.errors.push({
                    fileName: result.fileName,
                    error: result.error
                });
            }
        });

        return summary;
    }

    validateFileSupport(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedFileTypes.includes(ext);
    }
}

module.exports = FileProcessor;