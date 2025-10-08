const OpenAI = require('openai');
require('dotenv').config();
const logger = require('../utils/logger');

class GPTExcelEnhancer {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true
        });
        this.model = 'gpt-4o-mini';
    }

    async enhanceExcelData(fileData, positionMappings = []) {
        try {
            logger.info('Starting GPT Excel enhancement', {
                fileName: fileData.fileName,
                totalSheets: fileData.sheets?.length || 0,
                totalComponents: fileData.totalComponents || 0
            });

            const allComponentGroups = [];
            let totalTokensUsed = 0;
            let estimatedCost = 0;

            if (fileData.sheets && Array.isArray(fileData.sheets)) {
                for (const sheet of fileData.sheets) {
                    if (sheet.possibleComponents && sheet.possibleComponents.length > 0) {
                        logger.info(`Processing sheet: ${sheet.name} with ${sheet.possibleComponents.length} components`);
                        
                        const result = await this.processSheetWithGPT(sheet, fileData.fileName);
                        
                        allComponentGroups.push(...result.componentGroups);
                        totalTokensUsed += result.tokensUsed;
                        estimatedCost += result.cost;
                    }
                }
            }

            logger.info('GPT Excel enhancement completed', {
                totalPositions: allComponentGroups.length,
                totalComponents: allComponentGroups.reduce((sum, g) => sum + (g.components?.length || 0), 0),
                tokensUsed: totalTokensUsed,
                estimatedCost: `$${estimatedCost.toFixed(4)}`
            });

            return {
                success: true,
                data: {
                    document_info: {
                        filename: fileData.fileName,
                        type: 'excel',
                        sheets_processed: fileData.sheets?.length || 0,
                        processing_method: 'gpt-4o-mini'
                    },
                    component_groups: allComponentGroups,
                    metadata: {
                        tokens_used: totalTokensUsed,
                        estimated_cost: estimatedCost,
                        cost_per_component: allComponentGroups.length > 0 ? 
                            estimatedCost / allComponentGroups.reduce((sum, g) => sum + (g.components?.length || 0), 0) : 0
                    }
                }
            };

        } catch (error) {
            logger.error('GPT Excel enhancement failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    async processSheetWithGPT(sheet, fileName) {
        const componentStrings = sheet.possibleComponents;
        const batchSize = 500;
        const batches = this.createBatches(componentStrings, batchSize);
        
        let allComponentGroups = [];
        let totalTokens = 0;

        for (let i = 0; i < batches.length; i++) {
            logger.info(`Processing batch ${i + 1}/${batches.length} for sheet ${sheet.name}`);
            
            const result = await this.processBatchWithGPT(batches[i], sheet.name, fileName);
            allComponentGroups.push(...result.componentGroups);
            totalTokens += result.tokensUsed;
        }

        const inputCost = totalTokens * 0.150 / 1000000;
        const outputCost = totalTokens * 0.600 / 1000000;
        const totalCost = inputCost + outputCost;

        return {
            componentGroups: allComponentGroups,
            tokensUsed: totalTokens,
            cost: totalCost
        };
    }

    createBatches(components, batchSize) {
        const batches = [];
        for (let i = 0; i < components.length; i += batchSize) {
            batches.push(components.slice(i, i + batchSize));
        }
        return batches;
    }

    async processBatchWithGPT(componentStrings, sheetName, fileName) {
        const sampleComponents = componentStrings.slice(0, Math.min(10, componentStrings.length));
        
        const prompt = `You are analyzing Norwegian aquaculture component data extracted from an Excel file.

FILE: ${fileName}
SHEET: ${sheetName}
TOTAL COMPONENTS IN THIS BATCH: ${componentStrings.length}

SAMPLE COMPONENTS:
${sampleComponents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

YOUR TASK:
1. Analyze the data structure and identify the pattern
2. Group components by their position reference (H01A, H01B, K01, etc.)
3. For each component, extract:
   - Position reference (e.g., H01A, K01)
   - Sequence number
   - Component type (normalize Norwegian terms to English: ploganker=anchor, sjakkel=shackle, kjetting=chain, trosse=rope, etc.)
   - Description
   - Specifications (weight_kg, length_m, diameter_mm)
   - Part number
   - Manufacturer (if present)
   - Installation date (if present)

CRITICAL RULES:
- **SKIP ALL HEADER ROWS** - Lines like "Fortøyningsline type X.X", "Bunnfortøyning type X", or any row describing the line type itself are NOT components
- The FIRST actual component in a mooring line is typically the anchor (Ploganker/Anker), NOT the line type description
- Start sequence at 1 for the first ACTUAL component (after skipping headers)
- Each position should have multiple components in sequence
- Be systematic - extract ALL ${componentStrings.length} components
- Maintain sequence order within each position
- If uncertain about a value, set confidence < 0.8

Return ONLY valid JSON in this exact format:
{
  "component_groups": [
    {
      "document_reference": "H01A",
      "position_type": "mooring_line",
      "sheet_source": "${sheetName}",
      "components": [
        {
          "sequence": 1,
          "type": "anchor",
          "description": "Softanker 1700 kg",
          "quantity": 1,
          "specifications": {
            "weight_kg": 1700,
            "length_m": null,
            "diameter_mm": null
          },
          "part_number": "606616",
          "manufacturer": "AQS TOR",
          "installation_date": "01.08.2024",
          "confidence": 0.95
        }
      ]
    }
  ]
}`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at parsing Norwegian aquaculture component data. Extract ALL components systematically. Return only valid JSON without markdown formatting."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 4000,
                response_format: { type: "json_object" }
            });

            const tokensUsed = response.usage?.total_tokens || 0;
            const content = response.choices[0].message.content;
            
            const parsedData = JSON.parse(content);
            
            const componentGroups = parsedData.component_groups || [];
            
            logger.info(`Batch processed: ${componentGroups.length} position groups, ${tokensUsed} tokens used`);

            return {
                componentGroups: componentGroups,
                tokensUsed: tokensUsed
            };

        } catch (error) {
            logger.error('GPT batch processing failed', error);
            return {
                componentGroups: [],
                tokensUsed: 0
            };
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

module.exports = GPTExcelEnhancer;