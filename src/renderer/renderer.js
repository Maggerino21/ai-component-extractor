const { ipcRenderer } = require('electron');
const IntegratedFileProcessor = require('../services/integratedFileProcessor');
const logger = require('../utils/logger');

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

const fileProcessor = new IntegratedFileProcessor();

let uploadedFiles = [];
let positionMappings = [];
let extractedData = null;
let currentLocality = null;
let currentMooring = null;
let currentPositions = [];
let selectedSupplier = null;
let allSuppliers = [];
let allProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        initializeEventListeners();
        await initializeApp();
        showStep('upload');
        logger.info('✅ AI Component Extractor initialized');
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        showError('Failed to initialize application: ' + error.message);
    }
});

async function initializeApp() {
    try {
        showNotification('Connecting to database...', 'info');
        await fileProcessor.initialize();
        
        const rawSuppliers = await fileProcessor.getSuppliers();
        allProducts = await fileProcessor.getProductCatalog();
        
        logger.info(`DEBUG: Loaded ${rawSuppliers.length} total suppliers from database`);
        
        const productCountBySupplier = {};
        allProducts.forEach(p => {
            if (!productCountBySupplier[p.supplierId]) {
                productCountBySupplier[p.supplierId] = 0;
            }
            productCountBySupplier[p.supplierId]++;
        });
        
        // Filter to only ArtiklerLeverandors (product catalog suppliers)
        allSuppliers = rawSuppliers
            .filter(s => s.RefEntityName === 'ArtiklerLeverandors')
            .map(s => ({
                ...s,
                productCount: productCountBySupplier[s.Id] || 0
            }))
            .filter(s => s.productCount > 0)
            .sort((a, b) => b.productCount - a.productCount);
        
        logger.info(`Filtered to ${allSuppliers.length} product catalog suppliers (ArtiklerLeverandors with products)`);
        logger.info(`Top suppliers: ${allSuppliers.slice(0, 5).map(s => `${s.Name} (${s.productCount})`).join(', ')}`);
        
        showNotification('✅ Connected to database', 'success');
    } catch (error) {
        showError('Failed to connect to database: ' + error.message);
        throw error;
    }
}

function initializeEventListeners() {
    if (selectFilesBtn) {
        selectFilesBtn.addEventListener('click', selectFiles);
    }
    if (uploadDropZone) {
        uploadDropZone.addEventListener('click', selectFiles);
        uploadDropZone.addEventListener('dragover', handleDragOver);
        uploadDropZone.addEventListener('dragleave', handleDragLeave);
        uploadDropZone.addEventListener('drop', handleDrop);
    }
    
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
        'locality': document.getElementById('localityArea'),
        'mapping': document.getElementById('mappingArea'),
        'supplier': document.getElementById('supplierArea'),
        'processing': processingArea,
        'results': resultsArea
    };
    
    Object.values(areas).forEach(area => {
        if (area) area.style.display = 'none';
    });
    
    if (areas[step]) {
        areas[step].style.display = 'block';
    }
    
    updateStepIndicators(step);
}

