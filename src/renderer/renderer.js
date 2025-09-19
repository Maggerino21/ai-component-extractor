const { ipcRenderer } = require('electron');

// DOM elements - with null checks
const uploadArea = document.getElementById('uploadArea');
const uploadDropZone = document.getElementById('uploadDropZone') || uploadArea;
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileList = document.getElementById('fileList');
const selectedFiles = document.getElementById('selectedFiles');
const processBtn = document.getElementById('processBtn');
const mappingBtn = document.getElementById('mappingBtn');
const clearBtn = document.getElementById('clearBtn');
const resultsArea = document.getElementById('resultsArea');
const processingArea = document.getElementById('processingArea');
const progressBar = document.getElementById('progressBar');
const progressStatus = document.getElementById('progressStatus');

// Import services
const FileProcessor = require('../services/fileProcessor');
const logger = require('../utils/logger');

// Initialize services
const fileProcessor = new FileProcessor();

// Global state
let uploadedFiles = [];
let positionMappings = [];
let extractedData = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    try {
        initializeEventListeners();
        showStep('upload');
        logger.info('AI Component Extractor initialized');
    } catch (error) {
        console.error('Initialization failed:', error);
        showError('Failed to initialize application: ' + error.message);
    }
});

function initializeEventListeners() {
    // File upload events
    if (selectFilesBtn) {
        selectFilesBtn.addEventListener('click', selectFiles);
    }
    if (uploadDropZone) {
        uploadDropZone.addEventListener('click', selectFiles);
        uploadDropZone.addEventListener('dragover', handleDragOver);
        uploadDropZone.addEventListener('dragleave', handleDragLeave);
        uploadDropZone.addEventListener('drop', handleDrop);
    }
    
    // Button events
    if (processBtn) {
        processBtn.addEventListener('click', processFiles);
    }
    if (mappingBtn) {
        mappingBtn.addEventListener('click', setupPositionMapping);
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', clearAll);
    }
    
    logger.info('Event listeners initialized');
}

function showStep(step) {
    const areas = {
        'upload': uploadArea,
        'mapping': document.getElementById('mappingArea'),
        'processing': processingArea,
        'results': resultsArea
    };
    
    // Hide all areas
    Object.values(areas).forEach(area => {
        if (area) area.style.display = 'none';
    });
    
    // Show current area
    if (areas[step]) {
        areas[step].style.display = 'block';
    }
    
    updateStepIndicators(step);
}

function updateStepIndicators(currentStep) {
    const indicators = document.querySelectorAll('.step-indicator');
    const stepOrder = ['upload', 'mapping', 'processing', 'results'];
    const currentIndex = stepOrder.indexOf(currentStep);
    
    indicators.forEach((indicator, index) => {
        indicator.classList.remove('active', 'completed');
        
        if (index < currentIndex) {
            indicator.classList.add('completed');
        } else if (index === currentIndex) {
            indicator.classList.add('active');
        }
    });
}

async function selectFiles() {
    try {
        const files = await ipcRenderer.invoke('select-files');
        if (files && files.length > 0) {
            uploadedFiles = files;
            displaySelectedFiles();
            logger.info(`Selected ${files.length} files for processing`);
        }
    } catch (error) {
        showError('Failed to select files: ' + error.message);
        logger.error('File selection failed', error);
    }
}

function displaySelectedFiles() {
    if (!selectedFiles) return;
    
    selectedFiles.innerHTML = '';
    
    uploadedFiles.forEach(filePath => {
        const fileName = filePath.split('/').pop().split('\\').pop();
        const fileExt = fileName.split('.').pop().toLowerCase();
        const icon = fileExt === 'pdf' ? '📄' : '📊';
        
        const li = document.createElement('li');
        li.innerHTML = `${icon} ${fileName}`;
        selectedFiles.appendChild(li);
    });
    
    if (fileList) {
        fileList.style.display = 'block';
    }
    if (uploadDropZone) {
        uploadDropZone.style.display = 'none';
    }
    
    updateProcessButton();
}

