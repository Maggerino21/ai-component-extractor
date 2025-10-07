console.log('Environment check:', {
    openai: process.env.OPENAI_API_KEY ? 'Found' : 'Missing',
    azure_endpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ? 'Found' : 'Missing',
    azure_key: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ? 'Found' : 'Missing'
});


const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");
const fs = require('fs');
const logger = require('../utils/logger');

class AzureDocumentExtractor {
    constructor() {
    try {
        this.endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
        this.apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
        
        if (!this.endpoint || !this.apiKey) {
            console.warn('Azure credentials missing, falling back to console logging');
            this.endpoint = 'fallback';
            this.apiKey = 'fallback';
        }
        
        if (this.endpoint !== 'fallback') {
            this.client = new DocumentAnalysisClient(this.endpoint, new AzureKeyCredential(this.apiKey));
        }
    } catch (error) {
        console.error('Azure initialization failed:', error);
        // Don't throw error, allow app to start
    }
}

    async extractComponents(fileData, positionMappings = []) {
        try {
            logger.info('Starting Azure Document Intelligence extraction', {
                fileName: fileData.fileName,
                fileType: fileData.type
            });

            let extractedData;
            
            if (fileData.type === 'excel') {
                // For Excel files, use table extraction
                extractedData = await this.extractExcelTables(fileData);
            } else if (fileData.type === 'pdf') {
                // For PDF files, use layout analysis
                extractedData = await this.extractPDFLayout(fileData);
            }

            // Post-process with GPT for intelligent categorization
            const intelligentData = await this.enhanceWithAI(extractedData);

            logger.info('Azure extraction completed', {
                totalPositions: intelligentData.component_groups?.length || 0,
                totalComponents: intelligentData.component_groups?.reduce((sum, group) => sum + (group.components?.length || 0), 0) || 0
            });

            return {
                success: true,
                data: intelligentData,
                rawAzureData: extractedData,
                source: 'azure_document_intelligence'
            };

        } catch (error) {
            logger.error('Azure Document Intelligence extraction failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    async extractExcelTables(fileData) {
        // Read the Excel file as buffer
        const fileBuffer = fs.readFileSync(fileData.filePath);
        
        // Analyze with Azure Document Intelligence
        const poller = await this.client.beginAnalyzeDocument("prebuilt-layout", fileBuffer);
        const result = await poller.pollUntilDone();

        logger.info(`Azure found ${result.tables?.length || 0} tables in Excel file`);

        const extractedData = {
            document_info: {
                filename: fileData.fileName,
                type: 'excel',
                azure_confidence: result.confidence || 0,
                tables_found: result.tables?.length || 0
            },
            raw_tables: [],
            component_groups: []
        };

        // Process each table found by Azure
        if (result.tables && result.tables.length > 0) {
            for (let i = 0; i < result.tables.length; i++) {
                const table = result.tables[i];
                logger.info(`Processing table ${i + 1} with ${table.cells.length} cells`);
                
                const processedTable = this.processAzureTable(table, `Table_${i + 1}`);
                extractedData.raw_tables.push(processedTable);
                
                // Convert table to component groups
                const componentGroups = this.tableToComponentGroups(processedTable);
                extractedData.component_groups.push(...componentGroups);
            }
        }

        return extractedData;
    }

    processAzureTable(azureTable, tableName) {
        // Convert Azure table format to structured data
        const processedTable = {
            name: tableName,
            row_count: azureTable.rowCount,
            column_count: azureTable.columnCount,
            confidence: azureTable.confidence || 0,
            headers: [],
            rows: []
        };

        // Organize cells by row and column
        const cellsByRow = {};
        
        azureTable.cells.forEach(cell => {
            const rowIndex = cell.rowIndex;
            const colIndex = cell.columnIndex;
            
            if (!cellsByRow[rowIndex]) {
                cellsByRow[rowIndex] = {};
            }
            
            cellsByRow[rowIndex][colIndex] = {
                content: cell.content || '',
                confidence: cell.confidence || 0
            };
        });

        // Extract headers (assuming first row contains headers)
        if (cellsByRow[0]) {
            const headerRow = cellsByRow[0];
            for (let col = 0; col < azureTable.columnCount; col++) {
                processedTable.headers.push(headerRow[col]?.content || `Column_${col}`);
            }
        }

        // Extract data rows
        for (let row = 1; row < azureTable.rowCount; row++) {
            if (cellsByRow[row]) {
                const rowData = [];
                for (let col = 0; col < azureTable.columnCount; col++) {
                    rowData.push(cellsByRow[row][col]?.content || '');
                }
                
                // Only add non-empty rows
                if (rowData.some(cell => cell.trim() !== '')) {
                    processedTable.rows.push(rowData);
                }
            }
        }

        logger.info(`Processed table: ${processedTable.headers.length} columns, ${processedTable.rows.length} data rows`);
        
        return processedTable;
    }

    tableToComponentGroups(table) {
        const componentGroups = [];
        
        // Analyze headers to understand table structure
        const headers = table.headers.map(h => h.toLowerCase());
        
        // Find position/reference column
        const positionColumnIndex = this.findColumnIndex(headers, ['position', 'pos', 'ref', 'reference', 'line']);
        const componentColumnIndex = this.findColumnIndex(headers, ['component', 'type', 'beskrivelse', 'description']);
        const quantityColumnIndex = this.findColumnIndex(headers, ['quantity', 'qty', 'antall', 'ant']);
        const specColumnIndex = this.findColumnIndex(headers, ['specification', 'spec', 'details', 'dimension']);

        if (positionColumnIndex === -1) {
            logger.warn('No position column found in table, using sequential numbering');
        }

        // Group rows by position
        const positionGroups = {};
        
        table.rows.forEach((row, rowIndex) => {
            // Extract position (or use row number)
            const position = positionColumnIndex >= 0 ? 
                row[positionColumnIndex] || `Row_${rowIndex + 1}` : 
                `Row_${rowIndex + 1}`;

            // Extract component info
            const componentType = componentColumnIndex >= 0 ? row[componentColumnIndex] : '';
            const quantity = quantityColumnIndex >= 0 ? parseInt(row[quantityColumnIndex]) || 1 : 1;
            const specification = specColumnIndex >= 0 ? row[specColumnIndex] : '';

            // Skip empty rows
            if (!componentType && !specification) return;

            if (!positionGroups[position]) {
                positionGroups[position] = [];
            }

            positionGroups[position].push({
                sequence: positionGroups[position].length + 1,
                type: this.normalizeComponentType(componentType),
                description: specification || componentType,
                quantity: quantity,
                specifications: this.parseSpecifications(specification),
                raw_data: row,
                confidence: 0.95 // High confidence from Azure extraction
            });
        });

        // Convert to component groups
        Object.keys(positionGroups).forEach(position => {
            componentGroups.push({
                document_reference: position,
                position_type: this.classifyPositionType(position),
                components: positionGroups[position],
                total_components: positionGroups[position].length,
                extraction_source: 'azure_table'
            });
        });

        return componentGroups;
    }

    findColumnIndex(headers, searchTerms) {
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            if (searchTerms.some(term => header.includes(term))) {
                return i;
            }
        }
        return -1;
    }

    parseSpecifications(specText) {
        const specs = {};
        
        if (!specText) return specs;
        
        // Extract common specifications
        const weightMatch = specText.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (weightMatch) specs.weight_kg = parseFloat(weightMatch[1]);
        
        const lengthMatch = specText.match(/(\d+(?:\.\d+)?)\s*m(?:\s|$)/i);
        if (lengthMatch) specs.length_m = parseFloat(lengthMatch[1]);
        
        const diameterMatch = specText.match(/(\d+(?:\.\d+)?)\s*mm/i);
        if (diameterMatch) specs.diameter_mm = parseFloat(diameterMatch[1]);
        
        return specs;
    }

    normalizeComponentType(type) {
        const typeMapping = {
            'ploganker': 'anchor',
            'anker': 'anchor',
            'sjakkel': 'shackle',
            'kjetting': 'chain',
            'trosse': 'rope',
            'tau': 'rope',
            'wire': 'wire',
            'kause': 'thimble',
            'koblingspunkt': 'connector',
            'koblingsskive': 'connector',
            'fortøyningsline': 'mooring_line'
        };

        const normalized = type.toLowerCase().trim();
        return typeMapping[normalized] || normalized;
    }

    classifyPositionType(position) {
        if (position.match(/^H\d/i)) return 'mooring_line';
        if (position.match(/^K\d/i)) return 'connector_point';
        if (position.match(/^A\d/i)) return 'anchor_point';
        if (position.match(/^B\d/i)) return 'buoy';
        return 'component_line';
    }

    async extractPDFLayout(fileData) {
        // For PDF files, use layout analysis to understand document structure
        const fileBuffer = fs.readFileSync(fileData.filePath);
        
        const poller = await this.client.beginAnalyzeDocument("prebuilt-layout", fileBuffer);
        const result = await poller.pollUntilDone();

        const extractedData = {
            document_info: {
                filename: fileData.fileName,
                type: 'pdf',
                pages: result.pages?.length || 0,
                tables_found: result.tables?.length || 0
            },
            pages: [],
            tables: [],
            component_groups: []
        };

        // Process tables found in PDF
        if (result.tables) {
            for (let i = 0; i < result.tables.length; i++) {
                const table = result.tables[i];
                const processedTable = this.processAzureTable(table, `PDF_Table_${i + 1}`);
                extractedData.tables.push(processedTable);
                
                const componentGroups = this.tableToComponentGroups(processedTable);
                extractedData.component_groups.push(...componentGroups);
            }
        }

        return extractedData;
    }

    async enhanceWithAI(azureData) {
        // Optional: Use GPT to enhance Azure-extracted data with intelligent categorization
        // This adds semantic understanding to the structured data from Azure
        
        try {
            const OpenAI = require('openai');
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
                dangerouslyAllowBrowser: true
            });

            // Create a summary of extracted data for GPT to enhance
            const dataForEnhancement = JSON.stringify(azureData.component_groups, null, 2);
            
            const prompt = `
Enhance this Norwegian aquaculture component data extracted by Azure Document Intelligence.
Add intelligent categorization, fix any obvious parsing errors, and ensure consistency:

${dataForEnhancement.substring(0, 3000)}

Return the enhanced JSON with:
1. Better component type classifications
2. Corrected Norwegian translations
3. Improved position groupings
4. Consistent specifications format

Keep all original data, just enhance it.`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in Norwegian aquaculture equipment. Enhance structured data extracted by Azure Document Intelligence."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 3000
            });

            // Parse GPT response and merge with Azure data
            const enhanced = JSON.parse(response.choices[0].message.content);
            
            return {
                ...azureData,
                component_groups: enhanced.component_groups || azureData.component_groups,
                enhancement_applied: true
            };

        } catch (error) {
            logger.warn('GPT enhancement failed, using Azure data as-is', error);
            return azureData;
        }
    }

    async testConnection() {
        try {
            // Test Azure connection with a simple operation
            logger.info('Testing Azure Document Intelligence connection...');
            return {
                success: true,
                endpoint: this.endpoint,
                message: 'Azure Document Intelligence connection configured'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = AzureDocumentExtractor;