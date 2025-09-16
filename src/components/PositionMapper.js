const { useState, useEffect } = require('react');
const logger = require('../utils/logger');

const POSITION_TYPES = {
    MOORING_LINES: { range: [101, 199], label: 'Mooring Lines', prefix: 'ML' },
    BUOYS: { range: [301, 399], label: 'Buoys', prefix: 'B' },
    BRIDLES: { range: [501, 599], label: 'Bridles', prefix: 'BR' },
    FRAME_LINES: { range: [701, 799], label: 'Frame Lines', prefix: 'FL' },
    CAGES: { range: [901, 999], label: 'Cages', prefix: 'C' }
};

function PositionMapper({ facilityId, onMappingComplete, initialMappings = [] }) {
    const [mappings, setMappings] = useState([]);
    const [facilityConfig, setFacilityConfig] = useState({
        numMooringLines: 8,
        numBuoys: 4,
        numBridles: 8,
        numFrameLines: 4,
        numCages: 4
    });
    const [showConfig, setShowConfig] = useState(false);

    useEffect(() => {
        if (initialMappings.length > 0) {
            setMappings(initialMappings);
        } else {
            generateDefaultPositions();
        }
    }, [facilityConfig]);

    const generateDefaultPositions = () => {
        const defaultMappings = [];
        
        for (let i = 0; i < facilityConfig.numMooringLines; i++) {
            defaultMappings.push({
                id: `ml_${i}`,
                internalPosition: 101 + i,
                positionType: 'MOORING_LINES',
                documentReference: '',
                description: `Mooring Line ${i + 1}`,
                isRequired: true
            });
        }
        
        for (let i = 0; i < facilityConfig.numBuoys; i++) {
            defaultMappings.push({
                id: `b_${i}`,
                internalPosition: 301 + i,
                positionType: 'BUOYS',
                documentReference: '',
                description: `Buoy ${i + 1}`,
                isRequired: true
            });
        }
        
        for (let i = 0; i < facilityConfig.numBridles; i++) {
            defaultMappings.push({
                id: `br_${i}`,
                internalPosition: 501 + i,
                positionType: 'BRIDLES',
                documentReference: '',
                description: `Bridle ${i + 1}`,
                isRequired: false
            });
        }
        
        for (let i = 0; i < facilityConfig.numFrameLines; i++) {
            defaultMappings.push({
                id: `fl_${i}`,
                internalPosition: 701 + i,
                positionType: 'FRAME_LINES',
                documentReference: '',
                description: `Frame Line ${i + 1}`,
                isRequired: false
            });
        }

        setMappings(defaultMappings);
    };

    const updateMapping = (id, field, value) => {
        setMappings(prev => prev.map(mapping => 
            mapping.id === id 
                ? { ...mapping, [field]: value }
                : mapping
        ));
    };

    const addCustomMapping = () => {
        const newMapping = {
            id: `custom_${Date.now()}`,
            internalPosition: '',
            positionType: 'MOORING_LINES',
            documentReference: '',
            description: 'Custom Position',
            isRequired: false,
            isCustom: true
        };
        setMappings(prev => [...prev, newMapping]);
    };

    const removeMapping = (id) => {
        setMappings(prev => prev.filter(mapping => mapping.id !== id));
    };

    const validateMappings = () => {
        const errors = [];
        const usedReferences = new Set();
        const usedPositions = new Set();

        mappings.forEach(mapping => {
            if (!mapping.documentReference.trim() && mapping.isRequired) {
                errors.push(`${mapping.description} requires a document reference`);
            }
            
            if (mapping.documentReference && usedReferences.has(mapping.documentReference)) {
                errors.push(`Document reference "${mapping.documentReference}" is used multiple times`);
            }
            
            if (mapping.internalPosition && usedPositions.has(mapping.internalPosition)) {
                errors.push(`Internal position ${mapping.internalPosition} is used multiple times`);
            }
            
            if (mapping.documentReference) {
                usedReferences.add(mapping.documentReference);
            }
            
            if (mapping.internalPosition) {
                usedPositions.add(mapping.internalPosition);
            }
        });

        return errors;
    };

    const saveMappings = () => {
        const errors = validateMappings();
        if (errors.length > 0) {
            alert('Validation errors:\n' + errors.join('\n'));
            return;
        }

        const mappingData = {
            facilityId,
            mappings: mappings.filter(m => m.documentReference.trim()),
            createdAt: new Date().toISOString()
        };

        try {
            localStorage.setItem(`position_mapping_${facilityId}`, JSON.stringify(mappingData));
            logger.info('Position mappings saved', mappingData);
            
            if (onMappingComplete) {
                onMappingComplete(mappingData.mappings);
            }
            
            alert('Position mappings saved successfully!');
        } catch (error) {
            logger.error('Failed to save mappings', error);
            alert('Failed to save mappings: ' + error.message);
        }
    };

    const loadMappings = () => {
        try {
            const saved = localStorage.getItem(`position_mapping_${facilityId}`);
            if (saved) {
                const mappingData = JSON.parse(saved);
                setMappings(mappingData.mappings);
                logger.info('Position mappings loaded', mappingData);
            }
        } catch (error) {
            logger.error('Failed to load mappings', error);
        }
    };

    const groupedMappings = mappings.reduce((acc, mapping) => {
        const type = mapping.positionType;
        if (!acc[type]) acc[type] = [];
        acc[type].push(mapping);
        return acc;
    }, {});

    return (
        <div className="position-mapper">
            <div className="mapper-header">
                <h3>Position Mapping Setup</h3>
                <p>Map document references to internal position numbers</p>
                
                <div className="mapper-controls">
                    <button 
                        className="btn-secondary" 
                        onClick={() => setShowConfig(!showConfig)}
                    >
                        Configure Facility
                    </button>
                    <button className="btn-outline" onClick={loadMappings}>
                        Load Saved
                    </button>
                    <button className="btn-primary" onClick={saveMappings}>
                        Save Mappings
                    </button>
                </div>
            </div>

            {showConfig && (
                <div className="facility-config">
                    <h4>Facility Configuration</h4>
                    <div className="config-grid">
                        <div className="config-item">
                            <label>Mooring Lines:</label>
                            <input 
                                type="number" 
                                min="1" 
                                max="20"
                                value={facilityConfig.numMooringLines}
                                onChange={(e) => setFacilityConfig(prev => ({
                                    ...prev, 
                                    numMooringLines: parseInt(e.target.value)
                                }))}
                            />
                        </div>
                        <div className="config-item">
                            <label>Buoys:</label>
                            <input 
                                type="number" 
                                min="1" 
                                max="20"
                                value={facilityConfig.numBuoys}
                                onChange={(e) => setFacilityConfig(prev => ({
                                    ...prev, 
                                    numBuoys: parseInt(e.target.value)
                                }))}
                            />
                        </div>
                        <div className="config-item">
                            <label>Bridles:</label>
                            <input 
                                type="number" 
                                min="0" 
                                max="20"
                                value={facilityConfig.numBridles}
                                onChange={(e) => setFacilityConfig(prev => ({
                                    ...prev, 
                                    numBridles: parseInt(e.target.value)
                                }))}
                            />
                        </div>
                        <div className="config-item">
                            <label>Frame Lines:</label>
                            <input 
                                type="number" 
                                min="0" 
                                max="20"
                                value={facilityConfig.numFrameLines}
                                onChange={(e) => setFacilityConfig(prev => ({
                                    ...prev, 
                                    numFrameLines: parseInt(e.target.value)
                                }))}
                            />
                        </div>
                    </div>
                    <button 
                        className="btn-primary" 
                        onClick={() => setShowConfig(false)}
                    >
                        Apply Configuration
                    </button>
                </div>
            )}

            <div className="mapping-sections">
                {Object.entries(POSITION_TYPES).map(([typeKey, typeInfo]) => {
                    const typeMappings = groupedMappings[typeKey] || [];
                    if (typeMappings.length === 0) return null;

                    return (
                        <div key={typeKey} className="mapping-section">
                            <h4>{typeInfo.label}</h4>
                            <div className="mapping-grid">
                                {typeMappings.map(mapping => (
                                    <div key={mapping.id} className="mapping-row">
                                        <div className="mapping-info">
                                            <span className="position-number">
                                                {mapping.internalPosition}
                                            </span>
                                            <span className="position-desc">
                                                {mapping.description}
                                            </span>
                                        </div>
                                        <div className="mapping-input">
                                            <input
                                                type="text"
                                                placeholder="Doc ref (e.g. 4b, 1a)"
                                                value={mapping.documentReference}
                                                onChange={(e) => updateMapping(
                                                    mapping.id, 
                                                    'documentReference', 
                                                    e.target.value.trim()
                                                )}
                                                className={mapping.isRequired && !mapping.documentReference ? 'required' : ''}
                                            />
                                        </div>
                                        {mapping.isCustom && (
                                            <button 
                                                className="btn-ghost remove-btn"
                                                onClick={() => removeMapping(mapping.id)}
                                            >
                                                ×
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mapper-footer">
                <button className="btn-outline" onClick={addCustomMapping}>
                    Add Custom Position
                </button>
                <div className="mapping-stats">
                    {mappings.filter(m => m.documentReference.trim()).length} positions mapped
                </div>
            </div>
        </div>
    );
}

module.exports = PositionMapper;