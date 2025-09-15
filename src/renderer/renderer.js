const { ipcRenderer } = require('electron');

// DOM elements
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

// Global state
let uploadedFiles = [];
let extractedData = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    checkDatabaseConnection();
});

function initializeEventListeners() {
    // File upload handlers
    uploadArea.addEventListener('click', selectFiles);
    selectFilesBtn.addEventListener('click', selectFiles);
    processBtn.addEventListener('click', processFiles);
    
    // Drag and drop handlers
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    // Settings handlers
    settingsBtn.addEventListener('click', toggleSettings);
    settingsSection.addEventListener('click', (e) => {
        if (e.target === settingsSection) {
            toggleSettings();
        }
    });
    
    // Results handlers
    document.getElementById('reviewBtn').addEventListener('click', reviewResults);
    document.getElementById('saveToDatabaseBtn').addEventListener('click', saveToDatabase);
    document.getElementById('exportBtn').addEventListener('click', exportResults);
}

// File selection and handling
async function selectFiles() {
    try {
        const filePaths = await ipcRenderer.invoke('select-files');
        if (filePaths && filePaths.length > 0) {
            uploadedFiles = filePaths;
            displaySelectedFiles();
        }
    } catch (error) {
        showError('Error selecting files: ' + error.message);
    }
}

function displaySelectedFiles() {
    selectedFiles.innerHTML = '';
    uploadedFiles.forEach(filePath => {
        const li = document.createElement('li');
        const fileName = filePath.split(/[/\\]/).pop();
        li.textContent = fileName;
        selectedFiles.appendChild(li);
    });
    
    fileList.style.display = 'block';
    uploadArea.style.display = 'none';
}

// Drag and drop functionality
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
        const ext = file.name.toLowerCase().split('.').pop();
        return ['pdf', 'xlsx', 'xls'].includes(ext);
    });
    
    if (validFiles.length > 0) {
        uploadedFiles = validFiles.map(file => file.path);
        displaySelectedFiles();
    } else {
        showError('Please drop only PDF or Excel files.');
    }
}

// File processing
async function processFiles() {
    if (uploadedFiles.length === 0) {
        showError('No files selected');
        return;
    }
    
    showProcessingStatus();
    
    try {
        // Simulate processing steps
        await updateProgress(20, 'Reading documents...');
        
        // Here you would call your AI extraction service
        await simulateAIExtraction();
        
        await updateProgress(80, 'Structuring data...');
        
        // Simulate data structuring
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await updateProgress(100, 'Extraction complete!');
        
        // Show results
        setTimeout(() => {
            hideProcessingStatus();
            showResults();
        }, 500);
        
    } catch (error) {
        hideProcessingStatus();
        showError('Processing failed: ' + error.message);
    }
}

async function simulateAIExtraction() {
    // This is where you'd call your actual AI service
    // For now, we'll simulate with dummy data
    extractedData = {
        facility_id: "F001",
        mooring_lines: [
            {
                line_id: "1a",
                components: [
                    {
                        type: "rope",
                        length_m: 50,
                        manufacturer: "Scale AQ",
                        tracking_number: "R123",
                        confidence: 0.95
                    },
                    {
                        type: "chain",
                        length_m: 20,
                        manufacturer: "Mørenot",
                        tracking_number: "C456",
                        confidence: 0.88
                    }
                ]
            },
            {
                line_id: "2a",
                components: [
                    {
                        type: "shackle",
                        weight_limit_kg: 500,
                        manufacturer: "Mørenot",
                        tracking_number: "S789",
                        confidence: 0.92
                    }
                ]
            }
        ]
    };
    
    await new Promise(resolve => setTimeout(resolve, 2000));
}

// UI Status Management
function showProcessingStatus() {
    statusSection.style.display = 'block';
    resultsSection.style.display = 'none';
    fileList.style.display = 'none';
}

function hideProcessingStatus() {
    statusSection.style.display = 'none';
}

async function updateProgress(percent, message) {
    progressFill.style.width = percent + '%';
    statusText.textContent = message;
    await new Promise(resolve => setTimeout(resolve, 500));
}

function showResults() {
    resultsSection.style.display = 'block';
    renderResults();
}

function renderResults() {
    if (!extractedData) return;
    
    let html = `
        <div class="facility-info">
            <h4>Facility: ${extractedData.facility_id}</h4>
            <p>Found ${extractedData.mooring_lines.length} mooring lines</p>
        </div>
    `;
    
    extractedData.mooring_lines.forEach(line => {
        html += `
            <div class="mooring-line">
                <h5>Mooring Line: ${line.line_id}</h5>
                <div class="components-grid">
        `;
        
        line.components.forEach(component => {
            const confidenceClass = component.confidence > 0.9 ? 'high' : 
                                   component.confidence > 0.8 ? 'medium' : 'low';
            
            html += `
                <div class="component-card ${confidenceClass}">
                    <div class="component-header">
                        <span class="component-type">${component.type}</span>
                        <span class="confidence">Confidence: ${(component.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div class="component-details">
                        <p><strong>Manufacturer:</strong> ${component.manufacturer}</p>
                        <p><strong>Tracking:</strong> ${component.tracking_number}</p>
                        ${component.length_m ? `<p><strong>Length:</strong> ${component.length_m}m</p>` : ''}
                        ${component.weight_limit_kg ? `<p><strong>Weight Limit:</strong> ${component.weight_limit_kg}kg</p>` : ''}
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    resultsGrid.innerHTML = html;
}

// Database operations
async function saveToDatabase() {
    if (!extractedData) {
        showError('No data to save');
        return;
    }
    
    try {
        showNotification('Saving to database...', 'info');
        
        // Here you would call your database service
        // await dbService.saveComponents(extractedData);
        
        // Simulate save operation
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        showNotification('Data saved successfully! ✅', 'success');
        
        // Reset for new processing
        setTimeout(resetApp, 2000);
        
    } catch (error) {
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
            // Here you would actually save the file
            showNotification(`Results exported to: ${filePath}`, 'success');
        }
    } catch (error) {
        showError('Export failed: ' + error.message);
    }
}

// Utility functions
function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

function resetApp() {
    uploadedFiles = [];
    extractedData = null;
    fileList.style.display = 'none';
    uploadArea.style.display = 'block';
    resultsSection.style.display = 'none';
    selectedFiles.innerHTML = '';
    progressFill.style.width = '0%';
}

function toggleSettings() {
    const isVisible = settingsSection.style.display === 'flex';
    settingsSection.style.display = isVisible ? 'none' : 'flex';
}

function reviewResults() {
    showNotification('Review mode coming soon!', 'info');
}

async function checkDatabaseConnection() {
    // Placeholder for database connection check
    document.getElementById('dbStatus').textContent = 'Database: Checking...';
    
    // Simulate connection check
    setTimeout(() => {
        document.getElementById('dbStatus').textContent = 'Database: Ready';
    }, 1000);
}