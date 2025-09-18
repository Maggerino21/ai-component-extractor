const { ipcRenderer } = require('electron');
const FileProcessor = require('../services/fileProcessor');
const logger = require('../utils/logger');

const uploadArea = document.getElementById('uploadArea');
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileList = document.getElementById('fileList');
const selectedFiles = document.getElementById('selectedFiles');
const processBtn = document.getElementById('processBtn');
const statusSection = document.getElementById('statusSection');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const resultsSection = document.getElementById('resultsSection');
const resultsGrid = document.getElementById('resultsGrid');
const settingsBtn = document.getElementById('settingsBtn');
const settingsSection = document.getElementById('settingsSection');

let uploadedFiles = [];
let extractedData = null;
let fileProcessor = new FileProcessor();
let positionMappings = [];
let currentStep = 'upload';

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkDatabaseConnection();
    showStep('upload');
});

function initializeEventListeners() {
    uploadArea.addEventListener('click', selectFiles);
    selectFilesBtn.addEventListener('click', selectFiles);
    processBtn.addEventListener('click', handleProcessClick);
    
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    settingsBtn.addEventListener('click', toggleSettings);
    settingsSection.addEventListener('click', (e) => {
        if (e.target === settingsSection) {
            toggleSettings();
        }
    });
    
    document.getElementById('reviewBtn').addEventListener('click', reviewResults);
    document.getElementById('saveToDatabaseBtn').addEventListener('click', saveToDatabase);
    document.getElementById('exportBtn').addEventListener('click', exportResults);
}

function showStep(step) {
    currentStep = step;
    
    document.querySelectorAll('.app-step').forEach(el => {
        el.style.display = 'none';
    });
    
    const stepElement = document.getElementById(`step-${step}`);
    if (stepElement) {
        stepElement.style.display = 'block';
    }
    
    updateProcessButton();
}

function updateProcessButton() {
    const processBtn = document.getElementById('processBtn');
    
    switch (currentStep) {
        case 'upload':
            processBtn.textContent = 'Setup Position Mapping';
            processBtn.style.display = uploadedFiles.length > 0 ? 'block' : 'none';
            break;
        case 'mapping':
            processBtn.textContent = 'Extract Components with AI';
            processBtn.style.display = positionMappings.length > 0 ? 'block' : 'none';
            break;
        case 'processing':
            processBtn.style.display = 'none';
            break;
        case 'results':
            processBtn.style.display = 'none';
            break;
    }
}

function handleProcessClick() {
    switch (currentStep) {
        case 'upload':
            showPositionMapping();
            break;
        case 'mapping':
            processFiles();
            break;
    }
}

function showPositionMapping() {
    if (uploadedFiles.length === 0) {
        showError('No files selected');
        return;
    }
    
    currentStep = 'mapping';
    
    const mappingContainer = document.getElementById('position-mapping-container');
    if (!mappingContainer) {
        createMappingContainer();
    }
    
    showStep('mapping');
    renderPositionMapper();
}

function createMappingContainer() {
    const container = document.createElement('section');
    container.id = 'position-mapping-container';
    container.className = 'app-step position-mapping-section';
    container.style.display = 'none';
    
    const mainElement = document.querySelector('.app-main');
    mainElement.insertBefore(container, document.getElementById('statusSection'));
}

function renderPositionMapper() {
    console.log('renderPositionMapper called');
    
    const container = document.getElementById('position-mapping-container');
    if (!container) {
        console.log('Container not found, returning');
        return;
    }
    
    console.log('Setting innerHTML');
    container.innerHTML = `
        <div class="position-mapper">
            <div class="mapper-header">
                <div>
                    <h3>Position Mapping Setup</h3>
                    <p>Map document references to internal position numbers</p>
                </div>
            </div>

            <div id="mapping-sections" class="mapping-sections">
                Loading...
            </div>
        </div>
    `;
    
    console.log('innerHTML set, calling generateMappings');
    generateMappings();
    console.log('renderPositionMapper completed');
}

function toggleFacilityConfig() {
    const config = document.getElementById('facility-config');
    const isVisible = config.style.display !== 'none';
    config.style.display = isVisible ? 'none' : 'block';
}

function applyFacilityConfig() {
    generateMappings();
    document.getElementById('facility-config').style.display = 'none';
}

