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
            const pdfData = await pdfParse(dataBuffer, {
                normalizeWhitespace: false,
                disableCombineTextItems: false,
                max: 0
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
            try {
                console.log('PDF text extraction failed, trying OCR fallback...');
                const ocrText = await this.performOCR(dataBuffer);
                return {
                    type: 'pdf',
                    pageCount: 1,
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
                
                console.log(`Processing sheet: ${sheetName} with ${objectData.length} rows`);
                
                const sheetInfo = {
                    name: sheetName,
                    rowCount: jsonData.length,
                    columnCount: jsonData[0] ? jsonData[0].length : 0,
                    headers: jsonData[0] || [],
                    rawData: jsonData,
                    objectData: objectData,
                    possibleComponents: this.parseSkrubbholmenData(objectData, sheetName),
                    possibleMooringLines: []
                };

                result.sheets.push(sheetInfo);
            });

            return result;
        } catch (error) {
            throw new Error(`Excel processing failed: ${error.message}`);
        }
    }

    parseSkrubbholmenData(data, sheetName) {
        const parsedComponents = [];
        
        console.log(`Parsing ${data.length} rows from sheet ${sheetName}`);
        
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!row) continue;
            
            const keys = Object.keys(row);
            const values = Object.values(row);
            
            // Skip if row is empty or has less than 3 values
            if (values.length < 3 || !values[0] || !values[1] || !values[2]) continue;
            
            const col1 = String(values[0]).trim();
            const col2 = String(values[1]).trim();
            const col3 = String(values[2]).trim();
            const col4 = values[3] ? String(values[3]).trim() : '';
            const col5 = values[4] ? String(values[4]).trim() : '';
            
            // Check for Skrubbholmen pattern: Position | Sequence | Component | Description | Part
            // H01A, H01B, S04, etc.
            const positionPattern = /^[HS]\d{2}[AB]?$|^K\d{2}[AB]?$|^[A-Z]{1,3}\d+[A-Z]?$/;
            const sequencePattern = /^\d+$/;
            
            if (positionPattern.test(col1) && sequencePattern.test(col2) && col3.length > 0) {
                // This looks like a Skrubbholmen component row
                const component = {
                    position_reference: col1,
                    sequence_number: parseInt(col2),
                    component_type: col3,
                    description: col4,
                    part_number: col5,
                    raw_row: row,
                    row_index: i + 1,
                    sheet_name: sheetName,
                    specifications: this.extractSpecs(col4),
                    normalized_type: this.normalizeComponentType(col3)
                };
                
                parsedComponents.push(component);
                
                if (i < 5) { // Debug log first few components
                    console.log(`Found component: ${col1} | ${col2} | ${col3} | ${col4}`);
                }
            }
        }
        
        console.log(`Extracted ${parsedComponents.length} components from ${sheetName}`);
        return parsedComponents;
    }

    normalizeComponentType(rawType) {
        const type = rawType.toLowerCase();
        
        if (type.includes('ploganker') || type.includes('anker')) return 'anchor';
        if (type.includes('sjakkel')) return 'shackle';
        if (type.includes('kjetting')) return 'chain';
        if (type.includes('kause')) return 'thimble';
        if (type.includes('tau') || type.includes('trosse')) return 'rope';
        if (type.includes('master link') || type.includes('masterlink')) return 'master_link';
        if (type.includes('t-bolt') || type.includes('bolt')) return 't_bolt';
        if (type.includes('bøye')) return 'buoy';
        if (type.includes('wire')) return 'wire';
        
        return 'other';
    }

    extractSpecs(description) {
        if (!description) return {};
        
        const specs = {};
        
        // Weight patterns
        if (description.includes('1700')) specs.weight_kg = 1700;
        if (description.includes('90T')) specs.capacity_tons = 90;
        
        // Diameter patterns
        const diamMatch = description.match(/(\d+)\s*mm/i);
        if (diamMatch) specs.diameter_mm = parseInt(diamMatch[1]);
        
        // Length patterns  
        const lengthMatch = description.match(/(\d+\.?\d*)\s*m(?:eter)?/i);
        if (lengthMatch) specs.length_m = parseFloat(lengthMatch[1]);
        
        return specs;
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
            /position\s*(\d+[a-z]?)/gi,
            /[HS]\d{2}[AB]?/gi
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
                    summary.aiComponentsFound += aiData.component_groups?.reduce((sum, group) => sum + (group.components?.length || 0), 0) || 0;
                    summary.aiPositionsFound += aiData.component_groups?.length || 0;
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