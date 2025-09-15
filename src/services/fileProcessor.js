const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');

class FileProcessor {
    constructor() {
        this.supportedFormats = ['.pdf', '.xlsx', '.xls'];
    }

    async processFiles(filePaths) {
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
                
                results.push({
                    fileName,
                    filePath,
                    fileType: fileExt,
                    success: true,
                    data: extractedData,
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
            const pdfData = await pdfParse(dataBuffer);
            
            const result = {
                type: 'pdf',
                pageCount: pdfData.numpages,
                text: pdfData.text,
                extractionMethod: 'text',
                isEmpty: !pdfData.text || pdfData.text.trim().length === 0
            };

            if (result.isEmpty) {
                console.log('No text found in PDF, attempting OCR...');
                result.text = await this.performOCR(dataBuffer);
                result.extractionMethod = 'ocr';
                result.isEmpty = !result.text || result.text.trim().length === 0;
            }

            result.keywords = this.extractKeywords(result.text);
            result.possibleComponents = this.findPossibleComponents(result.text);
            result.possibleMooringLines = this.findMooringLineReferences(result.text);

            return result;

        } catch (error) {
            throw new Error(`PDF processing failed: ${error.message}`);
        }
    }

    async processExcel(filePath) {
        try {
            const workbook = XLSX.readFile(filePath);
            const result = {
                type: 'excel',
                sheets: [],
                sheetNames: workbook.SheetNames,
                totalSheets: workbook.SheetNames.length
            };

            for (const sheetName of workbook.SheetNames) {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                const objectData = XLSX.utils.sheet_to_json(worksheet);

                const sheetData = {
                    name: sheetName,
                    rawData: jsonData,
                    objectData: objectData,
                    headers: jsonData[0] || [],
                    rowCount: jsonData.length,
                    columnCount: jsonData[0]?.length || 0,
                    possibleComponents: this.findComponentsInSheet(objectData),
                    possibleMooringLines: this.findMooringLinesInSheet(objectData)
                };

                result.sheets.push(sheetData);
            }

            return result;

        } catch (error) {
            throw new Error(`Excel processing failed: ${error.message}`);
        }
    }

    async performOCR(buffer) {
        try {
            const { data: { text } } = await Tesseract.recognize(buffer, 'eng+nor', {
                logger: m => console.log(m)
            });
            return text;
        } catch (error) {
            throw new Error(`OCR failed: ${error.message}`);
        }
    }

    extractKeywords(text) {
        const aquacultureKeywords = [
            'mooring', 'line', 'rope', 'chain', 'shackle', 'anchor', 'buoy',
            'facility', 'cage', 'net', 'component', 'installation', 'depth',
            'weight', 'length', 'manufacturer', 'tracking', 'scale aq', 'mørenot',
            'akva group', 'steinsvik', 'polarcirkel'
        ];

        const foundKeywords = [];
        const lowerText = text.toLowerCase();

        aquacultureKeywords.forEach(keyword => {
            if (lowerText.includes(keyword.toLowerCase())) {
                const matches = (lowerText.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
                foundKeywords.push({ keyword, count: matches });
            }
        });

        return foundKeywords.sort((a, b) => b.count - a.count);
    }

    findPossibleComponents(text) {
        const components = [];
        const lines = text.split('\n');

        const componentPatterns = [
            /(?:rope|chain|shackle|anchor|buoy)[\s\S]*?(?:length|weight|size|diameter)[\s\S]*?(?:\d+)/gi,
            /(?:scale\s*aq|mørenot|akva)[\s\S]*?(?:rope|chain|shackle)/gi,
            /(?:tracking|serial|id)[\s\S]*?(?:[a-z]\d+|\d+[a-z])/gi
        ];

        lines.forEach((line, index) => {
            componentPatterns.forEach(pattern => {
                const matches = line.match(pattern);
                if (matches) {
                    components.push({
                        line: index + 1,
                        text: line.trim(),
                        matches: matches
                    });
                }
            });
        });

        return components;
    }

    findMooringLineReferences(text) {
        const mooringLines = [];
        const lines = text.split('\n');

        const mooringPatterns = [
            /(?:line|mooring)[\s]*(?:[1-9]\d*[a-z]?|[a-z]\d+)/gi,
            /(?:position|location)[\s]*(?:[1-9]\d*[a-z]?|[a-z]\d+)/gi,
            /(?:[1-9]\d*[a-z]?|[a-z]\d+)[\s]*(?:line|mooring)/gi
        ];

        lines.forEach((line, index) => {
            mooringPatterns.forEach(pattern => {
                const matches = line.match(pattern);
                if (matches) {
                    mooringLines.push({
                        line: index + 1,
                        text: line.trim(),
                        references: matches
                    });
                }
            });
        });

        return mooringLines;
    }

    findComponentsInSheet(data) {
        const components = [];
        
        data.forEach((row, rowIndex) => {
            const rowText = Object.values(row).join(' ').toLowerCase();
            
            if (rowText.includes('rope') || rowText.includes('chain') || 
                rowText.includes('shackle') || rowText.includes('anchor')) {
                components.push({
                    row: rowIndex + 1,
                    data: row,
                    type: this.identifyComponentType(rowText)
                });
            }
        });

        return components;
    }

    findMooringLinesInSheet(data) {
        const mooringLines = [];
        
        data.forEach((row, rowIndex) => {
            const rowText = Object.values(row).join(' ').toLowerCase();
            
            if (rowText.includes('line') || rowText.includes('mooring')) {
                mooringLines.push({
                    row: rowIndex + 1,
                    data: row,
                    lineId: this.extractLineId(rowText)
                });
            }
        });

        return mooringLines;
    }

    identifyComponentType(text) {
        if (text.includes('rope')) return 'rope';
        if (text.includes('chain')) return 'chain';
        if (text.includes('shackle')) return 'shackle';
        if (text.includes('anchor')) return 'anchor';
        if (text.includes('buoy')) return 'buoy';
        return 'unknown';
    }

    extractLineId(text) {
        const patterns = [
            /line[\s]*([1-9]\d*[a-z]?)/i,
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
        return this.supportedFormats.includes(ext);
    }

    async testFileAccess(filePath) {
        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = FileProcessor;