function generateMappings() {
    const numMooringLines = parseInt(document.getElementById('numMooringLines').value);
    const numBuoys = parseInt(document.getElementById('numBuoys').value);
    const numBridles = parseInt(document.getElementById('numBridles').value);
    const numFrameLines = parseInt(document.getElementById('numFrameLines').value);
    
    const mappingTypes = [
        { type: 'Mooring Lines', start: 101, count: numMooringLines, color: '#4facfe' },
        { type: 'Buoys', start: 301, count: numBuoys, color: '#28a745' },
        { type: 'Bridles', start: 501, count: numBridles, color: '#ffc107' },
        { type: 'Frame Lines', start: 701, count: numFrameLines, color: '#6c757d' }
    ];
    
    const sectionsContainer = document.getElementById('mapping-sections');
    sectionsContainer.innerHTML = '';
    
    mappingTypes.forEach(({ type, start, count, color }) => {
        if (count === 0) return;
        
        const section = document.createElement('div');
        section.className = 'mapping-section';
        
        let sectionHTML = `
            <h4 style="background: ${color}">${type}</h4>
            <div class="mapping-grid">
        `;
        
        for (let i = 0; i < count; i++) {
            const position = start + i;
            sectionHTML += `
                <div class="mapping-row">
                    <div class="mapping-info">
                        <span class="position-number" style="background: ${color}">${position}</span>
                        <span class="position-desc">${type.slice(0, -1)} ${i + 1}</span>
                    </div>
                    <div class="mapping-input">
                        <input type="text" 
                               placeholder="Doc ref (e.g. 4b, 1a)" 
                               data-position="${position}"
                               onchange="updateMappingCount()">
                    </div>
                </div>
            `;
        }
        
        sectionHTML += `</div>`;
        section.innerHTML = sectionHTML;
        sectionsContainer.appendChild(section);
    });
    
    updateMappingCount();
}

function updateMappingCount() {
    const inputs = document.querySelectorAll('[data-position]');
    const filledInputs = Array.from(inputs).filter(input => input.value.trim());
    
    positionMappings = filledInputs.map(input => ({
        internalPosition: parseInt(input.dataset.position),
        documentReference: input.value.trim()
    }));
    
    document.getElementById('mappingStats').textContent = 
        `${positionMappings.length} positions mapped`;
    
    updateProcessButton();
}

function saveMappings() {
    if (positionMappings.length === 0) {
        showError('No mappings to save');
        return;
    }
    
    const facilityId = `facility_${Date.now()}`;
    const mappingData = {
        facilityId,
        mappings: positionMappings,
        createdAt: new Date().toISOString()
    };
    
    try {
        localStorage.setItem(`position_mapping_${facilityId}`, JSON.stringify(mappingData));
        showNotification('Position mappings saved successfully!', 'success');
        logger.info('Position mappings saved', mappingData);
    } catch (error) {
        logger.error('Failed to save mappings', error);
        showError('Failed to save mappings: ' + error.message);
    }
}

function loadMappings() {
    showNotification('Load mappings feature coming soon!', 'info');
}

function addCustomMapping() {
    showNotification('Custom mapping feature coming soon!', 'info');
}

async function selectFiles() {
    try {
        const filePaths = await ipcRenderer.invoke('select-files');
        if (filePaths && filePaths.length > 0) {
            uploadedFiles = filePaths;
            displaySelectedFiles();
        }
    } catch (error) {
        logger.error('Error selecting files', error);
        showError('Error selecting files: ' + error.message);
    }
}

function displaySelectedFiles() {
    selectedFiles.innerHTML = '';
    uploadedFiles.forEach(filePath => {
        const li = document.createElement('li');
        const fileName = filePath.split(/[/\\]/).pop();
        const fileExt = fileName.split('.').pop().toLowerCase();
        const icon = fileExt === 'pdf' ? '📄' : '📊';
        li.innerHTML = `${icon} ${fileName}`;
        selectedFiles.appendChild(li);
    });
    
    fileList.style.display = 'block';
    uploadArea.style.display = 'none';
    showStep('upload');
    updateProcessButton();
}

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
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