function updateProcessButton() {
    if (uploadedFiles.length > 0) {
        if (mappingBtn) mappingBtn.disabled = false;
        if (processBtn) processBtn.disabled = positionMappings.length === 0;
    } else {
        if (mappingBtn) mappingBtn.disabled = true;
        if (processBtn) processBtn.disabled = true;
    }
}

function handleDragOver(e) {
    e.preventDefault();
    if (uploadDropZone) {
        uploadDropZone.classList.add('dragover');
    }
}

function handleDragLeave(e) {
    e.preventDefault();
    if (uploadDropZone) {
        uploadDropZone.classList.remove('dragover');
    }
}

function handleDrop(e) {
    e.preventDefault();
    if (uploadDropZone) {
        uploadDropZone.classList.remove('dragover');
    }
    
    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => {
        return fileProcessor.validateFileSupport(file.path);
    });
    
    if (validFiles.length > 0) {
        uploadedFiles = validFiles.map(file => file.path);
        displaySelectedFiles();
        logger.info(`${validFiles.length} files dropped for processing`);
    } else {
        showError('Please drop only PDF or Excel files.');
    }
}

function setupPositionMapping() {
    if (uploadedFiles.length === 0) {
        showError('Please select files first');
        return;
    }
    
    showStep('mapping');
    initializePositionMapper();
}

function initializePositionMapper() {
    const mappingArea = document.getElementById('mappingArea');
    if (!mappingArea) return;
    
    mappingArea.innerHTML = `
        <div class="position-mapper">
            <div class="mapper-header">
                <h3>Setup Position Mapping</h3>
                <p>Map document references to internal positions</p>
            </div>
            
            <div class="facility-config">
                <h4>Configure Facility</h4>
                <div class="config-row">
                    <label>Mooring Lines:</label>
                    <input type="number" id="mooringLinesCount" value="8" min="1" max="20">
                </div>
                <div class="config-row">
                    <label>Buoys:</label>
                    <input type="number" id="buoysCount" value="4" min="1" max="10">
                </div>
                <div class="config-row">
                    <label>Bridles:</label>
                    <input type="number" id="bridlesCount" value="4" min="1" max="10">
                </div>
                <button onclick="generatePositions()" class="btn-secondary">Generate Positions</button>
            </div>
            
            <div id="positionMappings" class="position-mappings">
                <h4>Position Mappings</h4>
                <div id="mappingsList"></div>
                <button onclick="addCustomMapping()" class="btn-secondary">Add Custom Mapping</button>
            </div>
            
            <div class="mapping-actions">
                <button onclick="saveMappings()" class="btn-primary">Save Mappings</button>
                <button onclick="backToUpload()" class="btn-secondary">Back to Upload</button>
            </div>
        </div>
    `;
}

function generatePositions() {
    const mooringCount = parseInt(document.getElementById('mooringLinesCount')?.value || 8);
    const buoyCount = parseInt(document.getElementById('buoysCount')?.value || 4);
    const bridleCount = parseInt(document.getElementById('bridlesCount')?.value || 4);
    
    const positions = [];
    
    // Generate mooring line positions (101-199)
    for (let i = 1; i <= mooringCount; i++) {
        positions.push({
            internal: 100 + i,
            type: 'Mooring Line',
            description: `Mooring Line ${i}`,
            docRef: ''
        });
    }
    
    // Generate buoy positions (301-399)  
    for (let i = 1; i <= buoyCount; i++) {
        positions.push({
            internal: 300 + i,
            type: 'Buoy',
            description: `Buoy ${i}`,
            docRef: ''
        });
    }
    
    // Generate bridle positions (501-599)
    for (let i = 1; i <= bridleCount; i++) {
        positions.push({
            internal: 500 + i,
            type: 'Bridle', 
            description: `Bridle ${i}`,
            docRef: ''
        });
    }
    
    renderMappingsList(positions);
}

