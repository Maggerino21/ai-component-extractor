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

            // Sheets to skip - these are not used in the program
            const sheetsToSkip = [
                'not_flytekrage',
                'flytekrage',
                'bunnringsoppheng',
                'not',
                'ekstra'
            ];

            if (fileData.sheets && Array.isArray(fileData.sheets)) {
                for (const sheet of fileData.sheets) {
                    // Check if sheet should be skipped
                    const sheetNameLower = sheet.name.toLowerCase();
                    const shouldSkip = sheetsToSkip.some(skipName => sheetNameLower.includes(skipName));
                    
                    if (shouldSkip) {
                        logger.info(`Skipping sheet: ${sheet.name} (not used in program)`);
                        continue;
                    }

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
                estimatedCost: `${estimatedCost.toFixed(4)}`
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
        const batchSize = 500; // iNTERCHANGEABLE BASED ON USAGE PATTERNS AND TOKEN LIMITS!!!
        const batches = this.createBatches(componentStrings, batchSize);
        
        let allComponentGroups = [];
        let totalTokens = 0;

        for (let i = 0; i < batches.length; i++) {
            logger.info(`Processing batch ${i + 1}/${batches.length} for sheet ${sheet.name}`);
            
            // Minimal delay - we have 450k TPM limit now or something
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
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
        const sampleComponents = componentStrings.slice(0, Math.min(20, componentStrings.length));
        
        const prompt = `You are analyzing Norwegian aquaculture component data extracted from an Excel file.

FILE: ${fileName}
SHEET: ${sheetName}
TOTAL COMPONENTS IN THIS BATCH: ${componentStrings.length}

RAW SAMPLE DATA (pipe-separated fields - NOTE: Empty fields are omitted, so field positions vary!):
${sampleComponents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

CRITICAL UNDERSTANDING: Field positions are NOT consistent! Empty Excel cells are omitted from the pipe-separated data.

EXAMPLE:
Row with all fields: "H01A | 1 | Ploganker | Softanker 1700 kg | 606616 | AQS TOR | 12T | 20MIN"
Row with empty cells: "H01A | 2 | Sjakkel | Sjakkel 90T | GAP-GBA"

In the second row, "GAP-GBA" might LOOK like it's in the "part number" position, but it's actually a TRACKING number - the part number and manufacturer fields are just empty!

YOUR TASK: Use CONTENT ANALYSIS, not position analysis:

**IDENTIFYING FIELDS BY CONTENT:**

1. **Position Reference** - Always first field: H01A, H01B, K01, S04, etc.
2. **Sequence Number** - Always second field: 1, 2, 3, 4...
3. **Component Type** - Third field: Ploganker, Sjakkel, Kjetting, Tau, Kause, etc.
4. **Description** - Fourth field: Contains specs like "1700 kg", "90T", "64mm", "30mm"
5. **After description, analyze remaining fields by CONTENT:**

   **Part Number** (Art.nr) - Product catalog number:
   - Usually all numeric: "606616", "604758", "108192"
   - Sometimes alphanumeric but looks like product code: "605911-1"
   - NOT codes with hyphens like GAP-GBA

   **Manufacturer/Supplier** - Company names:
   - Contains company names: "AQS TOR", "Scale AQ", "Aqua Supporter", "Mørenot"
   - Usually 2+ words or capital letters
   - Appears ONLY on first component (sequence 1) of each position
   
   **Tracking Number** (Sporing) - Installation tracking codes:
   - Alphanumeric codes: "GAP-GBA", "G1463", "12T", "20MIN", "E11", "DIZ-DKV"
   - Often has hyphens: "GAP-GBA", "DIZ-DKV", "DAH-DBC"
   - Single letters + numbers: "E11", "E7", "G1463"
   - Time-like patterns: "12T", "20MIN"
   - Appears on EVERY component

**MANUFACTURER INHERITANCE RULE:**
The manufacturer appears ONLY on the first component (sequence 1) of each position. For ALL other components (seq 2, 3, 4...), you must INHERIT the manufacturer from sequence 1.

Example:
- H01A seq 1: "H01A | 1 | Ploganker | Softanker 1700 kg | 606616 | AQS TOR | 12T | 20MIN"
  Result: manufacturer="AQS TOR", tracking="12T"

- H01A seq 2: "H01A | 2 | Sjakkel | Sjakkel 90T | GAP-GBA"
  Result: manufacturer="AQS TOR" (INHERITED from seq 1), tracking="GAP-GBA"
  
- H01A seq 3: "H01A | 3 | Kjetting | Kjetting 30mm | G1463"
  Result: manufacturer="AQS TOR" (INHERITED from seq 1), tracking="G1463"

**HEADER DETECTION:**
Skip rows like:
- "H01A | 1 | Fortøyningsline type 1.2 ploganker" (no actual component details)
- "Bunnfortøyning type X"
These are line type descriptions, not actual components.

**OUTPUT FORMAT:**
For each component, extract:
{
  "sequence": <number>,
  "type": "<anchor|shackle|chain|rope|thimble|buoy|connector|swivel|masterlink|tbolt>",
  "description": "<full description>",
  "quantity": <number, default 1>,
  "specifications": {
    "weight_kg": <number or null>,
    "length_m": <number or null>,
    "diameter_mm": <number or null>,
    "capacity_t": <number or null>
  },
  "part_number": "<numeric catalog number or null>",
  "manufacturer": "<company name - from seq 1 OR inherited>",
  "tracking_number": "<alphanumeric tracking code>",
  "installation_date": "<date if present>",
  "confidence": <0.0-1.0>
}

Norwegian → English translations:
- Ploganker/Anker → anchor
- Sjakkel → shackle
- Kjetting → chain
- Tau/Trosse → rope
- Kause → thimble
- Bøye → buoy
- Koblingsskive → connector
- Master link → masterlink
- T-bolt/Forankringsbolt → tbolt

Return ONLY valid JSON in this exact format (replace ALL placeholder values with actual data from the components):
{
  "component_groups": [
    {
      "document_reference": "<actual position from data>",
      "position_type": "mooring_line",
      "sheet_source": "${sheetName}",
      "components": [
        {
          "sequence": <actual sequence number>,
          "type": "<actual component type>",
          "description": "<actual description from data>",
          "quantity": <actual quantity>,
          "specifications": {
            "weight_kg": <extract from actual description or null>,
            "length_m": <extract from actual description or null>,
            "diameter_mm": <extract from actual description or null>,
            "capacity_t": <extract from actual description or null>
          },
          "part_number": "<actual part number from data or null>",
          "manufacturer": "<actual manufacturer from data or inherited>",
          "tracking_number": "<actual tracking code from data>",
          "installation_date": "<actual date from data or null>",
          "confidence": <0.0-1.0 based on data quality>
        }
      ]
    }
  ]
}

CRITICAL: Extract ALL ${componentStrings.length} components from the batch. Do NOT use placeholder values. Analyze the actual data provided in the sample above.`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at parsing Norwegian aquaculture component data. CRITICAL: Field positions vary because empty Excel cells are omitted. You must identify fields by CONTENT PATTERNS, not positions. Manufacturer appears only on sequence 1 and must be inherited by all subsequent components in that position. Tracking numbers (like GAP-GBA, G1463, 12T) are alphanumeric codes that appear on every component - do NOT confuse them with part numbers. Use content analysis: numeric codes = part numbers, company names = manufacturer, alphanumeric codes with hyphens = tracking. Extract ALL components systematically. Return only valid JSON without markdown formatting."
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
            // Handle rate limit errors
            if (error.status === 429) {
                logger.warn('Rate limit hit - waiting 60 seconds before retry', {
                    error: error.message,
                    retryAfter: error.headers?.['retry-after']
                });
                
                // Wait 60 seconds then retry once
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                try {
                    const retryResponse = await this.client.chat.completions.create({
                        model: this.model,
                        messages: [
                            {
                                role: "system",
                                content: "You are an expert at parsing Norwegian aquaculture component data. CRITICAL: Field positions vary because empty Excel cells are omitted. You must identify fields by CONTENT PATTERNS, not positions. Manufacturer appears only on sequence 1 and must be inherited by all subsequent components in that position. Tracking numbers (like GAP-GBA, G1463, 12T) are alphanumeric codes that appear on every component - do NOT confuse them with part numbers. Use content analysis: numeric codes = part numbers, company names = manufacturer, alphanumeric codes with hyphens = tracking. Extract ALL components systematically. Return only valid JSON without markdown formatting."
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
                    
                    const tokensUsed = retryResponse.usage?.total_tokens || 0;
                    const content = retryResponse.choices[0].message.content;
                    const parsedData = JSON.parse(content);
                    const componentGroups = parsedData.component_groups || [];
                    
                    logger.info(`Batch processed after retry: ${componentGroups.length} position groups, ${tokensUsed} tokens used`);
                    
                    return {
                        componentGroups: componentGroups,
                        tokensUsed: tokensUsed
                    };
                } catch (retryError) {
                    logger.error('GPT batch processing failed after retry', retryError);
                    return {
                        componentGroups: [],
                        tokensUsed: 0
                    };
                }
            }
            
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