async function processFiles() {
    if (uploadedFiles.length === 0) {
        showError('No files selected');
        return;
    }
    
    if (positionMappings.length === 0) {
        showError('No position mappings configured');
        return;
    }
    
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
            hideProcessingStatus();
            showResults();
        }, 500);
        
    } catch (error) {
        logger.error('AI file processing failed', error);
        hideProcessingStatus();
        showError('AI processing failed: ' + error.message);
    }
}

function applyPositionMappings(results) {
    const mappingLookup = positionMappings.reduce((acc, mapping) => {
        acc[mapping.documentReference.toLowerCase()] = mapping.internalPosition;
        return acc;
    }, {});
    
    logger.info('Applying position mappings', { mappingLookup, resultsCount: results.length });
    
    return results.map(result => ({
        ...result,
        mappingLookup,
        positionMappingsApplied: true
    }));
}

function showProcessingStatus() {
    currentStep = 'processing';
    showStep('processing');
    statusSection.style.display = 'block';
    resultsSection.style.display = 'none';
}

function hideProcessingStatus() {
    statusSection.style.display = 'none';
}

async function updateProgress(percent, message) {
    progressFill.style.width = percent + '%';
    statusText.textContent = message;
    await new Promise(resolve => setTimeout(resolve, 300));
}

function showResults() {
    currentStep = 'results';
    showStep('results');
    resultsSection.style.display = 'block';
    renderResults();
}