function renderMappingsList(positions) {
    const mappingsList = document.getElementById('mappingsList');
    if (!mappingsList) return;
    
    mappingsList.innerHTML = positions.map((pos, index) => `
        <div class="mapping-row">
            <div class="position-info">
                <span class="position-number">${pos.internal}</span>
                <span class="position-type">${pos.type}</span>
                <span class="position-desc">${pos.description}</span>
            </div>
            <div class="document-reference">
                <input 
                    type="text" 
                    placeholder="Document ref (e.g. 1a, 2b, 11c)"
                    value="${pos.docRef}"
                    oninput="updateMappingReference(${index}, this.value)"
                />
            </div>
        </div>
    `).join('');
    
    window.currentPositions = positions;
}

function updateMappingReference(index, value) {
    if (window.currentPositions) {
        window.currentPositions[index].docRef = value;
    }
}

function addCustomMapping() {
    const customPos = {
        internal: parseInt(prompt('Enter internal position number:') || '0'),
        type: 'Custom',
        description: prompt('Enter position description:') || 'Custom Position',
        docRef: prompt('Enter document reference:') || ''
    };
    
    if (customPos.internal > 0) {
        window.currentPositions = window.currentPositions || [];
        window.currentPositions.push(customPos);
        renderMappingsList(window.currentPositions);
    }
}

function saveMappings() {
    if (!window.currentPositions) {
        showError('No positions to save');
        return;
    }
    
    // Filter positions with document references
    positionMappings = window.currentPositions
        .filter(pos => pos.docRef && pos.docRef.trim())
        .map(pos => ({
            documentReference: pos.docRef.trim(),
            internalPosition: parseInt(pos.internal),
            positionType: pos.type,
            description: pos.description
        }));
    
    if (positionMappings.length === 0) {
        showError('Please add document references to at least one position');
        return;
    }
    
    showNotification(`Saved ${positionMappings.length} position mappings`, 'success');
    updateProcessButton();
    
    // Show mapping summary
    displayMappingSummary();
    
    logger.info('Position mappings saved', { count: positionMappings.length });
}

function displayMappingSummary() {
    const mappingArea = document.getElementById('mappingArea');
    if (!mappingArea) return;
    
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'position-mappings-summary';
    summaryDiv.innerHTML = `
        <h5>Position Mappings Summary</h5>
        <div class="mappings-grid">
            ${positionMappings.map(mapping => `
                <div class="mapping-item">
                    <span class="doc-ref">"${mapping.documentReference}"</span>
                    <span class="arrow">→</span>  
                    <span class="internal-pos">Position ${mapping.internalPosition}</span>
                    <span class="pos-type">(${mapping.positionType})</span>
                </div>
            `).join('')}
        </div>
        <button onclick="proceedToProcessing()" class="btn-primary">Process Files with AI</button>
    `;
    
    mappingArea.appendChild(summaryDiv);
}

function proceedToProcessing() {
    showStep('processing');
    processFiles();
}

function backToUpload() {
    showStep('upload');
}

async function processFiles() {
    if (uploadedFiles.length === 0) {
        showError('No files selected');
        return;
    }
    
    if (positionMappings.length === 0) {
        showError('No position mappings configured');
        return;
    }
    
    showStep('processing');
    showProcessingStatus();
    logger.info(`Starting processing of ${uploadedFiles.length} files with AI extraction`);
    
    try {
        await updateProgress(10, 'Initializing AI and file processors...');
        
        await updateProgress(20, 'Reading and parsing documents...');
        
        const results = await fileProcessor.processFiles(uploadedFiles, positionMappings);
        
        await updateProgress(70, 'Applying position mappings...');
        
        const mappedResults = applyPositionMappings(results);
        
        await updateProgress(90, 'Preparing results...');
        
        const summary = fileProcessor.getProcessingSummary(mappedResults);
        logger.info('File processing with AI complete', summary);
        
        extractedData = {
            results: mappedResults,
            summary: summary,
            positionMappings: positionMappings,
            processedAt: new Date().toISOString()
        };
        
        await updateProgress(100, 'AI extraction complete!');
        
        setTimeout(() => {
            displayResults(extractedData);
            showStep('results');
        }, 1000);
        
    } catch (error) {
        logger.error('File processing failed', error);
        showError('Processing failed: ' + error.message);
    }
}

