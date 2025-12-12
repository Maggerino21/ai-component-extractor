const OpenAI = require('openai');
const XLSX = require('xlsx');
require('dotenv').config();
const logger = require('../utils/logger');

class CatalogAwareExtractor {
    constructor(productCatalog = []) {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            dangerouslyAllowBrowser: true
        });
        this.model = 'gpt-4o-mini';
        this.productCatalog = productCatalog;
        this.aiCallCount = 0;
    }

    setProductCatalog(catalog) {
        this.productCatalog = catalog;
        logger.info(`Product catalog loaded: ${catalog.length} products`);
    }

    async extractFromExcel(filePath, fileName, positionMappings = []) {
        try {
            logger.info('🚀 Starting CATALOG-AWARE extraction', { fileName });
            this.aiCallCount = 0;

            const workbook = XLSX.readFile(filePath);
            const allPositionGroups = [];

            for (const sheetName of workbook.SheetNames) {
                if (this.shouldSkipSheet(sheetName)) {
                    logger.info(`⏭️ Skipping sheet: ${sheetName}`);
                    continue;
                }

                logger.info(`📊 Processing sheet: ${sheetName}`);
                const worksheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

                if (!rows || rows.length === 0) continue;

                const positionGroups = await this.extractPositionsWithCatalogMatching(rows, sheetName, positionMappings);
                allPositionGroups.push(...positionGroups);
            }

            logger.info('✅ CATALOG-AWARE extraction complete', {
                totalPositions: allPositionGroups.length,
                totalComponents: allPositionGroups.reduce((s, g) => s + (g.components?.length || 0), 0),
                aiCallsMade: this.aiCallCount
            });

            return {
                success: true,
                data: {
                    document_info: {
                        filename: fileName,
                        type: 'excel',
                        extraction_method: 'catalog_aware_ai',
                        ai_calls_made: this.aiCallCount,
                        catalog_size: this.productCatalog.length
                    },
                    position_groups: allPositionGroups
                }
            };
        } catch (error) {
            logger.error('❌ Catalog-aware extraction failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    async extractPositionsWithCatalogMatching(rows, sheetName, positionMappings) {
        const grouped = this.groupRowsByPosition(rows);
        const positionGroups = [];

        for (const [positionRef, componentRows] of Object.entries(grouped)) {
            logger.info(`🎯 Processing position: ${positionRef} (${componentRows.length} rows)`);

            const componentsText = this.formatComponentsForAI(componentRows);
            
            const relevantCatalog = this.getRelevantCatalog(componentsText);

            const extractedComponents = await this.aiExtractWithCatalog(
                componentsText,
                relevantCatalog,
                positionRef
            );

            const mapping = positionMappings.find(m => 
                m.documentReference.toLowerCase() === positionRef.toLowerCase()
            );

            positionGroups.push({
                document_reference: positionRef,
                internal_position: mapping ? mapping.internalPosition : null,
                position_id: mapping ? mapping.positionId : null,
                mapping_found: !!mapping,
                sheet_source: sheetName,
                components: extractedComponents
            });
        }

        return positionGroups;
    }

    groupRowsByPosition(rows) {
        const grouped = {};

        for (const row of rows) {
            const position = this.extractPosition(row);
            if (!position || this.isHeaderRow(row)) continue;

            if (!grouped[position]) grouped[position] = [];
            grouped[position].push(row);
        }

        return grouped;
    }

    extractPosition(row) {
        const keys = Object.keys(row);
        const positionKeys = keys.filter(k => 
            k.toLowerCase().includes('navn') || 
            k.toLowerCase().includes('nummer') ||
            k.toLowerCase().includes('posisjon')
        );

        if (positionKeys.length > 0) {
            const value = row[positionKeys[0]];
            return value ? value.toString().trim() : null;
        }

        return null;
    }

    isHeaderRow(row) {
        const values = Object.values(row).join(' ').toLowerCase();
        const headerKeywords = ['type', 'posisjon', 'antall', 'fortøyningsline', 'kommentar'];
        return headerKeywords.some(k => values.startsWith(k)) && values.length < 50;
    }

    formatComponentsForAI(rows) {
        return rows.map((row, idx) => {
            const description = Object.values(row).join(' | ');
            return `Component ${idx + 1}: ${description}`;
        }).join('\n');
    }

    getRelevantCatalog(componentsText) {
        const textLower = componentsText.toLowerCase();
        const keywords = ['anker', 'anchor', 'sjakkel', 'shackle', 'kjetting', 'chain', 
                         'tau', 'rope', 'bøye', 'buoy', 'swivel'];

        const relevantProducts = this.productCatalog.filter(p => {
            const descLower = p.description.toLowerCase();
            return keywords.some(k => descLower.includes(k) || textLower.includes(k));
        });

        if (relevantProducts.length > 200) {
            return relevantProducts.slice(0, 200);
        }

        return relevantProducts.length > 0 ? relevantProducts : this.productCatalog.slice(0, 200);
    }

    async aiExtractWithCatalog(componentsText, catalogSubset, positionRef) {
        try {
            this.aiCallCount++;

            const catalogFormatted = catalogSubset.map(p => ({
                id: p.id,
                description: p.description,
                supplier: p.supplier,
                mbl: p.mbl,
                unit: p.unit
            }));

            const prompt = `You are an expert at extracting aquaculture mooring component data and matching it to our product catalog.

**POSITION:** ${positionRef}

**COMPONENT DATA FROM DOCUMENT:**
${componentsText}

**OUR PRODUCT CATALOG (${catalogFormatted.length} products):**
${JSON.stringify(catalogFormatted, null, 2)}

**CRITICAL RULES:**
1. Manufacturer appears ONLY on sequence 1 - all subsequent components inherit it
2. Match each component to our catalog using description + supplier
3. Extract tracking numbers (alphanumeric codes like "606616", "GAP-GBA", "G1463")
4. Extract installation dates if present
5. Ignore noise data like "12T", "20MIN" - focus on tracking numbers and descriptions

**OUTPUT FORMAT (JSON only, no markdown):**
{
  "components": [
    {
      "sequence": 1,
      "type": "anchor",
      "description": "Softanker 1700 kg",
      "manufacturer": "AQS TOR",
      "matched_product_id": 1234,
      "match_confidence": 0.98,
      "match_reason": "Exact description and supplier match",
      "tracking_number": "606616",
      "quantity": 1,
      "unit": "pcs",
      "mbl_kg": 1700,
      "installation_date": "2024-08-01",
      "notes": null
    }
  ]
}

**MATCHING PRIORITY:**
1. Exact: Same description + same supplier = confidence 0.95-1.0
2. Close: Similar description + same supplier = confidence 0.80-0.94
3. Fuzzy: Partial match + same supplier = confidence 0.60-0.79
4. No match: Set matched_product_id to null, confidence 0.0

Return ONLY valid JSON, no markdown backticks.`;

            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a precise extractor for aquaculture mooring components. Return only valid JSON.' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 4000
            });

            const responseText = response.choices[0].message.content.trim();
            
            let parsed;
            try {
                const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                parsed = JSON.parse(cleanedText);
            } catch (e) {
                logger.error('JSON parse failed, attempting cleanup', { response: responseText });
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('Could not extract valid JSON from AI response');
                }
            }

            logger.info(`✅ Extracted ${parsed.components?.length || 0} components for ${positionRef} with catalog matching`);
            
            return parsed.components || [];

        } catch (error) {
            logger.error('❌ AI extraction with catalog failed', error);
            return [];
        }
    }

    shouldSkipSheet(sheetName) {
        const skipPatterns = ['not_flytekrage', 'flytekrage', 'bunnringsoppheng', 'not', 'ekstra'];
        const nameLower = (sheetName || '').toString().toLowerCase();
        return skipPatterns.some(pattern => nameLower.includes(pattern));
    }
}

module.exports = CatalogAwareExtractor;
