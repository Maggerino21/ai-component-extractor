const OpenAI = require('openai');
require('dotenv').config();
const logger = require('../utils/logger');

class AIExtractor {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true // Required for Electron
        });
        this.model = process.env.AI_MODEL || 'gpt-4o-mini';
    }

    async extractComponents(fileData, positionMappings = []) {
        try {
            const extractionPrompt = this.buildExtractionPrompt(fileData, positionMappings);
            
            logger.info('Starting AI extraction', {
                fileType: fileData.type,
                fileName: fileData.fileName,
                mappingCount: positionMappings.length
            });

            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: "system",
                        content: this.getSystemPrompt()
                    },
                    {
                        role: "user", 
                        content: extractionPrompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 4000
            });

            const extractedData = this.parseAIResponse(response.choices[0].message.content);
            
            logger.info('AI extraction completed', {
                componentsFound: extractedData.component_groups?.length || 0,
                totalComponents: extractedData.component_groups?.reduce((sum, group) => sum + group.components.length, 0) || 0
            });

            return {
                success: true,
                data: extractedData,
                rawResponse: response.choices[0].message.content,
                usage: response.usage
            };

        } catch (error) {
            logger.error('AI extraction failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    getSystemPrompt() {
        return `You are an expert in extracting Norwegian aquaculture mooring system data from technical documents.

Your task is to analyze technical documents and extract structured mooring component information.

Key Norwegian/Technical Terms to Recognize:
- "Bunnfortøyning" = Bottom mooring/anchoring
- "Line" followed by numbers/letters (e.g. "1a", "2b", "11c") = Mooring line references  
- "Anker" = Anchor
- "Sjakkel" = Shackle  
- "Ankerkjetting" = Anchor chain
- "Trosse" = Rope/line
- "kause" = Thimble/eye splice
- "Bøye" = Buoy
- "spleis" = Splice
- "PANTHER TRÅLKULE" = Trawl float/buoy

Expected JSON Output Structure:
{
  "document_info": {
    "supplier": "detected supplier name",
    "document_id": "document number/reference", 
    "date": "date if found",
    "facility_reference": "facility name from document"
  },
  "component_groups": [
    {
      "document_reference": "EXACT reference as written (e.g. '1a', '2b', '11c', 'Line 4')",
      "reference_type": "line/position/group identifier type",
      "description": "any descriptive text about this position/line",
      "components": [
        {
          "sequence": "number (order in document)",
          "type": "component type (anchor, chain, rope, shackle, buoy, etc.)",
          "description": "full original description",
          "quantity": "number",
          "specifications": {
            "length_m": "number or null",
            "diameter_mm": "number or null", 
            "weight_kg": "number or null",
            "breaking_strength_kg": "number or null",
            "material": "string or null"
          },
          "manufacturer": "extracted manufacturer name",
          "part_number": "part/model number",
          "notes": "any additional details",
          "confidence": "extraction confidence 0.0-1.0"
        }
      ]
    }
  ]
}

CRITICAL REQUIREMENTS:
1. Extract EVERY component found, even if uncertain
2. Preserve document references EXACTLY as written  
3. Group components by their document position/line reference
4. Don't try to convert references to internal numbers
5. Extract all technical specifications found
6. Identify component types using standard terms: anchor, chain, rope, shackle, buoy, thimble, splice, connector, clamp, swivel

Return only valid JSON.`;
    }

    buildExtractionPrompt(fileData, positionMappings) {
        let prompt = `Extract aquaculture mooring components from this document:

FILE: ${fileData.fileName}
TYPE: ${fileData.type}

`;

        if (positionMappings.length > 0) {
            prompt += `POSITION MAPPINGS REFERENCE:
${positionMappings.map(m => `- Document ref "${m.documentReference}" → Internal position ${m.internalPosition}`).join('\n')}

`;
        }

        if (fileData.type === 'pdf') {
            prompt += `DOCUMENT TEXT:
${fileData.text}

KEYWORDS FOUND: ${fileData.keywords?.map(k => k.keyword).join(', ') || 'None'}

`;
        }

        if (fileData.type === 'excel' && fileData.sheets) {
            prompt += `EXCEL SHEETS:
`;
            fileData.sheets.forEach(sheet => {
                prompt += `
Sheet: ${sheet.name} (${sheet.rowCount} rows, ${sheet.columnCount} columns)
Headers: ${sheet.headers?.join(', ') || 'No headers detected'}

Sample Data (first 5 rows):
${JSON.stringify(sheet.objectData?.slice(0, 5), null, 2)}
`;
            });
        }

        prompt += `
Focus on extracting:
1. All component tables with position/quantity/description columns
2. Line group references (e.g. "1a", "2b", "11c")
3. Component specifications and part numbers
4. Length details for ropes/chains
5. Facility and supplier information from header

Pay special attention to Norwegian terminology and document format.
Return structured JSON only.`;

        return prompt;
    }

    parseAIResponse(responseText) {
        try {
            // Clean the response to extract JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            const extractedData = JSON.parse(jsonMatch[0]);
            
            // Validate structure
            if (!extractedData.component_groups || !Array.isArray(extractedData.component_groups)) {
                throw new Error('Invalid response structure: missing component_groups array');
            }

            return this.validateAndCleanData(extractedData);

        } catch (error) {
            logger.error('Failed to parse AI response', { error: error.message, responseText });
            throw new Error(`AI response parsing failed: ${error.message}`);
        }
    }

    validateAndCleanData(data) {
        const cleaned = {
            document_info: data.document_info || {},
            component_groups: []
        };

        // Validate and clean each component group
        data.component_groups.forEach(group => {
            const cleanedGroup = {
                document_reference: group.document_reference || 'unknown',
                reference_type: group.reference_type || 'unknown',
                description: group.description || '',
                components: []
            };

            if (group.components && Array.isArray(group.components)) {
                group.components.forEach(component => {
                    const cleanedComponent = {
                        sequence: this.parseNumber(component.sequence) || 1,
                        type: this.standardizeComponentType(component.type),
                        description: component.description || '',
                        quantity: this.parseNumber(component.quantity) || 1,
                        specifications: {
                            length_m: this.parseNumber(component.specifications?.length_m),
                            diameter_mm: this.parseNumber(component.specifications?.diameter_mm),
                            weight_kg: this.parseNumber(component.specifications?.weight_kg),
                            breaking_strength_kg: this.parseNumber(component.specifications?.breaking_strength_kg),
                            material: component.specifications?.material
                        },
                        manufacturer: component.manufacturer || null,
                        part_number: component.part_number || null,
                        notes: component.notes || null,
                        confidence: Math.min(Math.max(this.parseNumber(component.confidence) || 0.7, 0), 1)
                    };

                    cleanedGroup.components.push(cleanedComponent);
                });
            }

            cleaned.component_groups.push(cleanedGroup);
        });

        return cleaned;
    }

    standardizeComponentType(type) {
        if (!type) return 'unknown';
        
        const typeMap = {
            'anker': 'anchor',
            'sjakkel': 'shackle', 
            'ankerkjetting': 'chain',
            'kjetting': 'chain',
            'trosse': 'rope',
            'kause': 'thimble',
            'bøye': 'buoy',
            'spleis': 'splice',
            'trålkule': 'trawl_float',
            'wire': 'wire',
            'tau': 'rope'
        };

        const lowerType = type.toLowerCase();
        for (const [norwegian, english] of Object.entries(typeMap)) {
            if (lowerType.includes(norwegian)) {
                return english;
            }
        }
        
        return type.toLowerCase();
    }

    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }
}

module.exports = AIExtractor;