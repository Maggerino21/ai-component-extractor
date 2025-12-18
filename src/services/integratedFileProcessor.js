const path = require('path');
const DatabaseService = require('./databaseService');
const CatalogAwareExtractor = require('./catalogAwareExtractor');
const logger = require('../utils/logger');

class IntegratedFileProcessor {
    constructor() {
        this.db = new DatabaseService();
        this.extractor = null;
        this.supportedFileTypes = ['.xlsx', '.xls'];
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return true;

        try {
            logger.info('🚀 Initializing integrated file processor');
            
            await this.db.connect();
            logger.info('✅ Database connected');

            const productCatalog = await this.db.getProductCatalog();
            logger.info(`✅ Loaded ${productCatalog.length} products from catalog`);

            this.extractor = new CatalogAwareExtractor(productCatalog);
            
            this.isInitialized = true;
            logger.info('✅ File processor initialized successfully');
            
            return true;
        } catch (error) {
            logger.error('❌ File processor initialization failed', error);
            throw error;
        }
    }

    async processFiles(filePaths, positionMappings = [], preferredSupplierId = null) {
        await this.initialize();

        if (preferredSupplierId) {
            const supplierCatalog = await this.db.getProductCatalog(preferredSupplierId);
            this.extractor.setProductCatalog(supplierCatalog);
            logger.info(`Set catalog to preferred supplier ID ${preferredSupplierId}: ${supplierCatalog.length} products`);
        }

        const results = [];
        
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            const fileName = path.basename(filePath);
            
            logger.info(`📄 Processing file ${i + 1}/${filePaths.length}: ${fileName}`);
            
            try {
                const result = await this.processFile(filePath, fileName, positionMappings);
                results.push(result);
            } catch (error) {
                logger.error(`❌ File processing failed for ${filePath}`, error);
                results.push({
                    fileName: fileName,
                    filePath: filePath,
                    success: false,
                    error: error.message,
                    fileType: path.extname(filePath).toLowerCase()
                });
            }
        }
        
        return results;
    }

    async processFile(filePath, fileName, positionMappings) {
        const fileType = path.extname(filePath).toLowerCase();
        
        if (!this.supportedFileTypes.includes(fileType)) {
            throw new Error(`Unsupported file type: ${fileType}`);
        }
        
        let extraction;
        
        if (['.xlsx', '.xls'].includes(fileType)) {
            logger.info(`📊 Using CATALOG-AWARE extractor for Excel`);
            extraction = await this.extractor.extractFromExcel(filePath, fileName, positionMappings);
        } else {
            throw new Error('PDF extraction not yet implemented');
        }
        
        return {
            fileName,
            filePath,
            fileType,
            success: extraction.success,
            data: {
                fileName: fileName,
                filePath: filePath,
                fileType: fileType
            },
            catalogExtraction: extraction,
            processedAt: new Date().toISOString()
        };
    }

    async getLocalities() {
        await this.initialize();
        return await this.db.getLocalities();
    }

    async getMooring(localityId) {
        await this.initialize();
        return await this.db.getMooring(localityId);
    }

    async getPositions(mooringId) {
        await this.initialize();
        return await this.db.getPositions(mooringId);
    }

    async getSuppliers() {
        await this.initialize();
        return await this.db.getSuppliers();
    }

    async getProductCatalog(supplierId = null) {
        await this.initialize();
        return await this.db.getProductCatalog(supplierId);
    }

    async insertComponents(componentsData) {
        await this.initialize();
        
        const results = [];
        
        for (const component of componentsData) {
            try {
                const componentId = await this.db.insertComponent(component);
                results.push({
                    success: true,
                    componentId: componentId,
                    positionId: component.positionId
                });
            } catch (error) {
                logger.error('Failed to insert component', error);
                results.push({
                    success: false,
                    error: error.message,
                    positionId: component.positionId
                });
            }
        }
        
        return results;
    }

    getProcessingSummary(results) {
        const summary = {
            totalFiles: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            totalPositions: 0,
            totalComponents: 0,
            catalogMatchedComponents: 0,
            highConfidenceMatches: 0,
            lowConfidenceMatches: 0,
            noMatches: 0,
            aiCallsMade: 0,
            errors: []
        };

        results.forEach(result => {
            if (result.success && result.catalogExtraction?.success) {
                const extractionData = result.catalogExtraction.data;
                
                if (extractionData.position_groups) {
                    summary.totalPositions += extractionData.position_groups.length;
                    
                    extractionData.position_groups.forEach(group => {
                        const components = group.components || [];
                        summary.totalComponents += components.length;
                        
                        components.forEach(comp => {
                            if (comp.matched_product_id) {
                                summary.catalogMatchedComponents++;
                                
                                if (comp.match_confidence >= 0.9) {
                                    summary.highConfidenceMatches++;
                                } else if (comp.match_confidence >= 0.6) {
                                    summary.lowConfidenceMatches++;
                                }
                            } else {
                                summary.noMatches++;
                            }
                        });
                    });
                }
                
                if (extractionData.document_info?.ai_calls_made) {
                    summary.aiCallsMade += extractionData.document_info.ai_calls_made;
                }
            } else if (!result.success) {
                summary.errors.push({
                    fileName: result.fileName,
                    error: result.error
                });
            }
        });

        const matchRate = summary.totalComponents > 0 
            ? ((summary.catalogMatchedComponents / summary.totalComponents) * 100).toFixed(1)
            : 0;
        
        summary.catalogMatchRate = `${matchRate}%`;

        const estimatedTokens = summary.aiCallsMade * 1500;
        summary.totalTokens = estimatedTokens;
        summary.estimatedCost = ((estimatedTokens * 0.150 / 1000000) + (estimatedTokens * 0.600 / 1000000)).toFixed(4);

        return summary;
    }

    validateFileSupport(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedFileTypes.includes(ext);
    }

    async disconnect() {
        if (this.db) {
            await this.db.disconnect();
        }
    }
}

module.exports = IntegratedFileProcessor;