function updateStepIndicators(currentStep) {
    const indicators = document.querySelectorAll('.step-indicator');
    const stepOrder = ['upload', 'locality', 'mapping', 'supplier', 'processing', 'results'];
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

async function setupPositionMapping() {
    if (uploadedFiles.length === 0) {
        showError('Please select files first');
        return;
    }
    
    showStep('locality');
    await loadLocalitySelector();
}

async function loadLocalitySelector() {
    console.log('Loading localities for selection...');
    try {
        console.log('🔍 Step 2: Fetching localities from database');

        const localities = await fileProcessor.getLocalities();

        console.log(`🔍 Step 3: Got ${localities.length} localities`);
        
        console.log('🔍 Step 4: Sorting localities');
        localities.sort((a, b) => a.Name.localeCompare(b.Name));
        console.log('🔍 Step 5: Creating HTML');
        const localityArea = document.getElementById('localityArea') || document.createElement('div');
        localityArea.id = 'localityArea';
        localityArea.className = 'content-area';
        console.log('🔍 Step 7: Appending to DOM');
        localityArea.innerHTML = `
            <div class="locality-selector">
                <h3>🏢 Select Facility (Locality)</h3>
                <p>Choose the facility you want to add components to</p>
                
                <div class="locality-search">
                    <input 
                        type="text" 
                        id="localitySearchInput" 
                        placeholder="🔍 Search facilities by name or location number..." 
                        oninput="filterLocalities()"
                        autofocus
                    />
                    <span id="localityCount" class="search-count">Type to search ${localities.length} facilities</span>
                </div>
                
                <div class="locality-list" id="localityList">
                    <p style="text-align: center; color: #666; padding: 2rem;">
                        👆 Start typing to search facilities
                    </p>
                </div>
                
                <button onclick="backToUpload()" class="btn-secondary">⬅️ Back to Files</button>
            </div>
        `;
        console.log('✅ Step 8: Complete!');
        if (!document.getElementById('localityArea')) {
            uploadArea.parentNode.insertBefore(localityArea, uploadArea.nextSibling);
        }
        
        const existingArea = document.getElementById('localityArea');
        if (existingArea) {
            existingArea.style.display = 'block';
        }
        
        window.allLocalities = localities;
        
        setTimeout(() => {
            const searchInput = document.getElementById('localitySearchInput');
            if (searchInput) searchInput.focus();
        }, 100);
        
    } catch (error) {
        showError('Failed to load localities: ' + error.message);
    }
}

function filterLocalities() {
    const searchInput = document.getElementById('localitySearchInput');
    const searchTerm = searchInput.value.toLowerCase().trim();
    const localityList = document.getElementById('localityList');
    const countSpan = document.getElementById('localityCount');
    
    if (searchTerm.length < 2) {
        localityList.innerHTML = `
            <p style="text-align: center; color: #666; padding: 2rem;">
                👆 Type at least 2 characters to search
            </p>
        `;
        countSpan.textContent = `Type to search ${window.allLocalities.length} facilities`;
        return;
    }
    
    const filtered = window.allLocalities.filter(loc => {
        const name = (loc.Name || '').toLowerCase();
        const locationNr = (loc.LocationNr || '').toString().toLowerCase();
        return name.includes(searchTerm) || locationNr.includes(searchTerm);
    });
    
    const limited = filtered.slice(0, 50);
    const hasMore = filtered.length > 50;
    
    if (limited.length === 0) {
        localityList.innerHTML = `
            <p style="text-align: center; color: #999; padding: 2rem;">
                No facilities found matching "${searchTerm}"
            </p>
        `;
        countSpan.textContent = `No results`;
        return;
    }
    
    localityList.innerHTML = limited.map(loc => `
        <div class="locality-card" onclick="selectLocality(${loc.Id}, '${loc.Name.replace(/'/g, "\\'")}')">
            <h4>${loc.Name}</h4>
            <p>Location #: ${loc.LocationNr}</p>
            ${loc.Latitude ? `<p>Coordinates: ${loc.Latitude}, ${loc.Longitude}</p>` : ''}
        </div>
    `).join('');
    
    const countText = hasMore 
        ? `Showing first 50 of ${filtered.length} results (${window.allLocalities.length} total)`
        : `Showing ${limited.length} of ${window.allLocalities.length} facilities`;
    
    countSpan.textContent = countText;
    
    if (limited.length === 1) {
        localityList.querySelector('.locality-card').classList.add('highlighted');
    }
}

async function selectLocality(localityId, localityName) {
    try {
        showNotification(`Loading mooring system for ${localityName}...`, 'info');
        
        const selectedLocalityData = window.allLocalities.find(loc => loc.Id === localityId);
        
        currentLocality = { 
            id: localityId, 
            name: localityName,
            customerId: selectedLocalityData?.CustomerId || null
        };
        
        logger.info(`Selected locality ${localityName}, Customer ID: ${currentLocality.customerId}`);
        
        const mooring = await fileProcessor.getMooring(localityId);
        
        if (!mooring) {
            showError(`No active mooring found for ${localityName}`);
            return;
        }
        
        currentMooring = mooring;
        const allPositions = await fileProcessor.getPositions(mooring.Id);
        
        const filteredPositions = allPositions.filter(pos => {
            const name = (pos.Name || '').toString().trim();
            
            if (!/^\d{3}$/.test(name)) {
                return false;
            }
            
            const firstDigit = name[0];
            return ['1', '3', '5', '7'].includes(firstDigit);
        });
        
        currentPositions = filteredPositions;
        
        logger.info(`Filtered positions: ${allPositions.length} total → ${filteredPositions.length} relevant (101-199, 301-399, 501-599, 701-799)`);
        
        showNotification(`✅ Loaded ${filteredPositions.length} relevant positions`, 'success');
        
        initializePositionMapper(filteredPositions);
        showStep('mapping');
        
    } catch (error) {
        showError('Failed to load mooring system: ' + error.message);
    }
}

function initializePositionMapper(positions) {
    const mappingArea = document.getElementById('mappingArea');
    if (!mappingArea) return;
    
    mappingArea.innerHTML = `
        <div class="position-mapper">
            <div class="mapper-header">
                <h3>🗺️ Map Document References to Positions</h3>
                <p>Facility: <strong>${currentLocality.name}</strong> | Mooring: <strong>${currentMooring.Name}</strong></p>
                <p>Map the position references from your documents (H01A, K01, etc.) to internal positions</p>
            </div>
            
            <div class="position-mappings">
                <h4>📍 Available Positions (${positions.length})</h4>
                <div id="mappingsList" class="mappings-list">
                    ${positions.map(pos => `
                        <div class="mapping-row">
                            <div class="position-info">
                                <span class="position-number">${pos.Name || pos.Id}</span>
                                <span class="position-type">${pos.Type || 'Unknown'}</span>
                                <span class="position-id-small">(ID: ${pos.Id})</span>
                            </div>
                            <div class="document-reference">
                                <input 
                                    type="text" 
                                    placeholder="Doc ref (e.g. H01A, K01)"
                                    value="${pos.Reference || ''}"
                                    oninput="updatePositionMapping(${pos.Id}, this.value)"
                                />
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="mapping-actions">
                <button onclick="savePositionMappings()" class="btn-primary">💾 Save Mappings & Continue</button>
                <button onclick="backToLocality()" class="btn-secondary">⬅️ Back to Locality Selection</button>
            </div>
        </div>
    `;
}

function updatePositionMapping(positionId, reference) {
    const position = currentPositions.find(p => p.Id === positionId);
    if (position) {
        position.Reference = reference.trim();
    }
}

async function savePositionMappings() {
    positionMappings = currentPositions
        .filter(pos => pos.Reference && pos.Reference.trim())
        .map(pos => ({
            documentReference: pos.Reference.trim(),
            internalPosition: pos.Name,
            positionId: pos.Id,
            positionName: pos.Name,
            positionType: pos.Type
        }));
    
    if (positionMappings.length === 0) {
        showError('Please add document references to at least one position');
        return;
    }
    
    showNotification(`✅ Mapped ${positionMappings.length} positions`, 'success');
    
    showSupplierSelector();
}

function showSupplierSelector() {
    showStep('supplier');
    
    const facilityNameEl = document.getElementById('supplierFacilityName');
    if (facilityNameEl) {
        facilityNameEl.textContent = currentLocality.name;
    }
    
    logger.info(`Showing ${allSuppliers.length} product catalog suppliers`);
    
    window.filteredSuppliers = allSuppliers;
    
    setTimeout(() => {
        const searchInput = document.getElementById('supplierSearchInput');
        if (searchInput) searchInput.focus();
    }, 100);
}

function searchSuppliers(searchTerm) {
    const dropdown = document.getElementById('supplierDropdown');
    
    const suppliersToSearch = window.filteredSuppliers || allSuppliers;
    
    if (searchTerm.length < 3) {
        dropdown.innerHTML = `<div class="dropdown-hint">Type at least 3 characters... (${suppliersToSearch.length} suppliers available)</div>`;
        dropdown.style.display = 'block';
        return;
    }
    
    const term = searchTerm.toLowerCase();
    const filtered = suppliersToSearch.filter(s => 
        s.Name.toLowerCase().includes(term)
    ).slice(0, 5);
    
    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="dropdown-hint">No suppliers found</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    dropdown.innerHTML = filtered.map(s => `
        <div class="dropdown-item" onclick="selectSupplier(${s.Id}, '${s.Name.replace(/'/g, "\\'")}')">
            <strong>${s.Name}</strong>
            <span class="product-count">${s.productCount} products</span>
            ${s.OrganizationNumber ? `<span class="org-number">Org: ${s.OrganizationNumber}</span>` : ''}
        </div>
    `).join('');
    dropdown.style.display = 'block';
}

function selectSupplier(supplierId, supplierName) {
    selectedSupplier = { id: supplierId, name: supplierName };
    
    const searchInput = document.getElementById('supplierSearchInput');
    const dropdown = document.getElementById('supplierDropdown');
    const display = document.getElementById('selectedSupplierDisplay');
    const nameEl = document.getElementById('selectedSupplierName');
    const detailsEl = document.getElementById('selectedSupplierDetails');
    const proceedBtn = document.getElementById('proceedToProcessingBtn');
    
    if (searchInput) searchInput.value = supplierName;
    if (dropdown) dropdown.style.display = 'none';
    if (display) display.style.display = 'block';
    if (nameEl) nameEl.textContent = supplierName;
    if (detailsEl) detailsEl.textContent = `Supplier ID: ${supplierId}`;
    if (proceedBtn) proceedBtn.disabled = false;
    
    showNotification(`✅ Selected supplier: ${supplierName}`, 'success');
}

function backToUpload() {
    showStep('upload');
}

function backToLocality() {
    showStep('locality');
}

function backToMapping() {
    showStep('mapping');
}

function skipSupplierSelection() {
    selectedSupplier = null;
    showNotification('Using full catalog (all suppliers)', 'info');
    showStep('processing');
    processFiles();
}

async function proceedToProcessing() {
    if (!selectedSupplier) {
        showError('Please select a supplier first');
        return;
    }
    
    showStep('processing');
    processFiles();
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
    
    const supplierInfo = selectedSupplier 
        ? `with preferred supplier: ${selectedSupplier.name}` 
        : 'with full catalog (all suppliers)';
    
    logger.info(`🚀 Starting catalog-aware processing ${supplierInfo}`);
    
    try {
        await updateProgress(10, 'Initializing catalog-aware AI extraction...');
        
        await updateProgress(20, 'Reading documents with product catalog...');
        
        const results = await fileProcessor.processFiles(
            uploadedFiles, 
            positionMappings,
            selectedSupplier?.id || null
        );
        
        await updateProgress(70, 'Processing extraction results...');
        
        const summary = fileProcessor.getProcessingSummary(results);
        logger.info('✅ Catalog-aware processing complete', summary);
        
        extractedData = {
            results: results,
            summary: summary,
            positionMappings: positionMappings,
            locality: currentLocality,
            mooring: currentMooring,
            supplier: selectedSupplier,
            processedAt: new Date().toISOString()
        };
        
        await updateProgress(100, 'Catalog-aware extraction complete!');
        
        setTimeout(() => {
            displayResults(extractedData);
            showStep('results');
        }, 1000);
        
    } catch (error) {
        logger.error('❌ File processing failed', error);
        showError('Processing failed: ' + error.message);
    }
}

function showProcessingStatus() {
    if (progressBar) progressBar.style.width = '0%';
    if (progressStatus) progressStatus.textContent = 'Starting catalog-aware extraction...';
}

function updateProgress(percentage, status) {
    return new Promise(resolve => {
        if (progressBar) progressBar.style.width = percentage + '%';
        if (progressStatus) progressStatus.textContent = status;
        
        setTimeout(resolve, 100);
    });
}

function displayResults(data) {
    if (!resultsArea) return;
    
    const supplierText = data.supplier 
        ? `Supplier: <strong>${data.supplier.name}</strong>`
        : `Using <strong>Full Catalog</strong> (all suppliers)`;
    
    resultsArea.innerHTML = `
        <div class="results-container">
            <div class="results-header">
                <h3>🎯 Catalog-Aware Extraction Results</h3>
                <p>Facility: <strong>${data.locality.name}</strong> | ${supplierText}</p>
                <div class="results-stats">
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.totalComponents}</span>
                        <span class="stat-label">Components Found</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.catalogMatchedComponents}</span>
                        <span class="stat-label">Catalog Matched</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.catalogMatchRate}</span>
                        <span class="stat-label">Match Rate</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${data.summary.highConfidenceMatches}</span>
                        <span class="stat-label">High Confidence</span>
                    </div>
                </div>
            </div>
            
            <div class="results-content">
                ${data.results.map(renderFileResult).join('')}
            </div>
            
            <div class="results-actions">
                <button onclick="submitToDatabase()" class="btn-primary">💾 Submit to Database</button>
                <button onclick="exportResults()" class="btn-secondary">📥 Export to CSV</button>
                <button onclick="clearAll()" class="btn-secondary">🔄 Start Over</button>
            </div>
        </div>
    `;
}

function renderFileResult(result) {
    const { fileName, success, catalogExtraction, error } = result;
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
    
    if (!catalogExtraction || !catalogExtraction.success) {
        return `
            <div class="file-result warning">
                <div class="file-header">
                    <h5>${icon} ${fileName}</h5>
                    <span class="status warning">Extraction Failed</span>
                </div>
            </div>
        `;
    }
    
    const data = catalogExtraction.data;
    const positionGroups = data.position_groups || [];
    
    return `
        <div class="file-result success">
            <div class="file-header">
                <h5>${icon} ${fileName}</h5>
                <span class="status success">Success</span>
            </div>
            
            <div class="catalog-results">
                <h6>🎯 Catalog-Matched Components</h6>
                <div class="position-groups">
                    ${positionGroups.map(renderPositionGroup).join('')}
                </div>
            </div>
        </div>
    `;
}

function renderPositionGroup(group) {
    const mappingStatus = group.mapping_found 
        ? `<span class="mapping-found">✓ Mapped to Position ${group.internal_position}</span>`
        : `<span class="mapping-missing">⚠️ No mapping found</span>`;
    
    return `
        <div class="position-group">
            <div class="group-header">
                <h6>📍 "${group.document_reference}" ${mappingStatus}</h6>
                <span class="component-count">${group.components?.length || 0} components</span>
            </div>
            
            <div class="components-list">
                ${(group.components || []).map((comp, idx) => renderComponent(comp, group.position_id, idx)).join('')}
            </div>
        </div>
    `;
}

function renderComponent(comp, positionId, componentIndex) {
    const hasMatch = comp.matched_product_id !== null && comp.matched_product_id !== undefined;
    const confidenceClass = comp.match_confidence >= 0.9 ? 'high' : 
                           comp.match_confidence >= 0.6 ? 'medium' : 'low';
    
    const editId = `edit_${positionId}_${componentIndex}`;
    const isEditing = false;
    
    return `
        <div class="component-item" id="comp_${positionId}_${componentIndex}">
            <div class="component-main">
                <span class="component-type">${comp.type}</span>
                <span class="component-desc">${comp.description}</span>
            </div>
            <div class="component-details">
                <div class="component-meta">
                    ${comp.manufacturer ? `<span class="manufacturer">🏭 ${comp.manufacturer}</span>` : ''}
                    ${comp.tracking_number ? `<span class="tracking">📋 ${comp.tracking_number}</span>` : ''}
                    ${comp.quantity ? `<span class="quantity">×${comp.quantity} ${comp.unit || ''}</span>` : ''}
                    ${comp.mbl_kg ? `<span class="mbl">⚖️ ${comp.mbl_kg}kg</span>` : ''}
                </div>
                ${hasMatch ? `
                    <div class="match-info">
                        <span class="match-badge ${confidenceClass}">
                            🎯 Matched to Product #${comp.matched_product_id}
                        </span>
                        <span class="confidence">${Math.round(comp.match_confidence * 100)}%</span>
                        <button class="btn-change" onclick="editComponent(${positionId}, ${componentIndex})">Change</button>
                    </div>
                ` : `
                    <div class="match-info">
                        <span class="no-match">❌ No catalog match</span>
                        <button class="btn-change active" onclick="editComponent(${positionId}, ${componentIndex})">Select Product</button>
                    </div>
                `}
            </div>
            <div id="${editId}" class="component-editor" style="display: none;">
                <div class="editor-row">
                    <label>Supplier:</label>
                    <input 
                        type="text" 
                        class="supplier-search-input" 
                        placeholder="Type 3+ chars to search..."
                        oninput="searchSupplierForComponent(this.value, ${positionId}, ${componentIndex})"
                    />
                    <div class="supplier-dropdown" id="supplier_dropdown_${positionId}_${componentIndex}"></div>
                </div>
                <div class="editor-row" id="product_row_${positionId}_${componentIndex}" style="display: none;">
                    <label>Product:</label>
                    <input 
                        type="text" 
                        class="product-search-input" 
                        placeholder="Type 3+ chars to search products..."
                        oninput="searchProductForComponent(this.value, ${positionId}, ${componentIndex})"
                    />
                    <div class="product-dropdown" id="product_dropdown_${positionId}_${componentIndex}"></div>
                </div>
                <div class="editor-actions">
                    <button class="btn-save" onclick="saveComponentEdit(${positionId}, ${componentIndex})">Save</button>
                    <button class="btn-cancel" onclick="cancelComponentEdit(${positionId}, ${componentIndex})">Cancel</button>
                </div>
            </div>
        </div>
    `;
}

let componentEditState = {};

function editComponent(positionId, componentIndex) {
    const editorId = `edit_${positionId}_${componentIndex}`;
    const editor = document.getElementById(editorId);
    
    if (editor) {
        editor.style.display = 'block';
        componentEditState[`${positionId}_${componentIndex}`] = {
            selectedSupplier: null,
            selectedProduct: null
        };
    }
}

function searchSupplierForComponent(searchTerm, positionId, componentIndex) {
    const dropdownId = `supplier_dropdown_${positionId}_${componentIndex}`;
    const dropdown = document.getElementById(dropdownId);
    
    if (!dropdown) return;
    
    const suppliersToSearch = window.filteredSuppliers || allSuppliers;
    
    if (searchTerm.length < 3) {
        dropdown.innerHTML = `<div class="dropdown-hint">Type at least 3 characters... (${suppliersToSearch.length} suppliers available)</div>`;
        dropdown.style.display = 'block';
        return;
    }
    
    const term = searchTerm.toLowerCase();
    const filtered = suppliersToSearch.filter(s => 
        s.Name.toLowerCase().includes(term)
    ).slice(0, 5);
    
    if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="dropdown-hint">No suppliers found</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    dropdown.innerHTML = filtered.map(s => `
        <div class="dropdown-item" onclick="selectSupplierForComponent(${s.Id}, '${s.Name.replace(/'/g, "\\'")}', ${positionId}, ${componentIndex})">
            <strong>${s.Name}</strong>
            <span class="product-count">${s.productCount} products</span>
        </div>
    `).join('');
    dropdown.style.display = 'block';
}

function selectSupplierForComponent(supplierId, supplierName, positionId, componentIndex) {
    const key = `${positionId}_${componentIndex}`;
    if (!componentEditState[key]) {
        componentEditState[key] = {};
    }
    
    componentEditState[key].selectedSupplier = { id: supplierId, name: supplierName };
    
    const supplierInput = document.querySelector(`#edit_${positionId}_${componentIndex} .supplier-search-input`);
    const supplierDropdown = document.getElementById(`supplier_dropdown_${positionId}_${componentIndex}`);
    const productRow = document.getElementById(`product_row_${positionId}_${componentIndex}`);
    
    if (supplierInput) supplierInput.value = supplierName;
    if (supplierDropdown) supplierDropdown.style.display = 'none';
    if (productRow) productRow.style.display = 'block';
}

