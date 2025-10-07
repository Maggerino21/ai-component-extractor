const OpenAI = require('openai');
require('dotenv').config();
const logger = require('../utils/logger');

class ComprehensiveAIExtractor {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true
        });
        this.model = process.env.AI_MODEL || 'gpt-4o-mini';
    }

    async extractComponents(fileData, positionMappings = []) {
        try {
            logger.info('Starting comprehensive AI extraction', {
                fileType: fileData.type,
                fileName: fileData.fileName,
                mappingCount: positionMappings.length
            });

            let allExtractedData = {
                document_info: {
                    filename: fileData.fileName,
                    type: fileData.type,
                    processed_at: new Date().toISOString()
                },
                component_groups: []
            };

            // Process based on file type
            if (fileData.type === 'excel') {
                allExtractedData = await this.processExcelSystematically(fileData);
            } else if (fileData.type === 'pdf') {
                allExtractedData = await this.processPDFSystematically(fileData);
            }

            logger.info('Comprehensive AI extraction completed', {
                totalPositions: allExtractedData.component_groups?.length || 0,
                totalComponents: allExtractedData.component_groups?.reduce((sum, group) => sum + (group.components?.length || 0), 0) || 0
            });

            return {
                success: true,
                data: allExtractedData,
                rawData: fileData,
                usage: null
            };

        } catch (error) {
            logger.error('Comprehensive AI extraction failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    async processExcelSystematically(fileData) {
        const extractedData = {
            document_info: {
                filename: fileData.fileName,
                type: 'excel',
                sheets_processed: []
            },
            component_groups: []
        };

        // Process each sheet systematically
        if (fileData.sheets && Array.isArray(fileData.sheets)) {
            for (const sheet of fileData.sheets) {
                logger.info(`Processing sheet: ${sheet.name} with ${sheet.possibleComponents?.length || 0} components`);
                
                const sheetComponents = await this.processExcelSheet(sheet);
                extractedData.component_groups.push(...sheetComponents);
                
                extractedData.document_info.sheets_processed.push({
                    name: sheet.name,
                    components_found: sheetComponents.length,
                    total_rows: sheet.possibleComponents?.length || 0
                });
            }
        }

        // Also process any top-level components
        if (fileData.possibleComponents && Array.isArray(fileData.possibleComponents)) {
            const topLevelComponents = await this.processComponentList(fileData.possibleComponents, 'Main');
            extractedData.component_groups.push(...topLevelComponents);
        }

        return extractedData;
    }

    async processExcelSheet(sheet) {
        if (!sheet.possibleComponents || sheet.possibleComponents.length === 0) {
            return [];
        }

        logger.info(`Systematically processing ${sheet.possibleComponents.length} components from sheet ${sheet.name}`);
        
        // Group components by position (first part before |)
        const positionGroups = {};
        
        sheet.possibleComponents.forEach((component, index) => {
            try {
                // Extract position from component text
                // Expected format: "H01A | 1 | Component Type | Description"
                const parts = component.split('|').map(p => p.trim());
                
                if (parts.length >= 3) {
                    const position = parts[0]; // e.g., "H01A", "K01"
                    const sequence = parts[1]; // e.g., "1", "2", "3"
                    const componentType = parts[2]; // e.g., "Ploganker", "Sjakkel"
                    const description = parts[3] || ''; // e.g., "Softanker 1700 kg"
                    
                    if (!positionGroups[position]) {
                        positionGroups[position] = [];
                    }
                    
                    // Parse the component systematically
                    const parsedComponent = this.parseComponentSystematically(componentType, description, sequence);
                    positionGroups[position].push(parsedComponent);
                }
            } catch (error) {
                logger.error(`Error parsing component ${index}:`, error);
            }
        });

        // Convert position groups to component groups
        const componentGroups = [];
        
        Object.keys(positionGroups).forEach(position => {
            componentGroups.push({
                document_reference: position,
                position_type: this.classifyPositionType(position),
                components: positionGroups[position],
                total_components: positionGroups[position].length,
                sheet_source: sheet.name
            });
        });

        logger.info(`Extracted ${componentGroups.length} position groups from sheet ${sheet.name}`);
        
        return componentGroups;
    }

    parseComponentSystematically(componentType, description, sequence) {
        // Systematic parsing of component data
        const component = {
            sequence: parseInt(sequence) || 0,
            type: this.normalizeComponentType(componentType),
            description: description || componentType,
            quantity: 1, // Default quantity
            specifications: {},
            manufacturer: '',
            part_number: '',
            confidence: 0.95 // High confidence for systematic parsing
        };

        // Extract specifications from description
        if (description) {
            // Extract weight (kg)
            const weightMatch = description.match(/(\d+(?:\.\d+)?)\s*kg/i);
            if (weightMatch) {
                component.specifications.weight_kg = parseFloat(weightMatch[1]);
            }

            // Extract length (m, mm)
            const lengthMatch = description.match(/(\d+(?:\.\d+)?)\s*m(?:\s|$)/i);
            if (lengthMatch) {
                component.specifications.length_m = parseFloat(lengthMatch[1]);
            }

            // Extract diameter (mm)
            const diameterMatch = description.match(/(\d+(?:\.\d+)?)\s*mm/i);
            if (diameterMatch) {
                component.specifications.diameter_mm = parseFloat(diameterMatch[1]);
            }

            // Extract part numbers (patterns like G1463, GAP-GBA, etc.)
            const partNumberMatch = description.match(/([A-Z]+[-]?[A-Z0-9]+)(?:\s|$)/);
            if (partNumberMatch) {
                component.part_number = partNumberMatch[1];
            }
        }

        return component;
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
        // Classify position based on prefix
        if (position.startsWith('H')) return 'mooring_line';
        if (position.startsWith('K')) return 'connector_point';
        if (position.startsWith('A')) return 'anchor_point';
        if (position.startsWith('B')) return 'buoy';
        return 'unknown';
    }

    async processPDFSystematically(fileData) {
        // For PDF files, we still need AI to understand complex layouts
        // But we make multiple focused extraction passes
        
        const extractedData = {
            document_info: {
                filename: fileData.fileName,
                type: 'pdf',
                pages: fileData.pageCount || 0
            },
            component_groups: []
        };

        // Extract text content
        let textContent = '';
        if (fileData.text) {
            textContent = fileData.text;
        } else if (fileData.pages && Array.isArray(fileData.pages)) {
            textContent = fileData.pages.join('\n\n');
        }

        if (!textContent) {
            throw new Error('No text content found in PDF');
        }

        // Use AI for PDF processing with systematic prompts
        const componentGroups = await this.extractPDFComponentsWithAI(textContent);
        extractedData.component_groups = componentGroups;

        return extractedData;
    }

    async extractPDFComponentsWithAI(textContent) {
        const prompt = `
Analyze this Norwegian aquaculture mooring document and extract ALL components systematically.

Document content:
${textContent.substring(0, 8000)} // Limit for token usage

Instructions:
1. Find EVERY component table, list, or specification
2. Extract ALL positions/references (like "1a", "2b", "LANGSGÅENDE", "TVERSÅENDE", "KF-HO", etc.)
3. For each position, list ALL components with specifications
4. Include quantities, dimensions, part numbers, manufacturers
5. Don't skip anything - be comprehensive

Return JSON format:
{
  "component_groups": [
    {
      "document_reference": "position_code",
      "position_type": "mooring_line|anchor|buoy|frame",
      "components": [
        {
          "sequence": 1,
          "type": "anchor|rope|chain|shackle|connector",
          "description": "full description",
          "quantity": 1,
          "specifications": {
            "length_m": 10.5,
            "diameter_mm": 30,
            "weight_kg": 1700
          },
          "manufacturer": "company_name",
          "part_number": "part_code",
          "confidence": 0.9
        }
      ]
    }
  ]
}

Be systematic - extract EVERYTHING, not just samples.`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are a systematic data extraction specialist for Norwegian aquaculture documents. Extract ALL data comprehensively, never skip components."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 4000
            });

            const result = this.parseAIResponse(response.choices[0].message.content);
            return result.component_groups || [];

        } catch (error) {
            logger.error('PDF AI extraction failed', error);
            return [];
        }
    }

    parseAIResponse(responseText) {
        try {
            // Clean the response to extract JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            return JSON.parse(jsonMatch[0]);

        } catch (error) {
            logger.error('Failed to parse AI response', { error: error.message });
            throw new Error(`AI response parsing failed: ${error.message}`);
        }
    }

    async testConnection() {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [{ role: 'user', content: 'Test connection. Respond with "OK".' }],
                max_tokens: 10
            });

            return {
                success: true,
                model: this.model,
                response: response.choices[0].message.content
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = ComprehensiveAIExtractor;