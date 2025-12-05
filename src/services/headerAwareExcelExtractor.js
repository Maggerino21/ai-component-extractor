const logger = require('../utils/logger');

class HeaderAwareExcelExtractor {
    constructor() {
        this.knownManufacturers = [
            'AQS TOR',
            'Aqualine',
            'Sabik',
            'Scale AQ',
            'Mørenot',
            'FSV Group',
            'Frøy',
            'Løvold',
            'Aqua Supporter',
            'RopeTech',
            'ChainWorks',
            'AnchorCo',
            'ShacklePro',
            'BuoyTech'
        ];
        
        this.headerRowPatterns = [
            /fortøyningsline\s+type/i,
            /bunnfortøyning\s+type/i,
            /koblingspunkt\s+type/i,
            /konsept/i,
            /^type\s+\d/i,
            /line\s+type/i
        ];
    }

    async extractFromExcelData(excelData, positionMappings = []) {
        try {
            logger.info('🚀 Starting header-aware Excel extraction (Norwegian)');
            
            const allPositionGroups = [];
            const skippedSheets = ['not_flytekrage', 'flytekrage', 'bunnringsoppheng', 'ekstra'];
            
            if (!excelData.sheets || !Array.isArray(excelData.sheets)) {
                throw new Error('Invalid Excel data structure');
            }

            for (const sheet of excelData.sheets) {
                const sheetNameLower = sheet.name.toLowerCase();
                const shouldSkip = skippedSheets.some(skip => sheetNameLower.includes(skip));
                
                if (shouldSkip) {
                    logger.info(`⏭️ Skipping sheet: ${sheet.name} (not used in program)`);
                    continue;
                }

                logger.info(`📊 Processing sheet: ${sheet.name}`);
                
                const positionGroups = this.processSheet(sheet);
                allPositionGroups.push(...positionGroups);
                
                logger.info(`✅ Extracted ${positionGroups.length} position groups from ${sheet.name}`);
            }

            logger.info(`✅ HEADER-AWARE extraction complete`, {
                totalPositions: allPositionGroups.length,
                totalComponents: allPositionGroups.reduce((sum, g) => sum + g.komponenter.length, 0)
            });

            return {
                success: true,
                data: {
                    document_info: {
                        filename: excelData.fileName,
                        type: 'excel',
                        sheets_processed: excelData.sheets.length,
                        processing_method: 'header-aware-norwegian'
                    },
                    position_groups: allPositionGroups
                }
            };

        } catch (error) {
            logger.error('❌ Header-aware extraction failed', error);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    processSheet(sheet) {
        if (!sheet.rawData || sheet.rawData.length < 2) {
            logger.warn(`⚠️ Sheet ${sheet.name} has no data`);
            return [];
        }

        const headers = sheet.rawData[0];
        const columnMap = this.mapColumns(headers, sheet.name);
        
        logger.info(`🗺️ Column mapping for ${sheet.name}:`, columnMap);

        const positionGroups = {};

        for (let i = 1; i < sheet.rawData.length; i++) {
            const row = sheet.rawData[i];
            
            if (!row || row.length === 0) continue;

            const component = this.extractComponentFromRow(row, columnMap, sheet.name);
            
            if (!component) continue;

            if (this.isHeaderRow(component)) {
                logger.info(`⏭️ Skipping header row: ${component.type}`);
                continue;
            }

            const position = component.posisjon;
            if (!position) {
                logger.warn(`⚠️ Row ${i + 1} missing position, skipping`);
                continue;
            }

            if (!positionGroups[position]) {
                positionGroups[position] = {
                    dokument_referanse: position,
                    posisjon_type: this.classifyPositionType(position),
                    sheet_kilde: sheet.name,
                    komponenter: []
                };
            }

            positionGroups[position].komponenter.push(component);
        }

        this.enrichWithManufacturers(positionGroups);

        return Object.values(positionGroups);
    }

    mapColumns(headers, sheetName) {
        const columnMap = {
            position: -1,
            sequence: -1,
            type: -1,
            description: -1,
            tracking1: -1,
            tracking2: -1,
            date: -1,
            manufacturer: -1
        };

        for (let i = 0; i < headers.length; i++) {
            const header = (headers[i] || '').toString().toLowerCase().trim();
            
            if (header.includes('navn') || header.includes('nummer') || header === 'posisjon') {
                columnMap.position = i;
            }
            else if (header.includes('rekkefølge') || header.includes('sekv')) {
                columnMap.sequence = i;
            }
            else if (header === 'komponenttype' || header === 'type') {
                columnMap.type = i;
            }
            else if (header.includes('komponenttype i bruk') || header.includes('beskrivelse')) {
                columnMap.description = i;
            }
            else if (header.includes('serienummer')) {
                columnMap.tracking1 = i;
            }
            else if (header.includes('identifikasjonsnummer')) {
                columnMap.tracking2 = i;
            }
            else if (header.includes('montert dato') || header.includes('identifisert tid')) {
                columnMap.date = i;
            }
            else if (header.includes('montert av') || header.includes('leverandør')) {
                columnMap.manufacturer = i;
            }
        }

        return columnMap;
    }

    extractComponentFromRow(row, columnMap, sheetName) {
        const posisjon = columnMap.position >= 0 ? this.cleanValue(row[columnMap.position]) : null;
        const sekvens = columnMap.sequence >= 0 ? parseInt(row[columnMap.sequence]) : null;
        const type = columnMap.type >= 0 ? this.cleanValue(row[columnMap.type]) : null;
        const beskrivelse = columnMap.description >= 0 ? this.cleanValue(row[columnMap.description]) : '';
        
        const tracking1 = columnMap.tracking1 >= 0 ? this.cleanValue(row[columnMap.tracking1]) : '';
        const tracking2 = columnMap.tracking2 >= 0 ? this.cleanValue(row[columnMap.tracking2]) : '';
        const sporingsnummer = tracking1 || tracking2 || null;
        
        const dato = columnMap.date >= 0 ? this.cleanValue(row[columnMap.date]) : null;
        const leverandor = columnMap.manufacturer >= 0 ? this.cleanValue(row[columnMap.manufacturer]) : null;

        if (!posisjon || !type) {
            return null;
        }

        const normalizedType = this.normalizeComponentType(type);
        const spesifikasjoner = this.extractSpecifications(beskrivelse);
        const extractedManufacturer = this.extractManufacturerFromDescription(beskrivelse);

        const component = {
            posisjon: posisjon,
            sekvens: isNaN(sekvens) ? null : sekvens,
            type: normalizedType,
            type_original: type,
            beskrivelse: beskrivelse,
            mengde: 1,
            spesifikasjoner: spesifikasjoner,
            leverandor: leverandor || extractedManufacturer || null,
            sporingsnummer: sporingsnummer,
            montert_dato: dato,
            confidence: 0.95
        };

        return component;
    }

    cleanValue(value) {
        if (value === null || value === undefined) return null;
        const str = value.toString().trim();
        return str === '' ? null : str;
    }

    isHeaderRow(component) {
        if (!component.type && !component.beskrivelse) return true;
        
        const textToCheck = `${component.type || ''} ${component.beskrivelse || ''}`.toLowerCase();
        
        return this.headerRowPatterns.some(pattern => pattern.test(textToCheck)) &&
               textToCheck.length < 50 &&
               !component.spesifikasjoner.vekt_kg &&
               !component.spesifikasjoner.lengde_m;
    }

    extractManufacturerFromDescription(description) {
        if (!description) return null;
        
        for (const manufacturer of this.knownManufacturers) {
            const regex = new RegExp(`\\b${manufacturer}\\b`, 'i');
            if (regex.test(description)) {
                return manufacturer;
            }
        }
        
        return null;
    }

    enrichWithManufacturers(positionGroups) {
        for (const position in positionGroups) {
            const group = positionGroups[position];
            const komponenter = group.komponenter;
            
            if (komponenter.length === 0) continue;

            komponenter.sort((a, b) => (a.sekvens || 999) - (b.sekvens || 999));

            const firstComponent = komponenter[0];
            const firstManufacturer = firstComponent.leverandor;

            if (firstManufacturer) {
                logger.info(`🏭 Manufacturer: "${firstManufacturer}" for position ${position}`);
                
                for (let i = 1; i < komponenter.length; i++) {
                    if (!komponenter[i].leverandor) {
                        komponenter[i].leverandor = firstManufacturer;
                        komponenter[i].leverandor_inherited = true;
                        logger.info(`👨‍👩‍👧 Inherited "${firstManufacturer}" → ${position} seq ${komponenter[i].sekvens}`);
                    }
                }
            }
        }
    }

    normalizeComponentType(type) {
        if (!type) return 'ukjent';
        
        const normalized = type.toLowerCase().trim();
        
        const typeMap = {
            'ploganker': 'anker',
            'anker': 'anker',
            'sjakkel': 'sjakkel',
            'kjetting': 'kjetting',
            'trosse': 'tau',
            'tau': 'tau',
            'wire': 'wire',
            'kause': 'kause',
            'koblingsskive': 'koblingsskive',
            'koblingspunkt': 'koblingspunkt',
            'bøye': 'bøye',
            'markeringsblink': 'markeringsblink',
            'batteri': 'batteri',
            'master link': 'masterlink',
            't-bolt': 'tbolt',
            'forankringsbolt': 'tbolt',
            'øvre sjakkel': 'sjakkel',
            'nedre sjakkel': 'sjakkel'
        };

        return typeMap[normalized] || normalized;
    }

    extractSpecifications(description) {
        const specs = {};
        
        if (!description) return specs;

        const weightMatch = description.match(/(\d+(?:\.\d+)?)\s*kg/i);
        if (weightMatch) specs.vekt_kg = parseFloat(weightMatch[1]);

        const lengthMatch = description.match(/(\d+(?:\.\d+)?)\s*m(?:\s|$|,|\.|-)/i);
        if (lengthMatch) specs.lengde_m = parseFloat(lengthMatch[1]);

        const diameterMatch = description.match(/[øØ]?\s*(\d+(?:\.\d+)?)\s*mm/i);
        if (diameterMatch) specs.diameter_mm = parseFloat(diameterMatch[1]);

        const capacityMatchT = description.match(/(\d+(?:\.\d+)?)\s*T(?:\s|$|,|\.)/);
        if (capacityMatchT) specs.kapasitet_t = parseFloat(capacityMatchT[1]);

        const hullMatch = description.match(/(\d+)\s*hull/i);
        if (hullMatch) specs.antall_hull = parseInt(hullMatch[1]);

        return specs;
    }

    classifyPositionType(position) {
        if (!position) return 'ukjent';
        
        const posStr = position.toString().toUpperCase();
        
        if (posStr.match(/^H\d/)) return 'fortøyningslinje';
        if (posStr.match(/^K\d/)) return 'koblingspunkt';
        if (posStr.match(/^S\d/)) return 'stag';
        if (posStr.match(/^A\d/)) return 'ankerpunkt';
        if (posStr.match(/^B\d/)) return 'bøye';
        
        return 'komponent_linje';
    }
}

module.exports = HeaderAwareExcelExtractor;