function searchProductForComponent(searchTerm, positionId, componentIndex) {
    const key = `${positionId}_${componentIndex}`;
    const editState = componentEditState[key];
    
    if (!editState || !editState.selectedSupplier) {
        return;
    }
    
    const dropdownId = `product_dropdown_${positionId}_${componentIndex}`;
    const dropdown = document.getElementById(dropdownId);
    
    if (!dropdown) return;
    
    if (searchTerm.length < 3) {
        dropdown.innerHTML = '<div class="dropdown-hint">Type at least 3 characters...</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    const term = searchTerm.toLowerCase();
    
    const selectedSupplierId = editState.selectedSupplier.id;
    const supplierData = allSuppliers.find(s => s.Id === selectedSupplierId);
    const parentSupplierId = supplierData?.ParentSupplierId;
    
    const filtered = allProducts.filter(p => {
        const matchesSupplier = p.supplierId === selectedSupplierId || 
                               (parentSupplierId && p.supplierId === parentSupplierId);
        const matchesSearch = p.description.toLowerCase().includes(term);
        return matchesSupplier && matchesSearch;
    }).slice(0, 5);
    
    if (filtered.length === 0) {
        const msg = parentSupplierId 
            ? 'No products found for this supplier or its parent' 
            : 'No products found for this supplier';
        dropdown.innerHTML = `<div class="dropdown-hint">${msg}</div>`;
        dropdown.style.display = 'block';
        return;
    }
    
    dropdown.innerHTML = filtered.map(p => `
        <div class="dropdown-item" onclick="selectProductForComponent(${p.id}, '${p.description.replace(/'/g, "\\'")}', ${positionId}, ${componentIndex})">
            <strong>${p.description}</strong>
            <div class="product-meta">
                ${p.mbl ? `MBL: ${p.mbl}kg` : ''} ${p.internalNumber ? `| #${p.internalNumber}` : ''}
            </div>
        </div>
    `).join('');
    dropdown.style.display = 'block';
}

function selectProductForComponent(productId, productDescription, positionId, componentIndex) {
    const key = `${positionId}_${componentIndex}`;
    if (!componentEditState[key]) {
        componentEditState[key] = {};
    }
    
    componentEditState[key].selectedProduct = { id: productId, description: productDescription };
    
    const productInput = document.querySelector(`#edit_${positionId}_${componentIndex} .product-search-input`);
    const productDropdown = document.getElementById(`product_dropdown_${positionId}_${componentIndex}`);
    
    if (productInput) productInput.value = productDescription;
    if (productDropdown) productDropdown.style.display = 'none';
}

function saveComponentEdit(positionId, componentIndex) {
    const key = `${positionId}_${componentIndex}`;
    const editState = componentEditState[key];
    
    if (!editState || !editState.selectedProduct) {
        showError('Please select both supplier and product');
        return;
    }
    
    if (!extractedData) return;
    
    extractedData.results.forEach(result => {
        if (result.catalogExtraction && result.catalogExtraction.data) {
            result.catalogExtraction.data.position_groups.forEach(group => {
                if (group.position_id === positionId && group.components[componentIndex]) {
                    group.components[componentIndex].matched_product_id = editState.selectedProduct.id;
                    group.components[componentIndex].match_confidence = 1.0;
                    group.components[componentIndex].match_reason = 'Manually selected';
                }
            });
        }
    });
    
    const editor = document.getElementById(`edit_${positionId}_${componentIndex}`);
    if (editor) editor.style.display = 'none';
    
    delete componentEditState[key];
    
    displayResults(extractedData);
    
    showNotification('✅ Product updated successfully', 'success');
}

function cancelComponentEdit(positionId, componentIndex) {
    const editor = document.getElementById(`edit_${positionId}_${componentIndex}`);
    if (editor) editor.style.display = 'none';
    
    const key = `${positionId}_${componentIndex}`;
    delete componentEditState[key];
}

async function submitToDatabase() {
    if (!extractedData) {
        showError('No data to submit');
        return;
    }
    
    showNotification('🔄 Submitting components to database...', 'info');
    
    try {
        const componentsToInsert = [];
        
        extractedData.results.forEach(result => {
            if (result.success && result.catalogExtraction?.success) {
                const positionGroups = result.catalogExtraction.data.position_groups || [];
                
                positionGroups.forEach(group => {
                    if (!group.position_id) return;
                    
                    (group.components || []).forEach(comp => {
                        if (comp.matched_product_id) {
                            componentsToInsert.push({
                                positionId: group.position_id,
                                productId: comp.matched_product_id,
                                productNumber: comp.tracking_number,
                                productDescription: comp.description,
                                supplierId: null,
                                quantity: comp.quantity || 1,
                                unitId: null,
                                mbl: comp.mbl_kg,
                                installationDate: comp.installation_date,
                                notes: comp.notes
                            });
                        }
                    });
                });
            }
        });
        
        if (componentsToInsert.length === 0) {
            showError('No components with catalog matches to insert');
            return;
        }
        
        const insertResults = await fileProcessor.insertComponents(componentsToInsert);
        
        const successful = insertResults.filter(r => r.success).length;
        const failed = insertResults.filter(r => !r.success).length;
        
        if (failed > 0) {
            showNotification(`⚠️ Inserted ${successful} components, ${failed} failed`, 'warning');
        } else {
            showNotification(`✅ Successfully inserted ${successful} components to database!`, 'success');
        }
        
    } catch (error) {
        showError('Failed to submit to database: ' + error.message);
    }
}

function exportResults() {
    showNotification('Export feature coming soon!', 'info');
}

function clearAll() {
    uploadedFiles = [];
    positionMappings = [];
    extractedData = null;
    currentLocality = null;
    currentMooring = null;
    currentPositions = [];
    selectedSupplier = null;
    componentEditState = {};
    
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

window.selectLocality = selectLocality;
window.filterLocalities = filterLocalities;
window.updatePositionMapping = updatePositionMapping;
window.savePositionMappings = savePositionMappings;
window.backToUpload = backToUpload;
window.backToLocality = backToLocality;
window.backToMapping = backToMapping;
window.searchSuppliers = searchSuppliers;
window.selectSupplier = selectSupplier;
window.skipSupplierSelection = skipSupplierSelection;
window.proceedToProcessing = proceedToProcessing;
window.submitToDatabase = submitToDatabase;
window.exportResults = exportResults;
window.editComponent = editComponent;
window.searchSupplierForComponent = searchSupplierForComponent;
window.selectSupplierForComponent = selectSupplierForComponent;
window.searchProductForComponent = searchProductForComponent;
window.selectProductForComponent = selectProductForComponent;
window.saveComponentEdit = saveComponentEdit;
window.cancelComponentEdit = cancelComponentEdit;