function showProcessingStatus() {
    if (progressBar) progressBar.style.width = '0%';
    if (progressStatus) progressStatus.textContent = 'Starting AI extraction...';
}

function updateProgress(percentage, status) {
    return new Promise(resolve => {
        if (progressBar) progressBar.style.width = percentage + '%';
        if (progressStatus) progressStatus.textContent = status;
        
        setTimeout(resolve, 100);
    });
}

function applyPositionMappings(results) {
    return results.map(result => {
        if (result.success && result.aiExtraction?.success) {
            const aiData = result.aiExtraction.data;
            
            if (aiData.component_groups) {
                aiData.component_groups = aiData.component_groups.map(group => {
                    const mapping = positionMappings.find(m => 
                        m.documentReference.toLowerCase() === group.document_reference.toLowerCase()
                    );
                    
                    return {
                        ...group,
                        internal_position: mapping ? mapping.internalPosition : null,
                        position_type: mapping ? mapping.positionType : null,
                        mapping_found: !!mapping
                    };
                });
            }
        }
        
        return result;
    });
}

function displayResults(data) {
    if (!resultsArea) return;
    
    resultsArea.innerHTML = `
        <div class="results-container">
            <div class="results-header">
                <h3>🔍 AI Extraction Results</h3>
                <p>Processed ${data.summary.totalFiles} files with AI component extraction</p>
                <div class="results-stats">
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.successful}</span>
                        <span class="stat-label">Successful</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.aiComponentsFound || 0}</span>
                        <span class="stat-label">Components Found</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${data.positionMappings.length}</span>
                        <span class="stat-label">Positions Mapped</span>
                    </div>
                </div>
            </div>
            
            <div class="results-content">
                ${data.results.map(renderFileResult).join('')}
            </div>
            
            <div class="results-actions">
                <button onclick="exportResults()" class="btn-primary">Export to CSV</button>
                <button onclick="clearAll()" class="btn-secondary">Start Over</button>
            </div>
        </div>
    `;
}

