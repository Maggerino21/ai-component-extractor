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
        const allPositionRefs = Object.keys(grouped);
        
        const chunks = [];
        for (let i = 0; i < allPositionRefs.length; i += 15) {
            chunks.push(allPositionRefs.slice(i, i + 15));
        }
        
        logger.info(`🚀 Processing ${allPositionRefs.length} positions in ${chunks.length} chunks from sheet: ${sheetName}`);
        
        const allPositionGroups = [];
        
        const chunkPromises = chunks.map(async (chunk) => {
    const chunkPositionsText = chunk.map(positionRef => {
        const componentRows = grouped[positionRef];
        const componentsText = this.formatComponentsForAI(componentRows);
        return `POSITION: ${positionRef}\n${componentsText}\n`;
    }).join('\n---\n\n');
    
    const relevantCatalog = this.getRelevantCatalog(chunkPositionsText);
    
    const chunkExtractedData = await this.aiExtractBatchWithCatalog(
        chunkPositionsText,
        relevantCatalog,
        chunk
    );
    
    return { chunk, chunkExtractedData };
});

const allChunkResults = await Promise.all(chunkPromises);

for (const { chunk, chunkExtractedData } of allChunkResults) {
    for (const [positionRef, extractedComponents] of Object.entries(chunkExtractedData)) {
        const mapping = positionMappings.find(m => 
            m.documentReference.toLowerCase() === positionRef.toLowerCase()
        );
        
        allPositionGroups.push({
            document_reference: positionRef,
            internal_position: mapping ? mapping.internalPosition : null,
            position_id: mapping ? mapping.positionId : null,
            mapping_found: !!mapping,
            sheet_source: sheetName,
            components: extractedComponents
        });
    }
}
        
        return allPositionGroups;
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

    async aiExtractBatchWithCatalog(allPositionsText, catalogSubset, positionRefs) {
        try {
            this.aiCallCount++;
            logger.info(`DEBUG: catalogSubset size BEFORE slice: ${catalogSubset.length} products`);
            logger.info(`DEBUG: First 10 products:`, catalogSubset.slice(0, 10).map(p => p.description));
            logger.info(`DEBUG: Searching for Sjakkel in subset:`, catalogSubset.filter(p => p.description.toLowerCase().includes('sjakkel')).map(p => p.description));
            
            const catalogFormatted = catalogSubset.slice(0, 200).map(p => ({
                id: p.id,
                description: p.description,
                supplier: p.supplier,
                mbl: p.mbl
            }));
            
            const prompt = `Extract aquaculture components from MULTIPLE positions.

**POSITIONS DATA:**
${allPositionsText}

**PRODUCT CATALOG (${catalogFormatted.length} products):**
${JSON.stringify(catalogFormatted, null, 2)}

**CRITICAL RULES:**
1. Manufacturer appears ONLY on sequence 1 per position - all other components inherit it
2. Match to catalog using description + supplier
3. Extract tracking numbers (alphanumeric codes like "606616", "GAP-GBA")
4. QUANTITY EXTRACTION - VERY IMPORTANT:
   - Look for "Antall" column for actual quantity
   - If quantity column is empty or missing, default to 1
   - DO NOT use the sequence number as quantity
   - sequence is just the order (1,2,3), quantity is the amount
5. Return data grouped by position reference

**MATCHING PRIORITY - SEMANTIC UNDERSTANDING REQUIRED:**
1. HIGH CONFIDENCE (0.90-1.0): ALL of these must match:
   - Component type matches (anchor=anchor, shackle=shackle, chain=chain)
   - KEY SPECS EXACT (weight in kg, diameter in mm, length in m, MBL)
   - Description semantically similar (ignore extra words like "MBL", "forankring", "galv")
   - Examples of GOOD matches:
     * "Softanker 1700 kg" → "Anker Soft Hold 1700 kg" (same weight, same type)
     * "Sjakkel 90T" → "Sjakkel MBL 90T forankring 852" (same capacity, same type)
     * "Kjetting 30mm" → "Kjetting stolpeløs 30mm" (same diameter, same type)

2. MEDIUM CONFIDENCE (0.60-0.89): Most match but specs slightly different:
   - Component type matches
   - Specs within 10% (1650kg could match 1700kg)
   - Description reasonably similar

3. NO MATCH (set to null): ANY of these is wrong:
   - Different component type (anchor vs shackle)
   - KEY SPECS DIFFER (1700kg ≠ 1500kg, 30mm ≠ 34mm)
   - Description completely different
   - **CRITICAL: Do NOT match products with different weights, sizes, or capacities!**
   - Better to have null than wrong match

**OUTPUT FORMAT (JSON only, no markdown):**
{
  "H01A": {
    "components": [
      {
        "sequence": 1,
        "type": "anchor",
        "description": "Softanker 1700 kg",
        "manufacturer": "AQS TOR",
        "matched_product_id": 3594,
        "match_confidence": 0.98,
        "match_reason": "Exact match",
        "tracking_number": "606616",
        "quantity": 1,
        "unit": "pcs",
        "mbl_kg": 1700,
        "installation_date": null,
        "notes": null
      },
      {
        "sequence": 2,          
        "type": "shackle",
        "description": "Sjakkel 90T",
        "manufacturer": "AQS TOR",
        "quantity": 2,        
        ...
      }
    ]
  },
  "K01": {
    "components": [...]
  }
}

Return ONLY valid JSON with position references as keys.`;

            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a precise extractor for aquaculture components. Return only valid JSON grouped by position reference.' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 16000
            });

            const responseText = response.choices[0].message.content.trim();
            
            let parsed;
            try {
                const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                parsed = JSON.parse(cleanedText);
            } catch (e) {
                logger.error('JSON parse failed for batch', { response: responseText.substring(0, 500) });
                const emptyResults = {};
                positionRefs.forEach(ref => emptyResults[ref] = []);
                return emptyResults;
            }
            
            const results = {};
            for (const positionRef of positionRefs) {
                const positionData = parsed[positionRef] || parsed[positionRef.toUpperCase()] || parsed[positionRef.toLowerCase()];
                results[positionRef] = positionData?.components || [];
            }
            
            logger.info(`✅ Batch extracted components for ${Object.keys(results).length} positions`);
            
            return results;
            
        } catch (error) {
            logger.error('❌ Batch AI extraction failed', error);
            const emptyResults = {};
            positionRefs.forEach(ref => emptyResults[ref] = []);
            return emptyResults;
        }
    }

    shouldSkipSheet(sheetName) {
        const nameLower = (sheetName || '').toString().toLowerCase();
        
        const allowedPatterns = [
            'fortøyningslinje',
            'fortoyningslinje',
            'fortøyningsliner',
            'fortoyningsliner',
            'mooring',
            'anker',
            'hjørne',
            'hjorne',
            'buoy',
            'bøye',
            'boye',
            'bridle',
            'breidel',
            'rammelinje',
            'rammeliner',
            'ramme',
            'frame'
        ];
        
        const isAllowed = allowedPatterns.some(pattern => nameLower.includes(pattern));
        
        return !isAllowed;
    }
}

module.exports = CatalogAwareExtractor;