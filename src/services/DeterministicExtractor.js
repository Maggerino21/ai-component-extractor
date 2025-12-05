const XLSX = require('xlsx');
const OpenAI = require('openai');
const fs = require('fs');
require('dotenv').config();
const logger = require('../utils/logger');

class HybridExtractor {
constructor() {
this.client = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
dangerouslyAllowBrowser: true
});
this.model = 'gpt-4o-mini';
this.knownManufacturers = [
'AQS TOR', 'Aqualine', 'Aqua Supporter', 'Scale AQ',
'Mørenot', 'Løvold', 'FSV Group', 'Frøy'
];
this.aiCallCount = 0;
this.aiCache = new Map();
this.aiConcurrency = 10;
}

async extractFromExcel(filePath, fileName) {
    try {
        logger.info('Starting HYBRID extraction', { fileName });
        this.aiCallCount = 0;
        const workbook = XLSX.readFile(filePath);
        const allPositionGroups = [];
        for (const sheetName of workbook.SheetNames) {
            if (this.shouldSkipSheet(sheetName)) {
                logger.info(`Skipping sheet: ${sheetName}`);
                continue;
            }
            logger.info(`Processing sheet: ${sheetName}`);
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
            if (!rows || rows.length === 0) continue;
            const normalizedRows = rows.map(r => this.normalizeRow(r));
            const positionGroups = await this.groupAndProcessRows(normalizedRows, sheetName);
            allPositionGroups.push(...positionGroups);
        }
        logger.info('HYBRID extraction complete', {
            totalPositions: allPositionGroups.length,
            totalComponents: allPositionGroups.reduce((s, g) => s + (g.komponenter?.length || 0), 0),
            aiCallsMade: this.aiCallCount
        });
        return {
            success: true,
            data: {
                document_info: {
                    filename: fileName,
                    type: 'excel',
                    extraction_method: 'hybrid_deterministic_ai',
                    ai_calls_made: this.aiCallCount
                },
                position_groups: allPositionGroups
            }
        };
    } catch (error) {
        logger.error('Hybrid extraction failed', error);
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

shouldSkipSheet(sheetName) {
    const skipPatterns = ['not_flytekrage', 'flytekrage', 'bunnringsoppheng', 'not', 'ekstra'];
    const nameLower = (sheetName || '').toString().toLowerCase();
    return skipPatterns.some(pattern => nameLower.includes(pattern));
}

normalizeRow(row) {
    const lowerKeys = Object.keys(row).reduce((acc, k) => {
        acc[k.toString().toLowerCase().trim()] = k;
        return acc;
    }, {});
    const get = (candidates) => {
        for (const c of candidates) {
            if (lowerKeys[c]) return row[lowerKeys[c]];
        }
        return '';
    };
    return {
        raw: row,
        posisjon: get(['navn / nummer', 'navn', 'nummer', 'posisjon', 'position', 'positioner']),
        rekkefolge: get(['rekkefølge', 'rekkefølge ', 'sequence', 'sekvens', 'pos']),
        type: get(['komponenttype', 'type', 'komponent', 'component']),
        subtype: get(['komponenttype i bruk', 'subtype', 'beskrivelse', 'description']),
        id: get(['identifikasjonsnummer', 'id', 'serienummer', 'identifikasjon']),
        montor: get(['montert av', 'montertav', 'leverandør', 'leverandor', 'manufacturer']),
        montert_dato: get(['montert dato', 'dato', 'date']),
        antall: get(['antall', 'quantity'])
    };
}

async groupAndProcessRows(rows, sheetName) {
    const grouped = {};
    for (const row of rows) {
        const position = (row.posisjon || '').toString().trim();
        if (!position) continue;
        if (this.isHeaderRowRow(row)) continue;
        if (!grouped[position]) grouped[position] = [];
        grouped[position].push(row);
    }
    const positionGroups = [];
    for (const [position, components] of Object.entries(grouped)) {
        components.sort((a, b) => {
            const seqA = parseFloat((a.rekkefolge || '').toString().replace(',', '.')) || 999;
            const seqB = parseFloat((b.rekkefolge || '').toString().replace(',', '.')) || 999;
            return seqA - seqB;
        });
        const preparedComponents = components.map(c => this.prepareForAI(c));
        const componentsWithAi = await this.resolveComponentsWithAI(preparedComponents);
        const processedComponents = componentsWithAi.map(c => ({
            sekvens: parseInt(c.rekkefolge) || 0,
            type: c.componentType || 'ukjent',
            type_original: c.rawType || '',
            beskrivelse: c.rawText || '',
            mengde: c.antall || 1,
            spesifikasjoner: {
                vekt_kg: c.specs.weight_kg ?? null,
                lengde_m: c.specs.length_m ?? null,
                diameter_mm: c.specs.diameter_mm ?? null,
                kapasitet_t: c.specs.capacity_t ?? null
            },
            leverandor: c.cleanManufacturer || c.manufacturer || '',
            sporingsnummer: c.tracking || '',
            part_number: c.partNumber || '',
            montert_dato: c.montert_dato || '',
            confidence: c.confidence || 1.0
        }));
        if (processedComponents.length > 0) {
            positionGroups.push({
                dokument_referanse: position,
                posisjon_type: this.classifyPositionType(position),
                sheet_kilde: sheetName,
                komponenter: processedComponents
            });
        }
    }
    return positionGroups;
}

isHeaderRowRow(row) {
    const type = (row.type || '').toString().trim().toLowerCase();
    const subtype = (row.subtype || '').toString().trim().toLowerCase();
    const combined = `${type} ${subtype}`.trim();
    if (!combined) return true;
    if (/^\d+(\.\d+)?\s*[a-zæøå]/i.test(combined)) return true;
    const headerKeywords = ['type', 'posisjon', 'position', 'antall', 'quantity', 'kommentar', 'merknad', 'fortøyningsline', 'ploganker', 'bunnfortøyning'];
    if (headerKeywords.some(h => combined.startsWith(h))) return true;
    const hasSpecs = /\d+ *mm/.test(combined) || /\d+[.,]?\d* *m(?!m)/.test(combined) || /\d+[.,]?\d* *kg/.test(combined) || /\d+[.,]?\d* *t(?!a)/.test(combined);
    const hasID = (row.id || '').toString().trim() !== '';
    const hasCount = Number(row.antall) > 0;
    if (!hasSpecs && !hasID && !hasCount) return true;
    const categoryWords = ['kjetting', 'sjakkel', 'tau', 'bøye', 'anker', 'line'];
    if (categoryWords.includes(type)) {
        if (!hasSpecs && !hasID) return true;
    }
    return false;
}

prepareForAI(normalizedRow) {
    const rawType = normalizedRow.type || '';
    const rawSub = normalizedRow.subtype || '';
    const idRaw = normalizedRow.id || '';
    const montor = normalizedRow.montor || '';
    const determin = this.extractDeterministicFields(rawType, rawSub, idRaw, montor);
    return {
        rekkefolge: normalizedRow.rekkefolge || '',
        antall: normalizedRow.antall || 1,
        rawType,
        rawSub,
        rawText: `${rawType} ${rawSub}`.trim(),
        manufacturer: determin.manufacturer || montor || '',
        montert_dato: normalizedRow.montert_dato || '',
        tracking: determin.tracking,
        partNumber: determin.partNumber,
        componentType: determin.componentType,
        specs: {
            diameter_mm: determin.diameter_mm,
            length_m: determin.length_m,
            weight_kg: determin.weight_kg,
            capacity_t: determin.capacity_t
        }
    };
}

extractDeterministicFields(type, subtype, idRaw, manufacturerRaw) {
    const full = `${type || ''} ${subtype || ''}`.toLowerCase();
    const diameter = full.match(/(\d+)\s*mm/i)?.[1] ?? null;
    const length = full.match(/(\d+[.,]?\d*)\s*m(?!m)/i)?.[1]?.replace(',', '.') ?? null;
    const weightKg = full.match(/(\d+[.,]?\d*)\s*kg/i)?.[1]?.replace(',', '.') ?? null;
    const capacityT = full.match(/(\d+[.,]?\d*)\s*t(?!a)/i)?.[1]?.replace(',', '.') ?? null;
    let componentType = 'unknown';
    if (full.includes('kjetting')) componentType = 'chain';
    if (full.includes('kjede')) componentType = 'chain';
    if (full.includes('sjakkel') || full.includes('sjakel')) componentType = 'shackle';
    if (full.includes('anker') || full.includes('ploganker')) componentType = 'anchor';
    if (full.includes('tau') || full.includes('trosse') || full.includes('rope')) componentType = 'rope';
    if (full.includes('bøye') || full.includes('buoy')) componentType = 'buoy';
    if (full.includes('swivel') || full.includes('svirvel')) componentType = 'swivel';
    if (full.includes('plate')) componentType = 'grid plate';
    if (full.includes('lodd') || full.includes('søkk') || full.includes('søkke')) componentType = 'sinker';
    const id = idRaw ? idRaw.toString().trim() : '';
    const isTracking = /[A-Z]{2,}-?[A-Z0-9]+/.test(id);
    const isPartNumber = /^\d{4,}$/.test(id) || /^\d{4,}-\d+$/.test(id);
    let tracking = null;
    let partNumber = null;
    if (isTracking) tracking = id;
    else if (isPartNumber) partNumber = id;
    let manufacturer = (manufacturerRaw || '').toString().trim();
    const known = this.knownManufacturers.map(s => s.toLowerCase());
    if (known.includes(manufacturer.toLowerCase())) manufacturer = manufacturer.toUpperCase();
    return {
        componentType,
        diameter_mm: diameter ? Number(diameter) : null,
        length_m: length ? Number(length) : null,
        weight_kg: weightKg ? Number(weightKg) : null,
        capacity_t: capacityT ? Number(capacityT) : null,
        tracking,
        partNumber,
        manufacturer
    };
}

async resolveComponentsWithAI(preparedComponents) {
    const needsAi = [];
    const out = preparedComponents.map(c => Object.assign({}, c));
    for (let i = 0; i < out.length; i++) {
        const c = out[i];
        const ambiguousType = !c.componentType || c.componentType === 'unknown';
        const ambiguousManufacturer = !c.manufacturer || c.manufacturer.length === 0;
        const ambiguousId = c.tracking === null && c.partNumber === null && (c.rawType || c.rawSub || '').length > 0;
        const missingSpecs = c.specs.diameter_mm === null && c.specs.length_m === null && c.specs.weight_kg === null && c.specs.capacity_t === null;
        if (ambiguousType || ambiguousManufacturer || ambiguousId || missingSpecs) {
            needsAi.push({ index: i, payload: c });
        }
    }
    if (needsAi.length === 0) {
        return out.map(o => Object.assign({ confidence: 1.0 }, o));
    }
    const chunks = [];
    for (let i = 0; i < needsAi.length; i += this.aiConcurrency) {
        chunks.push(needsAi.slice(i, i + this.aiConcurrency));
    }
    for (const chunk of chunks) {
        const promises = chunk.map(item => this.aiInterpretComponent(item.payload));
        const results = await Promise.all(promises);
        for (let j = 0; j < chunk.length; j++) {
            const idx = chunk[j].index;
            const res = results[j];
            if (res) {
                out[idx].componentType = res.componentType || out[idx].componentType;
                out[idx].subtype = res.subtype || out[idx].subtype;
                out[idx].cleanManufacturer = res.cleanManufacturer || out[idx].manufacturer || '';
                out[idx].partNumber = res.partNumber || out[idx].partNumber || null;
                out[idx].tracking = res.tracking || out[idx].tracking || null;
                out[idx].specs = Object.assign({}, out[idx].specs, {
                    diameter_mm: res.specs?.diameter_mm ?? out[idx].specs.diameter_mm,
                    length_m: res.specs?.length_m ?? out[idx].specs.length_m,
                    weight_kg: res.specs?.weight_kg ?? out[idx].specs.weight_kg,
                    capacity_t: res.specs?.capacity_t ?? out[idx].specs.capacity_t
                });
                out[idx].confidence = res.confidence ?? 0.9;
            } else {
                out[idx].confidence = 0.5;
            }
        }
    }
    return out;
}

async aiInterpretComponent(component) {
    const key = `${component.rawText}|${component.manufacturer || ''}|${component.tracking || ''}|${component.partNumber || ''}`;
    if (this.aiCache.has(key)) return this.aiCache.get(key);
    try {
        this.aiCallCount++;
        const prompt = `Interpret the following aquaculture component description and return ONLY JSON matching this shape:


{"componentType":"", "subtype":"", "cleanManufacturer":"", "partNumber": null, "tracking": null, "specs":{"weight_kg":null,"length_m":null,"diameter_mm":null,"capacity_t":null}, "confidence":0.0}
Description: "${component.rawText}"
ManufacturerField: "${component.manufacturer || ''}"
ExistingPart: "${component.partNumber || ''}"
ExistingTracking: "${component.tracking || ''}"`;
const response = await this.client.chat.completions.create({
model: this.model,
messages: [
{ role: 'system', content: 'You are a precise extractor for aquaculture component labels. Return valid JSON only.' },
{ role: 'user', content: prompt }
],
temperature: 0,
max_tokens: 250
});
const text = response.choices?.[0]?.message?.content || '';
let parsed = null;
try {
parsed = JSON.parse(text);
} catch (e) {
const cleaned = text.replace(/^[^{]*/, '').replace(/\s+$/, '');
try {
parsed = JSON.parse(cleaned);
} catch (e2) {
parsed = null;
}
}
if (!parsed) {
const fallback = {
componentType: component.componentType || 'ukjent',
subtype: component.rawSub || '',
cleanManufacturer: component.manufacturer || '',
partNumber: component.partNumber || null,
tracking: component.tracking || null,
specs: {
weight_kg: component.specs.weight_kg || null,
length_m: component.specs.length_m || null,
diameter_mm: component.specs.diameter_mm || null,
capacity_t: component.specs.capacity_t || null
},
confidence: 0.5
};
this.aiCache.set(key, fallback);
return fallback;
}
const out = {
componentType: parsed.componentType || component.componentType || 'ukjent',
subtype: parsed.subtype || component.rawSub || '',
cleanManufacturer: parsed.cleanManufacturer || component.manufacturer || '',
partNumber: parsed.partNumber || component.partNumber || null,
tracking: parsed.tracking || component.tracking || null,
specs: {
weight_kg: parsed.specs?.weight_kg ?? component.specs.weight_kg,
length_m: parsed.specs?.length_m ?? component.specs.length_m,
diameter_mm: parsed.specs?.diameter_mm ?? component.specs.diameter_mm,
capacity_t: parsed.specs?.capacity_t ?? component.specs.capacity_t
},
confidence: parsed.confidence ?? 0.9
};
this.aiCache.set(key, out);
return out;
} catch (error) {
logger.warn('AI interpret failed', { error: error.message, input: component.rawText });
const fallback = {
componentType: component.componentType || 'ukjent',
subtype: component.rawSub || '',
cleanManufacturer: component.manufacturer || '',
partNumber: component.partNumber || null,
tracking: component.tracking || null,
specs: {
weight_kg: component.specs.weight_kg || null,
length_m: component.specs.length_m || null,
diameter_mm: component.specs.diameter_mm || null,
capacity_t: component.specs.capacity_t || null
},
confidence: 0.5
};
this.aiCache.set(key, fallback);
return fallback;
}
}

async classifyWithAI(text) {
    const cacheKey = `type_${text}`;
    if (this.aiCache.has(cacheKey)) return this.aiCache.get(cacheKey);
    try {
        this.aiCallCount++;
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [{
                role: 'user',
                content: `Classify Norwegian aquaculture component: "${text}" Answer with one of: anker, sjakkel, kjetting, tau, kause, masterlink, tbolt, koblingsskive, bøye, swivel, wire, ukjent`
            }],
            max_tokens: 10,
            temperature: 0
        });
        const resultType = (response.choices?.[0]?.message?.content || '').toLowerCase().trim();
        const res = { type: resultType || 'ukjent', confidence: 0.9 };
        this.aiCache.set(cacheKey, res);
        return res;
    } catch (error) {
        logger.warn('AI classification failed', { text, error: error.message });
        return { type: 'ukjent', confidence: 0.3 };
    }
}

async classifyIdentifiers(idString, description) {
    if (!idString || idString.trim() === '') return { partNumber: null, tracking: null };
    const id = idString.trim();
    if (/^\d{5,}$/.test(id)) return { partNumber: id, tracking: null };
    if (/^\d{5,}-\d+$/.test(id)) return { partNumber: id, tracking: null };
    if (/^[A-Z]{2,3}-[A-Z]{2,3}$/.test(id)) return { partNumber: null, tracking: id };
    if (/^[A-Z]\d{1,4}$/.test(id)) return { partNumber: null, tracking: id };
    if (/^[A-Z]+\d+$/.test(id) && id.length <= 6) return { partNumber: null, tracking: id };
    if (/^\d+T$/.test(id) || /^\d+MIN$/.test(id)) return { partNumber: null, tracking: null };
    if (/^\d{6,}-\d+$/.test(id)) return { partNumber: id, tracking: null };
    if (/^\d{6,}$/.test(id)) return { partNumber: id, tracking: null };
    if (id.length > 5 && id.length < 20) return this.classifyIdWithAI(id, description);
    return { partNumber: null, tracking: id };
}

async classifyIdWithAI(id, description) {
    const cacheKey = `id_${id}`;
    if (this.aiCache.has(cacheKey)) return this.aiCache.get(cacheKey);
    try {
        this.aiCallCount++;
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [{
                role: 'user',
                content: `Classify identifier: "${id}" (context: ${description}) Is this a: part_number, tracking, or neither. Answer with one word: part_number, tracking, or neither`
            }],
            max_tokens: 10,
            temperature: 0
        });
        const classification = (response.choices?.[0]?.message?.content || '').toLowerCase().trim();
        let result;
        if (classification.includes('part')) result = { partNumber: id, tracking: null };
        else if (classification.includes('tracking')) result = { partNumber: null, tracking: id };
        else result = { partNumber: null, tracking: id };
        this.aiCache.set(cacheKey, result);
        return result;
    } catch (error) {
        logger.warn('AI ID classification failed', { id, error: error.message });
        return { partNumber: null, tracking: id };
    }
}