function renderFileResult(result) {
    const { fileName, success, aiExtraction, error } = result;
    const icon = fileName.endsWith('.pdf') ? '📄' : '📊';
    
    if (!success) {
        return `
            <div class="file-result error">
                <div class="file-header">
                    <h5>${icon} ${fileName}</h5>
                    <span class="status error">Failed</span>
                </div>
                <div class="error-message">
                    <p>Error: ${error}</p>
                </div>
            </div>
        `;
    }
    
    if (!aiExtraction || !aiExtraction.success) {
        return `
            <div class="file-result warning">
                <div class="file-header">
                    <h5>${icon} ${fileName}</h5>
                    <span class="status warning">AI Extraction Failed</span>
                </div>
                <div class="warning-message">
                    <p>File processed but AI extraction failed: ${aiExtraction?.error || 'Unknown error'}</p>
                </div>
            </div>
        `;
    }
    
    const aiData = aiExtraction.data;
    const componentGroups = aiData.component_groups || [];
    const totalComponents = componentGroups.reduce((sum, group) => sum + (group.components?.length || 0), 0);
    
    return `
        <div class="file-result success">
            <div class="file-header">
                <h5>${icon} ${fileName}</h5>
                <span class="status success">Success</span>
            </div>
            
            <div class="ai-extraction-results">
                <h6>🤖 AI Extraction Results</h6>
                <div class="ai-summary">
                    <div class="ai-stat">
                        <span class="ai-value">${componentGroups.length}</span>
                        <span class="ai-label">Position Groups</span>
                    </div>
                    <div class="ai-stat">
                        <span class="ai-value">${totalComponents}</span>
                        <span class="ai-label">Components</span>
                    </div>
                </div>
                
                <div class="component-groups">
                    ${componentGroups.map(renderComponentGroup).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderComponentGroup(group) {
    const mappingStatus = group.mapping_found ? 
        `<span class="mapping-found">→ Position ${group.internal_position}</span>` :
        `<span class="mapping-missing">No mapping found</span>`;
    
    const components = group.components || [];
    
    return `
        <div class="component-group">
            <div class="group-header">
                <h6>📍 "${group.document_reference}" ${mappingStatus}</h6>
                <span class="component-count">${components.length} components</span>
            </div>
            
            <div class="components-list">
                ${components.map(renderComponent).join('')}
            </div>
        </div>
    `;
}

function renderComponent(component) {
    const confidenceClass = (component.confidence || 0) >= 0.8 ? 'high' : 
                           (component.confidence || 0) >= 0.6 ? 'medium' : 'low';
    
    const specs = [];
    if (component.specifications?.length_m) specs.push(`${component.specifications.length_m}m`);
    if (component.specifications?.diameter_mm) specs.push(`⌀${component.specifications.diameter_mm}mm`);
    if (component.specifications?.weight_kg) specs.push(`${component.specifications.weight_kg}kg`);
    
    return `
        <div class="component-item">
            <div class="component-main">
                <span class="component-type">${component.type || 'unknown'}</span>
                <span class="component-quantity">×${component.quantity || 1}</span>
                <span class="component-specs">${specs.join(' · ')}</span>
            </div>
            <div class="component-details">
                <div class="component-description">${component.description || 'No description'}</div>
                <div class="component-meta">
                    ${component.manufacturer ? `<span class="manufacturer">by ${component.manufacturer}</span>` : ''}
                    ${component.part_number ? `<span class="part-number">#${component.part_number}</span>` : ''}
                    <span class="confidence ${confidenceClass}">${Math.round((component.confidence || 0) * 100)}%</span>
                </div>
            </div>
        </div>
    `;
}

function exportResults() {
    if (!extractedData) {
        showError('No results to export');
        return;
    }
    
    // Prepare CSV data
    const csvData = [];
    csvData.push(['File', 'Document Reference', 'Internal Position', 'Component Type', 'Description', 'Quantity', 'Length (m)', 'Diameter (mm)', 'Weight (kg)', 'Manufacturer', 'Part Number', 'Confidence']);
    
    extractedData.results.forEach(result => {
        if (result.success && result.aiExtraction?.success) {
            const aiData = result.aiExtraction.data;
            const fileName = result.fileName;
            
            aiData.component_groups?.forEach(group => {
                (group.components || []).forEach(component => {
                    csvData.push([
                        fileName,
                        group.document_reference,
                        group.internal_position || 'Not Mapped',
                        component.type,
                        component.description,
                        component.quantity,
                        component.specifications?.length_m || '',
                        component.specifications?.diameter_mm || '',
                        component.specifications?.weight_kg || '',
                        component.manufacturer || '',
                        component.part_number || '',
                        Math.round((component.confidence || 0) * 100) + '%'
                    ]);
                });
            });
        }
    });
    
    // Create and download CSV
    const csvContent = csvData.map(row => 
        row.map(field => `"${field}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `aquaculture_extraction_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('Results exported to CSV', 'success');
}

function clearAll() {
    uploadedFiles = [];
    positionMappings = [];
    extractedData = null;
    window.currentPositions = null;
    
    // Reset UI
    if (selectedFiles) selectedFiles.innerHTML = '';
    if (fileList) fileList.style.display = 'none';
    if (uploadDropZone) uploadDropZone.style.display = 'block';
    if (resultsArea) resultsArea.innerHTML = '';
    
    updateProcessButton();
    showStep('upload');
    
    showNotification('All data cleared', 'info');
    logger.info('Application state reset');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

function showError(message) {
    showNotification(message, 'error');
    logger.error('User error', message);
}

// Export functions for global access
window.generatePositions = generatePositions;
window.updateMappingReference = updateMappingReference;
window.addCustomMapping = addCustomMapping;
window.saveMappings = saveMappings;
window.backToUpload = backToUpload;
window.proceedToProcessing = proceedToProcessing;
window.exportResults = exportResults;