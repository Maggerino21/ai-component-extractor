const OpenAI = require('openai');
require('dotenv').config();
const logger = require('../utils/logger');

class AIExtractor {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
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
                componentsFound: extractedData.components?.length || 0,
                positionsIdentified: extractedData.positions?.length || 0
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
        return `You are an expert in extracting aquaculture mooring system component data from technical documents.

Your task is to analyze documents and extract structured information about mooring system components including:
- Ropes, chains, shackles, anchors, buoys, clump weights, swivels, connectors
- Component specifications (length, diameter, weight, breaking strength)
- Installation dates, tracking numbers, certificates
- Position references from the document

Key Norwegian aquaculture manufacturers to recognize:
- Scale AQ, Mørenot, Akva Group, Steinsvik, Polarcirkel, Fortuna, Hydroniq

Output format must be valid JSON with this exact structure:
{
  "facility_info": {
    "facility_name": "string or null",
    "installation_date": "ISO date or null"
  },
  "positions": [
    {
      "document_reference": "string (e.g. '1a', '4b', '2c')",
      "position_description": "string describing the position type",
      "components": [
        {
          "type": "string (rope, chain, shackle, anchor, buoy, clump_weight, swivel, connector)",
          "description": "string",
          "length_m": "number or null",
          "diameter_mm": "number or null", 
          "weight_kg": "number or null",
          "breaking_strength_kg": "number or null",
          "material": "string or null",
          "manufacturer": "string or null",
          "tracking_number": "string or null",
          "certificate": "string or null",
          "installation_date": "ISO date or null",
          "quantity": "number (default 1)",
          "unit": "string (m, pcs, kg, etc)",
          "notes": "string or null",
          "confidence": "number (0.0-1.0)"
        }
      ]
    }
  ],
  "extraction_summary": {
    "total_positions": "number",
    "total_components": "number",
    "extraction_method": "string",
    "confidence_average": "number"
  }
}

Rules:
- Extract ALL components found, even if uncertain
- Use document_reference exactly as written (1a, 4b, Line 2, etc)
- Set confidence based on how clear the information is
- Include manufacturer even if not 100% certain
- Convert all measurements to metric (meters, kg, mm)
- Preserve original tracking numbers and certificate info exactly
- If no position reference is clear, use "unknown" as document_reference`;
    }

    buildExtractionPrompt(fileData, positionMappings) {
        let prompt = `Extract aquaculture mooring system components from this document:

FILE: ${fileData.fileName}
TYPE: ${fileData.type}

`;

        if (positionMappings.length > 0) {
            prompt += `POSITION MAPPINGS (for reference):
${positionMappings.map(m => `- Document ref "${m.documentReference}" → Internal position ${m.internalPosition}`).join('\n')}

`;
        }

        if (fileData.type === 'pdf') {
            prompt += `DOCUMENT TEXT:
${fileData.text}

KEYWORDS FOUND: ${fileData.keywords?.map(k => k.keyword).join(', ')}
`;
        }

        if (fileData.type === 'excel' && fileData.sheets) {
            prompt += `EXCEL SHEETS:
`;
            fileData.sheets.forEach(sheet => {
                prompt += `
Sheet: ${sheet.name}
Rows: ${sheet.rowCount}
Headers: ${sheet.headers?.join(', ')}

Sample Data:
${JSON.stringify(sheet.objectData?.slice(0, 5), null, 2)}
`;
            });
        }

        prompt += `

Extract all mooring system components with their specifications. Pay attention to:
- Position references (1a, 4b, Line 2, etc.)
- Component types and specifications
- Manufacturer information
- Tracking/serial numbers
- Installation dates
- Breaking loads and technical specifications

Return valid JSON only.`;

        return prompt;
    }

    parseAIResponse(responseText) {
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            const extractedData = JSON.parse(jsonMatch[0]);
            
            if (!extractedData.positions || !Array.isArray(extractedData.positions)) {
                throw new Error('Invalid response structure: missing positions array');
            }

            return this.validateAndCleanData(extractedData);

        } catch (error) {
            logger.error('Failed to parse AI response', { error: error.message, responseText });
            throw new Error(`AI response parsing failed: ${error.message}`);
        }
    }

    validateAndCleanData(data) {
        const cleaned = {
            facility_info: data.facility_info || {},
            positions: [],
            extraction_summary: data.extraction_summary || {}
        };

        data.positions.forEach(position => {
            const cleanedPosition = {
                document_reference: position.document_reference || 'unknown',
                position_description: position.position_description || '',
                components: []
            };

            if (position.components && Array.isArray(position.components)) {
                position.components.forEach(component => {
                    const cleanedComponent = {
                        type: component.type || 'unknown',
                        description: component.description || '',
                        length_m: this.parseNumber(component.length_m),
                        diameter_mm: this.parseNumber(component.diameter_mm),
                        weight_kg: this.parseNumber(component.weight_kg),
                        breaking_strength_kg: this.parseNumber(component.breaking_strength_kg),
                        material: component.material || null,
                        manufacturer: component.manufacturer || null,
                        tracking_number: component.tracking_number || null,
                        certificate: component.certificate || null,
                        installation_date: component.installation_date || null,
                        quantity: this.parseNumber(component.quantity) || 1,
                        unit: component.unit || 'pcs',
                        notes: component.notes || null,
                        confidence: Math.min(Math.max(this.parseNumber(component.confidence) || 0.5, 0), 1)
                    };

                    cleanedPosition.components.push(cleanedComponent);
                });
            }

            cleaned.positions.push(cleanedPosition);
        });

        cleaned.extraction_summary = {
            total_positions: cleaned.positions.length,
            total_components: cleaned.positions.reduce((sum, pos) => sum + pos.components.length, 0),
            extraction_method: 'ai',
            confidence_average: this.calculateAverageConfidence(cleaned.positions)
        };

        return cleaned;
    }

    parseNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const num = parseFloat(value);
        return isNaN(num) ? null : num;
    }

    calculateAverageConfidence(positions) {
        const allComponents = positions.flatMap(pos => pos.components);
        if (allComponents.length === 0) return 0;
        
        const totalConfidence = allComponents.reduce((sum, comp) => sum + comp.confidence, 0);
        return Math.round((totalConfidence / allComponents.length) * 100) / 100;
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

module.exports = AIExtractor;