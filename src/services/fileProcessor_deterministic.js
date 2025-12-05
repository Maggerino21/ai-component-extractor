const fs = require('fs');
const path = require('path');
const HybridExtractor = require('./DeterministicExtractor');
const logger = require('../utils/logger');

class FileProcessor {
    constructor() {
        this.hybridExtractor = new HybridExtractor();
        this.supportedFileTypes = ['.pdf', '.xlsx', '.xls'];
    }

    async processFiles(filePaths, positionMappings = []) {
        const results = [];
        
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            const fileName = path.basename(filePath);
            
            logger.info(`Processing file ${i + 1}/${filePaths.length}: ${fileName}`);
            
            try {
                const result = await this.processFile(filePath, positionMappings);
                results.push(result);
            } catch (error) {
                logger.error(`File processing failed for ${filePath}`, error);
                results.push({
                    fileName: fileName,
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
        
        let extraction;
        
        if (['.xlsx', '.xls'].includes(fileType)) {
            logger.info(`🚀 Using HYBRID extractor for Excel (deterministic + tiny AI)`);
            extraction = await this.hybridExtractor.extractFromExcel(filePath, fileName);
        } else if (fileType === '.pdf') {
            logger.info(`📄 PDF support not yet implemented`);
            throw new Error('PDF extraction not yet implemented');
        }
        
        return {
            fileName,
            filePath,
            fileType,
            success: true,
            data: {
                fileName: fileName,
                filePath: filePath,
                fileType: fileType
            },
            aiExtraction: extraction,
            processedAt: new Date().toISOString()
        };
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
            aiCallsMade: 0,
            errors: []
        };

        results.forEach(result => {
            if (result.success && result.aiExtraction && result.aiExtraction.success) {
                const extractionData = result.aiExtraction.data;
                
                if (extractionData.position_groups) {
                    summary.aiPositionsFound += extractionData.position_groups.length;
                    extractionData.position_groups.forEach(group => {
                        summary.aiComponentsFound += group.komponenter?.length || 0;
                    });
                }
                
                if (extractionData.document_info && extractionData.document_info.ai_calls_made) {
                    summary.aiCallsMade += extractionData.document_info.ai_calls_made;
                }
            } else if (!result.success) {
                summary.errors.push({
                    fileName: result.fileName,
                    error: result.error
                });
            }
        });

        const estimatedTokens = summary.aiCallsMade * 30;
        summary.totalTokens = estimatedTokens;
        summary.totalCost = (estimatedTokens * 0.150 / 1000000) + (estimatedTokens * 0.600 / 1000000);

        return summary;
    }

    validateFileSupport(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedFileTypes.includes(ext);
    }
}

module.exports = FileProcessor;