extractSpecifications(description) {
    if (!description) return { vekt_kg: null, lengde_m: null, diameter_mm: null, kapasitet_t: null };
    const text = description.toLowerCase();
    const num = s => parseFloat(s.replace(',', '.'));
    const weightMatch = text.match(/(\d+[.,]?\d*)\s*kg/);
    const lengthMatch = text.match(/(\d+[.,]?\d*)\s*m(?!m)/);
    const diameterMatch = text.match(/(\d+)\s*mm/);
    const capacityMatch = text.match(/(\d+[.,]?\d*)\s*t/);
    return {
        vekt_kg: weightMatch ? num(weightMatch[1]) : null,
        lengde_m: lengthMatch ? num(lengthMatch[1]) : null,
        diameter_mm: diameterMatch ? Number(diameterMatch[1]) : null,
        kapasitet_t: capacityMatch ? num(capacityMatch[1]) : null
    };
}

classifyPositionType(position) {
    if (/^H\d/i.test(position)) return 'fortøyningslinje';
    if (/^K\d/i.test(position)) return 'koblingspunkt';
    if (/^S\d/i.test(position)) return 'sideline';
    if (/^R\d/i.test(position)) return 'ramme';
    if (/^A\d/i.test(position)) return 'ankerpunkt';
    if (/^B\d/i.test(position)) return 'bøye';
    if (/bur/i.test(position)) return 'bur';
    return 'ukjent';
}

async testConnection() {
    try {
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: [{ role: 'user', content: 'Test. Respond with OK.' }],
            max_tokens: 10
        });
        return { success: true, model: this.model, response: response.choices[0].message.content };
    } catch (error) {
        return { success: false, error: error.message };
    }
}


}

module.exports = HybridExtractor;