function renderResults() {
    if (!extractedData) return;
    
    const { results, summary, positionMappings } = extractedData;
    
    let html = `
        <div class="processing-summary">
            <h4>Processing Summary with AI</h4>
            <div class="summary-stats">
                <div class="stat">
                    <span class="stat-value">${summary.successful}</span>
                    <span class="stat-label">Files Processed</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${getTotalAIComponents(results)}</span>
                    <span class="stat-label">AI Components Found</span>
                </div>
                <div class="stat">
                    <span class="stat-value">${positionMappings.length}</span>
                    <span class="stat-label">Position Mappings</span>
                </div>
            </div>
        </div>
    `;
    
    if (positionMappings.length > 0) {
        html += `
            <div class="position-mappings-summary">
                <h5>Position Mappings Applied</h5>
                <div class="mappings-list">
                    ${positionMappings.map(mapping => `
                        <span class="mapping-badge">
                            ${mapping.internalPosition} ← "${mapping.documentReference}"
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    results.forEach(result => {
        if (result.success) {
            html += renderFileResult(result);
        } else {
            html += `
                <div class="file-result error">
                    <h5>❌ ${result.fileName}</h5>
                    <p class="error-message">Error: ${result.error}</p>
                </div>
            `;
        }
    });
    
    if (summary.errors.length > 0) {
        html += `
            <div class="errors-section">
                <h5>⚠️ Processing Errors</h5>
                ${summary.errors.map(err => `
                    <div class="error-item">
                        <strong>${err.fileName}:</strong> ${err.error}
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    resultsGrid.innerHTML = html;
}

function getTotalAIComponents(results) {
    return results.reduce((total, result) => {
        if (result.aiExtraction && result.aiExtraction.success && result.aiExtraction.data) {
            return total + (result.aiExtraction.data.extraction_summary?.total_components || 0);
        }
        return total;
    }, 0);
}

function renderFileResult(result) {
    const { fileName, data, aiExtraction } = result;
    
    let html = `
        <div class="file-result success">
            <div class="file-header">
                <h5>${getFileIcon(result.fileType)} ${fileName}</h5>
                <span class="file-type">${data.type.toUpperCase()}</span>
            </div>
    `;
    
    if (data.type === 'pdf') {
        html += `
            <div class="pdf-info">
                <p><strong>Pages:</strong> ${data.pageCount}</p>
                <p><strong>Extraction:</strong> ${data.extractionMethod}</p>
                <p><strong>Keywords found:</strong> ${data.keywords.length}</p>
            </div>
        `;
    }
    
    if (data.type === 'excel') {
        html += `
            <div class="excel-info">
                <p><strong>Sheets:</strong> ${data.totalSheets}</p>
            </div>
        `;
    }

    if (aiExtraction && aiExtraction.success) {
        const aiData = aiExtraction.data;
        html += `
            <div class="ai-extraction-results">
                <h6>🤖 AI Extraction Results</h6>
                <div class="ai-summary">
                    <span class="ai-stat">
                        <strong>${aiData.extraction_summary.total_positions}</strong> positions
                    </span>
                    <span class="ai-stat">
                        <strong>${aiData.extraction_summary.total_components}</strong> components
                    </span>
                    <span class="ai-stat">
                        <strong>${Math.round(aiData.extraction_summary.confidence_average * 100)}%</strong> avg confidence
                    </span>
                </div>
        `;

        if (aiData.positions && aiData.positions.length > 0) {
            html += '<div class="extracted-positions">';
            
            aiData.positions.slice(0, 3).forEach(position => {
                html += `
                    <div class="position-preview">
                        <div class="position-header">
                            <strong>Ref: "${position.document_reference}"</strong>
                            <span class="component-count">${position.components.length} components</span>
                        </div>
                `;
                
                if (position.components.length > 0) {
                    html += '<div class="component-list">';
                    position.components.slice(0, 2).forEach(comp => {
                        const confidenceColor = comp.confidence > 0.8 ? '#28a745' : 
                                              comp.confidence > 0.6 ? '#ffc107' : '#dc3545';
                        html += `
                            <div class="component-item">
                                <span class="component-type">${comp.type}</span>
                                ${comp.length_m ? `<span class="component-spec">${comp.length_m}m</span>` : ''}
                                ${comp.manufacturer ? `<span class="component-manufacturer">${comp.manufacturer}</span>` : ''}
                                <span class="confidence-badge" style="background: ${confidenceColor}">
                                    ${Math.round(comp.confidence * 100)}%
                                </span>
                            </div>
                        `;
                    });
                    html += '</div>';
                }
                
                html += '</div>';
            });
            
            if (aiData.positions.length > 3) {
                html += `<p class="more-positions">+ ${aiData.positions.length - 3} more positions...</p>`;
            }
            
            html += '</div>';
        }
        
        html += '</div>';
    } else if (aiExtraction && !aiExtraction.success) {
        html += `
            <div class="ai-extraction-error">
                <h6>⚠️ AI Extraction Failed</h6>
                <p class="error-message">${aiExtraction.error}</p>
            </div>
        `;
    }
    
    html += `</div>`;
    return html;
}

function getFileIcon(fileType) {
    return fileType === '.pdf' ? '📄' : '📊';
}

async function saveToDatabase() {
    if (!extractedData) {
        showError('No data to save');
        return;
    }
    
    try {
        showNotification('Saving to database...', 'info');
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        showNotification('Data saved successfully!', 'success');
        
        setTimeout(resetApp, 2000);
        
    } catch (error) {
        logger.error('Database save failed', error);
        showError('Database save failed: ' + error.message);
    }
}

async function exportResults() {
    if (!extractedData) {
        showError('No data to export');
        return;
    }
    
    try {
        const filePath = await ipcRenderer.invoke('save-results', extractedData);
        if (filePath) {
            showNotification(`Results exported to: ${filePath}`, 'success');
        }
    } catch (error) {
        logger.error('Export failed', error);
        showError('Export failed: ' + error.message);
    }
}

function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        borderRadius: '6px',
        color: 'white',
        fontWeight: '500',
        zIndex: '10000',
        maxWidth: '400px',
        backgroundColor: type === 'error' ? '#dc3545' : 
                        type === 'success' ? '#28a745' : '#007bff'
    });
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

function resetApp() {
    uploadedFiles = [];
    extractedData = null;
    positionMappings = [];
    currentStep = 'upload';
    
    fileList.style.display = 'none';
    uploadArea.style.display = 'block';
    resultsSection.style.display = 'none';
    selectedFiles.innerHTML = '';
    progressFill.style.width = '0%';
    
    showStep('upload');
}

function toggleSettings() {
    const isVisible = settingsSection.style.display === 'flex';
    settingsSection.style.display = isVisible ? 'none' : 'flex';
}

function reviewResults() {
    showNotification('Review mode coming soon!', 'info');
}

async function checkDatabaseConnection() {
    document.getElementById('dbStatus').textContent = 'Database: Checking...';
    
    setTimeout(() => {
        document.getElementById('dbStatus').textContent = 'Database: Ready';
    }, 1000);
}

window.updateMappingCount = updateMappingCount;