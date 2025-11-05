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
        const batchSize = 300; // Can be larger now with Tier 2
        const batches = this.createBatches(componentStrings, batchSize);
        
        let allComponentGroups = [];
        let totalTokens = 0;

        for (let i = 0; i < batches.length; i++) {
            logger.info(`Processing batch ${i + 1}/${batches.length} for sheet ${sheet.name}`);
            
            // Small delay to be safe (optional - can remove if you want max speed)
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds instead of 10
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

RAW SAMPLE DATA (pipe-separated fields):
${sampleComponents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

STEP 1: COLUMN STRUCTURE ANALYSIS
Look at the sample data above. Each row has fields separated by " | ". 
Count the fields and identify what each position contains by looking at ALL samples.

Based on a typical pattern like:
"H01A | 1 | Ploganker | Softanker 1700 kg | | 606616 | AQS TOR | 12T | 20MIN"

Map out: Field 0 = ?, Field 1 = ?, Field 2 = ?, etc.

Common patterns:
- Position reference (H01A, K01) usually in field 0
- Sequence number (1, 2, 3) usually in field 1  
- Component type (Ploganker, Sjakkel) usually in field 2
- Description with specs usually in field 3
- Empty field or additional info in field 4
- Part number (numeric like 606616 or alphanumeric like GAP-GBA) in field 5 or 6
- Manufacturer name (AQS TOR, Scale AQ) appears in one field
- Tracking codes (GAP-GBA, G1463, 12T) appear in another field

CRITICAL OBSERVATION: In aquaculture Excel sheets, manufacturer appears ONLY on the FIRST component of each position (the anchor/ploganker), then the field is EMPTY for all other components. You must remember the manufacturer from sequence 1 and apply it to ALL subsequent components in that same position.

YOUR TASK - Extract components with this logic:

1. **Skip headers** - Lines like "Fortøyningsline type X.X" are structural descriptions, not components
2. **Track manufacturer per position** - When you see a manufacturer on sequence 1, remember it for the entire position
3. **Extract all components** systematically with proper field mapping

For each component, return:
{
  "sequence": <number>,
  "type": "<anchor|shackle|chain|rope|thimble|buoy|connector|swivel|masterlink>",
  "description": "<full description text>",
  "quantity": <number, default 1>,
  "specifications": {
    "weight_kg": <number or null>,
    "length_m": <number or null>,
    "diameter_mm": <number or null>,
    "capacity_t": <number or null>
  },
  "part_number": "<extract from the field that contains product/article numbers>",
  "manufacturer": "<company name - INHERIT from sequence 1 if not present>",
  "tracking_number": "<sporing/tracking code - can be alphanumeric like GAP-GBA, G1463, 12T>",
  "installation_date": "<date if present>",
  "confidence": <0.0-1.0>
}

CRITICAL FIELD IDENTIFICATION RULES:
- Part numbers: Usually numeric (606616) or short alphanumeric codes in earlier fields
- Manufacturer: Company names like "AQS TOR", "Scale AQ" - appears ONLY on first component
- Tracking numbers: Alphanumeric codes (GAP-GBA, G1463, 12T, 20MIN) - appear on EVERY component
- If a field on sequence 1 has a company name, that's the manufacturer for the WHOLE position
- If a field is empty on sequences 2+, but had a value on sequence 1, that's the manufacturer field
- Tracking codes appear consistently across all sequences in the same field position

Example logic:
- H01A seq 1: Field 6="AQS TOR", Field 7="12T" → manufacturer="AQS TOR", tracking="12T"
- H01A seq 2: Field 6="", Field 7="GAP-GBA" → manufacturer="AQS TOR" (inherited!), tracking="GAP-GBA"
- H01A seq 3: Field 6="", Field 7="G1463" → manufacturer="AQS TOR" (inherited!), tracking="G1463"

Return ONLY valid JSON in this format:
STEP 2: DETECT HEADERS VS COMPONENTS
Headers are structural descriptions, NOT actual components. Skip them!
Common header patterns:
- "Fortøyningsline type X" = HEADER (describes the line type)
- "Bunnfortøyning type X" = HEADER
- Rows with ONLY position + text but no sequence number = HEADER
- First row with same position but missing component details = HEADER

Real components have:
- Position reference + Sequence number + Component type + Description/specs
- Example: "H01A | 1 | Ploganker | Softanker 1700 kg | 606616"

STEP 3: EXTRACT COMPONENTS
For each valid component (NOT headers), extract:
- Position reference (e.g., H01A, K01)
- Sequence number (1, 2, 3...)
- Component type (normalize Norwegian → English: ploganker=anchor, sjakkel=shackle, kjetting=chain, trosse/tau=rope, kause=thimble, bøye=buoy)
- Description (full text with specs)
- Specifications object:
  - weight_kg: Extract from patterns like "1700 kg", "1700kg", "1.7T", "1700 kilo"
  - length_m: Extract from patterns like "27.5m", "27,5 m", "27.5 meter"
  - diameter_mm: Extract from patterns like "64mm", "64 mm", "ø64", "Ø 64mm"
  - capacity_t: Extract from patterns like "90T", "90 tonn", "90t"
- Part number (Art.nr/Varenr - can be numeric or alphanumeric: 606616, GAP-GBA, G1463, AQS-123)
- Manufacturer (Leverandør/Produsent - company name like "AQS TOR", "Scale AQ")
- Tracking number (Sporing - **ALPHANUMERIC codes like "GAP-GBA", "12T", "20MIN", "G1463" - these are tracing/tracking codes, NOT part numbers**)
- Installation date (if present)

IMPORTANT: Tracking numbers (Sporing) are often alphanumeric codes that can include:
- Letters + hyphens: "GAP-GBA", "GEJ-14698"
- Numbers + letters: "12T", "20MIN"
- Mixed formats: "G1463", "D31"
These are valid tracking numbers even if they contain letters!

CRITICAL RULES:
- **ANALYZE COLUMN POSITIONS FIRST** - Understand which | separated field contains what data
- **MANUFACTURER INHERITANCE** - The manufacturer appears ONLY on the first component (anchor), then ALL other components in that position inherit it!
  - If column 7 has "AQS TOR" on sequence 1, apply "AQS TOR" to ALL components in that position
  - Only override if a different manufacturer is explicitly stated on a later component (rare!)
- **DISTINGUISH part_number from tracking_number** - They are different fields!
  - Part number (Art.nr) = Product identifier from manufacturer (column 6)
  - Tracking/Sporing = Installation tracking reference (column 8) - **ALPHANUMERIC - can have letters, numbers, hyphens**
- **TRACKING NUMBERS CAN BE ALPHANUMERIC** - "GAP-GBA", "GEJ-14698", "G1463", "12T", "20MIN" are ALL valid tracking numbers
- **DON'T CONFUSE tracking with manufacturer** - "GAP-GBA" is tracking (column 8), not manufacturer (column 7)
- **SKIP ALL HEADERS** - Lines like "Fortøyningsline type X.X" are NOT components
- **DETECT HEADERS INTELLIGENTLY** - Headers usually lack sequence numbers or detailed specs
- Start sequence at 1 for the first ACTUAL component (after skipping headers)
- Each position should have multiple components in sequence
- Be systematic - extract ALL ${componentStrings.length} components
- Maintain sequence order within each position
- Set confidence based on data completeness:
  - 0.95+ if all fields present and clear
  - 0.85-0.94 if some fields missing but core data clear (including inherited manufacturer)
  - 0.70-0.84 if uncertain about interpretation
  - < 0.70 if very ambiguous

EXAMPLES OF WHAT TO SKIP (HEADERS):
- "H01A | 1 | Fortøyningsline type 1.2 ploganker | | 01.08.2024" ❌ SKIP - This is a line type header with date
- "Bunnfortøyning type 3" ❌ SKIP - Line category description

EXAMPLES OF WHAT TO EXTRACT (COMPONENTS) - **WITH MANUFACTURER INHERITANCE**:
- "H01A | 1 | Ploganker | Softanker 1700 kg | | 606616 | AQS TOR | 12T | 20MIN" ✅ EXTRACT
  - Position: H01A, Sequence: 1, Type: anchor, Description: "Softanker 1700 kg"
  - Part number: 606616, Manufacturer: "AQS TOR", Tracking: "12T"
  - Specs: weight_kg=1700
  - **NOTE: This is sequence 1, so "AQS TOR" will be inherited by all subsequent components in H01A**

- "H01A | 2 | Sjakkel | Sjakkel 90T | | GAP-GBA | | |" ✅ EXTRACT
  - Position: H01A, Sequence: 2, Type: shackle, Description: "Sjakkel 90T"
  - Part number: "GAP-GBA" is actually tracking! (column 8 position)
  - Manufacturer: **"AQS TOR" (inherited from sequence 1)**
  - Tracking: "GAP-GBA" (alphanumeric tracking number!)
  - Specs: capacity_t=90

- "H01A | 3 | Kjetting | Kjetting stolpeløs 30mm - 27,5m | | G1463 | | |" ✅ EXTRACT
  - Position: H01A, Sequence: 3, Type: chain, Description: "Kjetting stolpeløs 30mm - 27,5m"
  - Manufacturer: **"AQS TOR" (inherited from sequence 1)**
  - Tracking: "G1463" (alphanumeric tracking!)
  - Specs: diameter_mm=30, length_m=27.5

**KEY POINT:** Components 2, 3, 4, 5... in position H01A ALL get manufacturer="AQS TOR" even though column 7 is empty for them!

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
            "diameter_mm": null,
            "capacity_t": null
          },
          "part_number": "606616",
          "manufacturer": "AQS TOR",
          "tracking_number": "12T",
          "installation_date": "01.08.2024",
          "confidence": 0.95
        },
        {
          "sequence": 2,
          "type": "shackle",
          "description": "Sjakkel 90T",
          "quantity": 1,
          "specifications": {
            "weight_kg": null,
            "length_m": null,
            "diameter_mm": null,
            "capacity_t": 90
          },
          "part_number": null,
          "manufacturer": "AQS TOR",
          "tracking_number": "GAP-GBA",
          "installation_date": null,
          "confidence": 0.90
        }
      ]
    }
  ]
}

REMEMBER: 
- **Manufacturer inheritance:** Manufacturer from sequence 1 applies to ALL components in that position
- **Tracking on every component:** Each component has its own tracking code (GAP-GBA, G1463, 12T, 20MIN, etc.)
- **Alphanumeric tracking codes are normal:** GAP-GBA, GEJ-14698, G1463, 12T, 20MIN are all valid tracking numbers
- If manufacturer field is empty on sequence 2+, copy manufacturer from sequence 1
- Manufacturer = company name (AQS TOR, Scale AQ, Mørenot)
- Tracking = alphanumeric code for individual component tracing
- Extract ALL ${componentStrings.length} components systematically
- Skip only actual headers like "Fortøyningsline type X.X"`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert at parsing Norwegian aquaculture component data. You understand that manufacturer appears only on the first component of each position and must be inherited by all subsequent components in that position. Tracking numbers are alphanumeric codes that appear on every component. Extract ALL components systematically. Return only valid JSON without markdown formatting."
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
                                content: "You are an expert at parsing Norwegian aquaculture component data. You understand that manufacturer appears only on the first component of each position and must be inherited by all subsequent components in that position. Tracking numbers are alphanumeric codes that appear on every component. Extract ALL components systematically. Return only valid JSON without markdown formatting."
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