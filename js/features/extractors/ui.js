// Extractor UI Module
import { escapeHtml, copyToClipboard } from '../../core/utils/dom.js';

// Helper to escape strings for single-quoted shell contexts (curl)
function shellEscapeSingle(str) {
    if (str == null) return '';
    // Replace ' with '\'' pattern for POSIX shells
    return String(str).replace(/'/g, `'\\''`);
}

// Generate curl command from endpoint and parameters
function generateCurlFromParameters(group) {
    const method = (group.method || 'GET').toUpperCase();
    const endpoint = group.endpoint || '';
    const sourceFile = group.sourceFile || '';
    
    // Construct full URL from endpoint path
    let fullUrl = endpoint;
    try {
        // If endpoint is relative, use source file's origin
        if (endpoint.startsWith('/')) {
            const sourceUrl = new URL(sourceFile);
            fullUrl = `${sourceUrl.origin}${endpoint}`;
        } else if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
            // Relative path without leading slash
            const sourceUrl = new URL(sourceFile);
            fullUrl = `${sourceUrl.origin}/${endpoint}`;
        }
    } catch (e) {
        // If URL parsing fails, try to extract origin from sourceFile manually
        if (sourceFile) {
            const match = sourceFile.match(/^(https?:\/\/[^\/]+)/);
            if (match) {
                const origin = match[1];
                if (endpoint.startsWith('/')) {
                    fullUrl = `${origin}${endpoint}`;
                } else {
                    fullUrl = `${origin}/${endpoint}`;
                }
            }
        }
    }
    
    // Build base curl command
    const parts = [`curl '${shellEscapeSingle(fullUrl)}'`];
    
    if (method !== 'GET') {
        parts.push(`-X ${method}`);
    }
    
    // Separate parameters by location
    const queryParams = [];
    const bodyParams = {};
    const headerParams = {};
    
    group.params.forEach(param => {
        const paramName = param.name || '';
        const paramValue = 'VALUE'; // Placeholder - user will need to replace
        
        if (param.location === 'query') {
            queryParams.push(`${encodeURIComponent(paramName)}=${encodeURIComponent(paramValue)}`);
        } else if (param.location === 'body') {
            bodyParams[paramName] = paramValue;
        } else if (param.location === 'header') {
            headerParams[paramName] = paramValue;
        }
    });
    
    // Add query parameters to URL
    if (queryParams.length > 0) {
        const urlObj = new URL(fullUrl);
        queryParams.forEach(qp => {
            const [key, value] = qp.split('=');
            urlObj.searchParams.append(decodeURIComponent(key), decodeURIComponent(value));
        });
        parts[0] = `curl '${shellEscapeSingle(urlObj.toString())}'`;
    }
    
    // Add headers
    Object.entries(headerParams).forEach(([key, value]) => {
        parts.push(`-H '${shellEscapeSingle(`${key}: ${value}`)}'`);
    });
    
    // Add body (as JSON for body parameters)
    if (Object.keys(bodyParams).length > 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
        const jsonBody = JSON.stringify(bodyParams, null, 2);
        parts.push(`--data-raw '${shellEscapeSingle(jsonBody)}'`);
        // Add Content-Type header if not already present
        if (!Object.keys(headerParams).some(k => k.toLowerCase() === 'content-type')) {
            parts.push(`-H 'Content-Type: application/json'`);
        }
    }
    
    return parts.join(' \\\n  ');
}

export function initExtractorUI() {
    const extractorBtn = document.getElementById('extractor-btn');
    const extractorModal = document.getElementById('extractor-modal');
    const extractorSearch = document.getElementById('extractor-search');
    const extractorSearchContainer = document.getElementById('extractor-search-container');
    const domainFilter = document.getElementById('domain-filter');
    const domainFilterContainer = document.getElementById('domain-filter-container');
    const extractorProgress = document.getElementById('extractor-progress');
    const extractorProgressBar = document.getElementById('extractor-progress-bar');
    const extractorProgressText = document.getElementById('extractor-progress-text');
    const startScanBtn = document.getElementById('start-scan-btn');

    // Results containers
    const secretsResults = document.getElementById('secrets-results');
    const endpointsResults = document.getElementById('endpoints-results');
    const parametersResults = document.getElementById('parameters-results');

    // State
    let currentSecretResults = [];
    let currentEndpointResults = [];
    let currentParameterResults = [];
    let currentResponseSearchResults = [];
    let activeTab = 'secrets';
    let scannedDomains = new Set();
    let selectedDomain = 'all';

    // Pagination State
    const ITEMS_PER_PAGE = 10;
    let currentSecretsPage = 1;
    let currentEndpointsPage = 1;
    let currentParametersPage = 1;
    let currentResponseSearchPage = 1;

    // Sort State
    let secretsSort = { column: null, direction: 'asc' };
    let endpointsSort = { column: null, direction: 'asc' };
    let parametersSort = { column: null, direction: 'asc' };

    // Helper: Extract domain from URL
    function getDomainFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return 'unknown';
        }
    }

    // Open Modal
    if (extractorBtn) {
        extractorBtn.addEventListener('click', () => {
            extractorModal.style.display = 'block';
        });
    }

    // Close Modal
    const closeBtn = extractorModal.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            extractorModal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === extractorModal) {
            extractorModal.style.display = 'none';
        }
    });

    // Tab switching
    document.querySelectorAll('.extractor-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update UI
            document.querySelectorAll('.extractor-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const tabId = tab.getAttribute('data-tab');
            document.getElementById(`tab-${tabId}`).classList.add('active');

            // Update state
            activeTab = tabId;

            // Update search placeholder
            if (extractorSearch) {
                if (activeTab === 'secrets') {
                    extractorSearch.placeholder = 'Search secrets...';
                } else if (activeTab === 'endpoints') {
                    extractorSearch.placeholder = 'Search endpoints...';
                } else if (activeTab === 'parameters') {
                    extractorSearch.placeholder = 'Search parameters...';
                } else {
                    extractorSearch.placeholder = 'Search...';
                }
                extractorSearch.value = '';

                // Show/hide search based on results existence
                let hasResults = false;
                if (activeTab === 'secrets') {
                    hasResults = currentSecretResults.length > 0;
                } else if (activeTab === 'endpoints') {
                    hasResults = currentEndpointResults.length > 0;
                } else if (activeTab === 'parameters') {
                    hasResults = currentParameterResults.length > 0;
                }
                extractorSearchContainer.style.display = hasResults ? 'block' : 'none';
            }

            // Populate domain filter for current tab (secrets, endpoints, parameters, response-search)
            if (activeTab === 'secrets' || activeTab === 'endpoints' || activeTab === 'parameters' || activeTab === 'response-search') {
                // Reset domain filter to "All Domains" when switching tabs
                selectedDomain = 'all';
                if (domainFilter) {
                    domainFilter.value = 'all';
                }
                
                // Show/hide domain filter based on results
                let hasResults = false;
                let resultsToCheck = [];
                
                if (activeTab === 'secrets') {
                    hasResults = currentSecretResults.length > 0;
                    resultsToCheck = currentSecretResults;
                } else if (activeTab === 'endpoints') {
                    hasResults = currentEndpointResults.length > 0;
                    resultsToCheck = currentEndpointResults;
                } else if (activeTab === 'parameters') {
                    hasResults = currentParameterResults.length > 0;
                    resultsToCheck = currentParameterResults;
                } else if (activeTab === 'response-search') {
                    hasResults = currentResponseSearchResults.length > 0;
                    resultsToCheck = currentResponseSearchResults;
                }
                
                // Count unique domains from results
                const domainSet = new Set();
                resultsToCheck.forEach(result => {
                    const file = result.file || result.sourceFile || result.url || '';
                    const domain = getDomainFromUrl(file);
                    if (domain && domain !== 'unknown') {
                        domainSet.add(domain);
                    }
                });
                
                // Populate domain filter
                populateDomainFilter();
                
                // Re-apply filter to show all results (since we reset to 'all')
                if (activeTab === 'secrets') {
                    const filtered = filterByDomainAndSearch(currentSecretResults);
                    renderSecretResults(filtered);
                } else if (activeTab === 'endpoints') {
                    const filtered = filterByDomainAndSearch(currentEndpointResults);
                    renderEndpointResults(filtered);
                } else if (activeTab === 'parameters') {
                    const filtered = filterByDomainAndSearch(currentParameterResults);
                    renderParameterResults(filtered, false);
                } else if (activeTab === 'response-search') {
                    renderResponseSearchResults(currentResponseSearchResults);
                }
                
                // Show domain filter if there are results and multiple domains
                if (hasResults && domainSet.size > 1) {
                    domainFilterContainer.style.display = 'block';
                } else {
                    domainFilterContainer.style.display = 'none';
                }
            } else {
                // Hide domain filter for other tabs
                domainFilterContainer.style.display = 'none';
            }
        });
    });

    // Start Scan
    if (startScanBtn) {
        startScanBtn.addEventListener('click', async () => {
            extractorProgress.style.display = 'block';
            extractorProgressBar.style.setProperty('--progress', '0%');
            extractorProgressText.textContent = 'Scanning JS files...';
            startScanBtn.disabled = true;
            secretsResults.innerHTML = '';
            endpointsResults.innerHTML = '';
            if (parametersResults) parametersResults.innerHTML = '';
            currentSecretResults = [];
            currentEndpointResults = [];
            currentParameterResults = [];
            extractorSearchContainer.style.display = 'none';
            domainFilterContainer.style.display = 'none';
            scannedDomains.clear();
            selectedDomain = 'all';

            // Reset pagination
            currentSecretsPage = 1;
            currentEndpointsPage = 1;
            currentParametersPage = 1;

            try {
                // Lazy load scanners
                const [secretScanner, endpointExtractor, parameterExtractor, stateModule] = await Promise.all([
                    import('./secrets.js'),
                    import('./endpoints.js'),
                    import('./parameters.js'),
                    import('../../core/state.js')
                ]);

                const { state } = stateModule;
                
                if (!state || !state.requests || state.requests.length === 0) {
                    extractorProgressText.textContent = 'No requests captured yet. Please navigate to a website first.';
                    setTimeout(() => {
                        extractorProgress.style.display = 'none';
                    }, 3000);
                    return;
                }
                
                // Filter for JavaScript files from captured requests
                const jsRequests = state.requests.filter(req => {
                    if (!req || !req.request || !req.response) return false;
                    const url = req.request.url.toLowerCase();
                    const mime = req.response?.content?.mimeType?.toLowerCase() || '';
                    return url.endsWith('.js') || 
                           mime.includes('javascript') || 
                           mime.includes('ecmascript') ||
                           mime.includes('application/javascript');
                });

                if (jsRequests.length === 0) {
                    extractorProgressText.textContent = 'No JavaScript files found in captured requests.';
                    setTimeout(() => {
                        extractorProgress.style.display = 'none';
                    }, 3000);
                    return;
                }

                // Track progress state
                let filesProcessed = 0;
                const totalFiles = jsRequests.length;
                let lastUpdateTime = 0;
                const UPDATE_INTERVAL = 50; // Update UI at most every 50ms for smooth animation
                const scanStartTime = Date.now();
                const MIN_SCAN_DURATION = 500; // Minimum scan duration to show animation (500ms)
                
                // Helper function to update progress bar with throttling
                const updateProgressBar = (processed, total, foundCount, isComplete = false) => {
                    const now = Date.now();
                    if (now - lastUpdateTime < UPDATE_INTERVAL && processed < total && !isComplete) {
                        return; // Throttle updates (but always show completion)
                    }
                    lastUpdateTime = now;
                    
                    const percent = Math.round((processed / total) * 100);
                    
                    // Use requestAnimationFrame to ensure smooth visual updates
                    requestAnimationFrame(() => {
                        // Set CSS variable for progress (the ::after pseudo-element uses this)
                        extractorProgressBar.style.setProperty('--progress', `${percent}%`);
                        if (isComplete) {
                            extractorProgressText.textContent = `Scan complete! Found ${foundCount} secret${foundCount !== 1 ? 's' : ''}`;
                        } else {
                            extractorProgressText.textContent = `Scanning ${processed}/${total} files... Found ${foundCount} secret${foundCount !== 1 ? 's' : ''}`;
                        }
                    });
                };
                
                // Scan for Secrets using async function that includes Kingfisher rules
                // onSecretFound callback will render results in real-time as they're discovered
                const secrets = await secretScanner.scanForSecrets(jsRequests, (processed, total) => {
                    filesProcessed = processed;
                    const foundCount = currentSecretResults.length;
                    updateProgressBar(processed, total, foundCount);
                }, (secret) => {
                    // Called immediately when a secret is found
                    currentSecretResults.push(secret);
                    
                    // Reset to first page when new results arrive during scanning
                    currentSecretsPage = 1;
                    
                    // Apply filters if active, otherwise show all
                    const filtered = filterByDomainAndSearch(currentSecretResults);
                    
                    // Re-render with updated results (respecting filters)
                    renderSecretResults(filtered);
                    
                    // Update progress text to show both file progress and secret count
                    const foundCount = currentSecretResults.length;
                    updateProgressBar(filesProcessed, totalFiles, foundCount);
                });
                
                // Final progress update - show 100% completion
                updateProgressBar(totalFiles, totalFiles, currentSecretResults.length, true);
                
                // Final results are already in currentSecretResults from the callback
                // Apply final filter and render
                const finalFiltered = filterByDomainAndSearch(currentSecretResults);
                renderSecretResults(finalFiltered);
                
                // Ensure minimum scan duration for visibility (especially for fast scans)
                const scanDuration = Date.now() - scanStartTime;
                const remainingTime = Math.max(0, MIN_SCAN_DURATION - scanDuration);
                
                // Wait to ensure users can see the 100% completion state
                // This is especially important for fast scans
                await new Promise(resolve => setTimeout(resolve, remainingTime + 800));

                // Extract Endpoints
                for (const req of jsRequests) {
                    try {
                        // Use stored responseBody if available, otherwise try getContent
                        let content = null;
                        
                        if (req.responseBody !== undefined) {
                            // Response body was already fetched during capture
                            content = req.responseBody || '';
                        } else if (typeof req.getContent === 'function') {
                            // Fallback: try to get content if it's a DevTools request object
                            content = await new Promise((resolve, reject) => {
                                req.getContent((body, encoding) => {
                                    if (chrome.runtime.lastError) {
                                        reject(new Error(chrome.runtime.lastError.message));
                                    } else {
                                        resolve(body || '');
                                    }
                                });
                            });
                        } else {
                            console.warn(`Cannot get content for endpoints from ${req.request.url}: no responseBody or getContent method`);
                            continue;
                        }
                        
                        if (content) {
                            const endpoints = endpointExtractor.extractEndpoints(content, req.request.url);
                            currentEndpointResults.push(...endpoints);
                            
                            // Extract parameters from the same content
                            const parameters = parameterExtractor.extractParameters(content, req.request.url);
                            currentParameterResults.push(...parameters);
                        }
                    } catch (e) {
                        console.error('Error reading file for endpoints:', req.request.url, e);
                    }
                }

                // Deduplicate endpoints across all requests (same file fetched multiple times)
                const seenEndpointKeys = new Set();
                const deduplicatedEndpoints = currentEndpointResults.filter(endpoint => {
                    // Create unique key: endpoint:method:normalizedFile
                    const normalizedFile = endpoint.file ? endpoint.file.split('?')[0].split('#')[0] : '';
                    const key = `${endpoint.endpoint || 'unknown'}:${endpoint.method || 'GET'}:${normalizedFile}`;
                    if (seenEndpointKeys.has(key)) {
                        return false; // Duplicate, skip
                    }
                    seenEndpointKeys.add(key);
                    return true;
                });
                currentEndpointResults = deduplicatedEndpoints;

                // Deduplicate secrets across all requests (same file fetched multiple times)
                const seenSecretKeys = new Set();
                const deduplicatedSecrets = currentSecretResults.filter(secret => {
                    // Create unique key: type:match:normalizedFile
                    const normalizedFile = secret.file ? secret.file.split('?')[0].split('#')[0] : '';
                    const key = `${secret.type || 'unknown'}:${secret.match || ''}:${normalizedFile}`;
                    if (seenSecretKeys.has(key)) {
                        return false; // Duplicate, skip
                    }
                    seenSecretKeys.add(key);
                    return true;
                });
                currentSecretResults = deduplicatedSecrets;

                // Deduplicate parameters across all requests (same file fetched multiple times)
                const seenParamKeys = new Set();
                const deduplicatedParameters = currentParameterResults.filter(param => {
                    // Create unique key: endpoint:location:name:normalizedFile
                    const normalizedFile = param.sourceFile ? param.sourceFile.split('?')[0].split('#')[0] : '';
                    const key = `${param.endpoint || 'unknown'}:${param.location}:${param.name}:${normalizedFile}`;
                    if (seenParamKeys.has(key)) {
                        return false; // Duplicate, skip
                    }
                    seenParamKeys.add(key);
                    return true;
                });
                currentParameterResults = deduplicatedParameters;

                // Render Results
                renderSecretResults(currentSecretResults);
                renderEndpointResults(currentEndpointResults);
                renderParameterResults(currentParameterResults, false); // false = hide hiddenByDefault params

                // Populate domain filter
                populateDomainFilter();
                
                // Show domain filter if we have results and multiple domains
                const totalDomains = scannedDomains.size;
                if (totalDomains > 1) {
                    domainFilterContainer.style.display = 'block';
                } else {
                    domainFilterContainer.style.display = 'none';
                }

                extractorSearchContainer.style.display = (currentSecretResults.length > 0 || currentEndpointResults.length > 0 || currentParameterResults.length > 0) ? 'block' : 'none';

            } catch (e) {
                console.error('Scan failed:', e);
                console.error('Error stack:', e.stack);
                extractorProgressText.textContent = `Scan failed: ${e.message}. Check console for details.`;
                extractorProgress.style.display = 'block';
            } finally {
                startScanBtn.disabled = false;
                // Hide progress bar after a short delay (we already waited 800ms for completion animation)
                setTimeout(() => {
                    extractorProgress.style.display = 'none';
                }, 500);
            }
        });
    }

    // Combined Filter Function
    function filterByDomainAndSearch(results) {
        const searchTerm = extractorSearch ? extractorSearch.value.toLowerCase() : '';

        return results.filter(r => {
            // Domain filter
            if (selectedDomain !== 'all') {
                const domain = getDomainFromUrl(r.file || r.sourceFile || '');
                if (domain !== selectedDomain) return false;
            }

            // Search filter
            if (searchTerm) {
                if (activeTab === 'secrets') {
                    return r.type.toLowerCase().includes(searchTerm) ||
                        r.match.toLowerCase().includes(searchTerm) ||
                        r.file.toLowerCase().includes(searchTerm);
                } else if (activeTab === 'endpoints') {
                    return r.endpoint.toLowerCase().includes(searchTerm) ||
                        r.method.toLowerCase().includes(searchTerm) ||
                        r.file.toLowerCase().includes(searchTerm);
                } else if (activeTab === 'parameters') {
                    return r.name.toLowerCase().includes(searchTerm) ||
                        (r.endpoint && r.endpoint.toLowerCase().includes(searchTerm)) ||
                        (r.method && r.method.toLowerCase().includes(searchTerm)) ||
                        (r.location && r.location.toLowerCase().includes(searchTerm)) ||
                        (r.sourceFile && r.sourceFile.toLowerCase().includes(searchTerm));
                }
            }

            return true;
        });
    }

    // Populate Domain Filter
    async function populateDomainFilter() {
        if (!domainFilter || !domainFilterContainer) return;

        // Clear existing options except "All Domains"
        domainFilter.innerHTML = '<option value="all">All Domains</option>';

        // Collect domain counts
        const domainCounts = {};
        
        if (activeTab === 'response-search') {
            // For response search, use results if available, otherwise use all requests
            if (currentResponseSearchResults.length > 0) {
                // Populate from search results
                currentResponseSearchResults.forEach(result => {
                    const domain = getDomainFromUrl(result.url);
                    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
                });
            } else {
                // Populate from all available requests (before search)
                const { state } = await import('../../core/state.js');
                const seenDomains = new Set();
                state.requests.forEach(req => {
                    const domain = getDomainFromUrl(req.pageUrl || req.request.url);
                    if (domain && !seenDomains.has(domain)) {
                        seenDomains.add(domain);
                        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
                    }
                });
            }
        } else {
            // For secrets, endpoints, and parameters, use results from current tab only
            let resultsToCount = [];
            if (activeTab === 'secrets') {
                resultsToCount = currentSecretResults;
            } else if (activeTab === 'endpoints') {
                resultsToCount = currentEndpointResults;
            } else if (activeTab === 'parameters') {
                resultsToCount = currentParameterResults;
            }
            
            resultsToCount.forEach(result => {
                const file = result.file || result.sourceFile || '';
                const domain = getDomainFromUrl(file);
                if (domain && domain !== 'unknown') {
                    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
                }
            });
        }

        // Add domain options sorted alphabetically
        Object.entries(domainCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([domain, count]) => {
                const option = document.createElement('option');
                option.value = domain;
                option.textContent = `${domain} (${count})`;
                domainFilter.appendChild(option);
            });

        // Show filter only if we have multiple domains
        scannedDomains = new Set(Object.keys(domainCounts));
        domainFilterContainer.style.display = scannedDomains.size > 1 ? 'block' : 'none';

        // Don't reset selected domain if it's still valid
        if (selectedDomain !== 'all' && !domainCounts[selectedDomain]) {
            selectedDomain = 'all';
            domainFilter.value = 'all';
        } else if (domainFilter.value !== selectedDomain) {
            domainFilter.value = selectedDomain;
        }
    }

    // Domain Filter Change Handler
    if (domainFilter) {
        domainFilter.addEventListener('change', (e) => {
            selectedDomain = e.target.value;

            // Re-render with domain filter applied
            if (activeTab === 'secrets') {
                currentSecretsPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentSecretResults);
                renderSecretResults(filtered);
            } else if (activeTab === 'endpoints') {
                currentEndpointsPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentEndpointResults);
                renderEndpointResults(filtered);
            } else if (activeTab === 'parameters') {
                currentParametersPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentParameterResults);
                renderParameterResults(filtered, false); // false = hide hiddenByDefault params
            } else if (activeTab === 'response-search') {
                // For response search, filter existing results
                currentResponseSearchPage = 1; // Reset to first page
                renderResponseSearchResults(currentResponseSearchResults);
            }
        });
    }

    // Search Logic
    if (extractorSearch) {
        extractorSearch.addEventListener('input', () => {
            if (activeTab === 'secrets') {
                currentSecretsPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentSecretResults);
                renderSecretResults(filtered);
            } else if (activeTab === 'endpoints') {
                currentEndpointsPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentEndpointResults);
                renderEndpointResults(filtered);
            } else if (activeTab === 'parameters') {
                currentParametersPage = 1; // Reset to first page
                const filtered = filterByDomainAndSearch(currentParameterResults);
                renderParameterResults(filtered, false); // false = hide hiddenByDefault params
            }
        });
    }

    // Sort function for secrets
    function sortSecrets(results, column, direction) {
        const sorted = [...results];
        sorted.sort((a, b) => {
            let aVal, bVal;
            switch (column) {
                case 'type':
                    aVal = (a.type || '').toLowerCase();
                    bVal = (b.type || '').toLowerCase();
                    break;
                case 'match':
                    aVal = (a.match || '').toLowerCase();
                    bVal = (b.match || '').toLowerCase();
                    break;
                case 'confidence':
                    aVal = a.confidence || 0;
                    bVal = b.confidence || 0;
                    break;
                case 'file':
                    aVal = (a.file || '').toLowerCase();
                    bVal = (b.file || '').toLowerCase();
                    break;
                default:
                    return 0;
            }
            if (typeof aVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            }
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }

    function renderSecretResults(results) {
        const container = document.getElementById('secrets-pagination');
        if (results.length === 0) {
            secretsResults.innerHTML = '<div class="empty-state">No secrets found matching your criteria.</div>';
            if (container) container.style.display = 'none';
            return;
        }

        // Apply sorting
        let sortedResults = results;
        if (secretsSort.column) {
            sortedResults = sortSecrets(results, secretsSort.column, secretsSort.direction);
        }

        // Pagination Logic
        const totalPages = Math.ceil(sortedResults.length / ITEMS_PER_PAGE);
        if (currentSecretsPage > totalPages) currentSecretsPage = 1;

        const start = (currentSecretsPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageResults = sortedResults.slice(start, end);

        // Sort indicators
        const typeSort = secretsSort.column === 'type' ? (secretsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const matchSort = secretsSort.column === 'match' ? (secretsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const confidenceSort = secretsSort.column === 'confidence' ? (secretsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const fileSort = secretsSort.column === 'file' ? (secretsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';

        let html = `<table class="secrets-table"><thead><tr>
            <th class="sortable" data-column="type">Type${typeSort}</th>
            <th class="sortable" data-column="match">Match${matchSort}</th>
            <th class="sortable" data-column="confidence">Confidence${confidenceSort}</th>
            <th class="sortable" data-column="file">File${fileSort}</th>
        </tr></thead><tbody>`;
        pageResults.forEach(r => {
            const confidenceClass = r.confidence >= 80 ? 'high' : (r.confidence >= 50 ? 'medium' : 'low');
            html += `<tr>
                <td>${escapeHtml(r.type)}</td>
                <td class="secret-match" title="${escapeHtml(r.match)}">${escapeHtml(r.match.substring(0, 50))}${r.match.length > 50 ? '...' : ''}</td>
                <td><span class="confidence-badge ${confidenceClass}">${r.confidence}%</span></td>
                <td class="secret-file"><a href="${escapeHtml(r.file)}" target="_blank" title="${escapeHtml(r.file)}">${escapeHtml(r.file.split('/').pop())}</a></td>
            </tr>`;
        });
        html += '</tbody></table>';
        secretsResults.innerHTML = html;

        // Render Pagination Controls
        renderPagination(sortedResults.length, currentSecretsPage, container, (newPage) => {
            currentSecretsPage = newPage;
            renderSecretResults(results);
        });

        // Add sort handlers
        secretsResults.querySelectorAll('th.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-column');
                if (secretsSort.column === column) {
                    secretsSort.direction = secretsSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    secretsSort.column = column;
                    secretsSort.direction = 'asc';
                }
                currentSecretsPage = 1; // Reset to first page
                renderSecretResults(results);
            });
        });
    }

    // Sort function for endpoints
    function sortEndpoints(results, column, direction) {
        const sorted = [...results];
        sorted.sort((a, b) => {
            let aVal, bVal;
            switch (column) {
                case 'method':
                    aVal = (a.method || '').toLowerCase();
                    bVal = (b.method || '').toLowerCase();
                    break;
                case 'endpoint':
                    aVal = (a.endpoint || '').toLowerCase();
                    bVal = (b.endpoint || '').toLowerCase();
                    break;
                case 'confidence':
                    aVal = a.confidence || 0;
                    bVal = b.confidence || 0;
                    break;
                case 'file':
                    aVal = (a.file || '').toLowerCase();
                    bVal = (b.file || '').toLowerCase();
                    break;
                default:
                    return 0;
            }
            if (typeof aVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            }
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }

    function renderEndpointResults(results) {
        const container = document.getElementById('endpoints-pagination');
        if (results.length === 0) {
            endpointsResults.innerHTML = '<div class="empty-state">No endpoints found matching your criteria.</div>';
            if (container) container.style.display = 'none';
            return;
        }

        // Apply sorting
        let sortedResults = results;
        if (endpointsSort.column) {
            sortedResults = sortEndpoints(results, endpointsSort.column, endpointsSort.direction);
        }

        // Pagination Logic
        const totalPages = Math.ceil(sortedResults.length / ITEMS_PER_PAGE);
        if (currentEndpointsPage > totalPages) currentEndpointsPage = 1;

        const start = (currentEndpointsPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageResults = sortedResults.slice(start, end);

        // Sort indicators
        const methodSort = endpointsSort.column === 'method' ? (endpointsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const endpointSort = endpointsSort.column === 'endpoint' ? (endpointsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const confidenceSort = endpointsSort.column === 'confidence' ? (endpointsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const fileSort = endpointsSort.column === 'file' ? (endpointsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';

        let html = `<table class="secrets-table"><thead><tr>
            <th class="sortable" data-column="method">Method${methodSort}</th>
            <th class="sortable" data-column="endpoint">Endpoint${endpointSort}</th>
            <th class="sortable" data-column="confidence">Confidence${confidenceSort}</th>
            <th class="sortable" data-column="file">Source File${fileSort}</th>
            <th>Actions</th>
        </tr></thead><tbody>`;
        pageResults.forEach((r, index) => {
            const confidenceClass = r.confidence >= 80 ? 'high' : (r.confidence >= 50 ? 'medium' : 'low');
            const methodClass = r.method === 'POST' || r.method === 'PUT' || r.method === 'DELETE' ? 'method-write' : 'method-read';

            // Construct full URL if endpoint is relative
            let fullUrl = r.endpoint;
            if (r.endpoint.startsWith('/') && r.baseUrl) {
                fullUrl = r.baseUrl + r.endpoint;
            }

            html += `<tr>
                <td><span class="http-method ${methodClass}">${escapeHtml(r.method)}</span></td>
                <td class="endpoint-path" title="${escapeHtml(r.endpoint)}">${escapeHtml(r.endpoint)}</td>
                <td><span class="confidence-badge ${confidenceClass}">${r.confidence}%</span></td>
                <td class="secret-file"><a href="${escapeHtml(r.file)}" target="_blank" title="${escapeHtml(r.file)}">${escapeHtml(r.file.split('/').pop())}</a></td>
                <td><button class="copy-url-btn" data-url="${escapeHtml(fullUrl)}" title="Copy full URL">
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/>
                    </svg>
                </button></td>
            </tr>`;
        });
        html += '</tbody></table>';
        endpointsResults.innerHTML = html;

        // Render Pagination Controls
        renderPagination(sortedResults.length, currentEndpointsPage, container, (newPage) => {
            currentEndpointsPage = newPage;
            renderEndpointResults(results);
        });

        // Add sort handlers
        endpointsResults.querySelectorAll('th.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-column');
                if (endpointsSort.column === column) {
                    endpointsSort.direction = endpointsSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    endpointsSort.column = column;
                    endpointsSort.direction = 'asc';
                }
                currentEndpointsPage = 1; // Reset to first page
                renderEndpointResults(results);
            });
        });

        // Add click handlers for copy buttons
        endpointsResults.querySelectorAll('.copy-url-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = btn.getAttribute('data-url');
                copyToClipboard(url);

                // Visual feedback
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/></svg>';
                btn.style.color = '#81c995';
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.color = '';
                }, 1000);
            });
        });
    }

    // Sort function for parameters
    function sortParameters(results, column, direction) {
        const sorted = [...results];
        sorted.sort((a, b) => {
            let aVal, bVal;
            switch (column) {
                case 'parameter':
                    aVal = (a.name || '').toLowerCase();
                    bVal = (b.name || '').toLowerCase();
                    break;
                case 'location':
                    aVal = (a.location || '').toLowerCase();
                    bVal = (b.location || '').toLowerCase();
                    break;
                case 'endpoint':
                    aVal = (a.endpoint || '').toLowerCase();
                    bVal = (b.endpoint || '').toLowerCase();
                    break;
                case 'method':
                    aVal = (a.method || '').toLowerCase();
                    bVal = (b.method || '').toLowerCase();
                    break;
                case 'risk':
                    const riskOrder = { high: 3, medium: 2, low: 1 };
                    aVal = riskOrder[a.riskLevel] || 0;
                    bVal = riskOrder[b.riskLevel] || 0;
                    break;
                case 'confidence':
                    aVal = a.confidence || 0;
                    bVal = b.confidence || 0;
                    break;
                case 'file':
                    aVal = ((a.sourceFile || a.file) || '').toLowerCase();
                    bVal = ((b.sourceFile || b.file) || '').toLowerCase();
                    break;
                default:
                    return 0;
            }
            if (typeof aVal === 'number') {
                return direction === 'asc' ? aVal - bVal : bVal - aVal;
            }
            if (aVal < bVal) return direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return direction === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }

    function renderParameterResults(results, showHidden = false) {
        const container = document.getElementById('parameters-pagination');
        
        // Filter by hiddenByDefault if needed
        let filteredResults = results;
        if (!showHidden) {
            filteredResults = results.filter(r => !r.hiddenByDefault);
        }
        
        if (filteredResults.length === 0) {
            parametersResults.innerHTML = '<div class="empty-state">No parameters found matching your criteria.</div>';
            if (container) container.style.display = 'none';
            return;
        }

        // Group parameters by endpoint
        const endpointGroups = new Map();
        filteredResults.forEach(param => {
            const endpoint = param.endpoint || 'Unknown Endpoint';
            const method = param.method || 'GET';
            const groupKey = `${method}:${endpoint}`;
            
            if (!endpointGroups.has(groupKey)) {
                endpointGroups.set(groupKey, {
                    endpoint: endpoint,
                    method: method,
                    sourceFile: param.sourceFile || param.file || '',
                    params: []
                });
            }
            endpointGroups.get(groupKey).params.push(param);
        });

        // Convert to array and sort endpoint groups
        let endpointGroupsArray = Array.from(endpointGroups.values());
        
        // Sort endpoint groups if needed
        if (parametersSort.column === 'endpoint' || parametersSort.column === 'method') {
            endpointGroupsArray.sort((a, b) => {
                let aVal, bVal;
                if (parametersSort.column === 'endpoint') {
                    aVal = (a.endpoint || '').toLowerCase();
                    bVal = (b.endpoint || '').toLowerCase();
                } else {
                    aVal = (a.method || '').toLowerCase();
                    bVal = (b.method || '').toLowerCase();
                }
                if (aVal < bVal) return parametersSort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return parametersSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        // Sort parameters within each group if needed
        if (parametersSort.column && parametersSort.column !== 'endpoint' && parametersSort.column !== 'method') {
            endpointGroupsArray.forEach(group => {
                group.params = sortParameters(group.params, parametersSort.column, parametersSort.direction);
            });
        }

        // Pagination Logic - count endpoints, not individual parameters
        const totalPages = Math.ceil(endpointGroupsArray.length / ITEMS_PER_PAGE);
        if (currentParametersPage > totalPages) currentParametersPage = 1;

        const start = (currentParametersPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageGroups = endpointGroupsArray.slice(start, end);

        // Sort indicators
        const endpointSort = parametersSort.column === 'endpoint' ? (parametersSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
        const methodSort = parametersSort.column === 'method' ? (parametersSort.direction === 'asc' ? ' ▲' : ' ▼') : '';

        let html = `<table class="secrets-table parameter-groups-table"><thead><tr>
            <th class="sortable" data-column="endpoint">Endpoint${endpointSort}</th>
            <th class="sortable" data-column="method">Method${methodSort}</th>
            <th>Parameters</th>
            <th>File</th>
            <th>Actions</th>
        </tr></thead><tbody>`;
        
        pageGroups.forEach((group, groupIndex) => {
            const methodClass = group.method === 'POST' || group.method === 'PUT' || group.method === 'DELETE' ? 'method-write' : 'method-read';
            const fileName = group.sourceFile.split('/').pop() || 'unknown';
            const groupId = `param-group-${currentParametersPage}-${groupIndex}`;
            const paramsCount = group.params.length;
            
            // Calculate aggregate stats
            const highRiskCount = group.params.filter(p => p.riskLevel === 'high').length;
            const avgConfidence = Math.round(group.params.reduce((sum, p) => sum + (p.confidence || 0), 0) / paramsCount);
            
            html += `<tr class="endpoint-group-row" data-group-id="${groupId}">
                <td class="endpoint-expand-cell">
                    <button class="expand-toggle" data-group-id="${groupId}" aria-label="Expand/collapse">
                        <svg class="expand-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <span class="endpoint-path" title="${escapeHtml(group.endpoint)}">${escapeHtml(group.endpoint.length > 50 ? group.endpoint.substring(0, 50) + '...' : group.endpoint)}</span>
                </td>
                <td><span class="http-method ${methodClass}">${escapeHtml(group.method)}</span></td>
                <td>
                    <span class="params-count">${paramsCount} parameter${paramsCount !== 1 ? 's' : ''}</span>
                    ${highRiskCount > 0 ? `<span class="high-risk-indicator" title="${highRiskCount} high-risk parameter${highRiskCount !== 1 ? 's' : ''}">⚠️ ${highRiskCount}</span>` : ''}
                </td>
                <td class="secret-file"><a href="${escapeHtml(group.sourceFile)}" target="_blank" title="${escapeHtml(group.sourceFile)}">${escapeHtml(fileName)}</a></td>
                <td>
                    <button class="copy-curl-btn" data-group-index="${groupIndex}" title="Copy as cURL">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </td>
            </tr>`;
            
            // Parameter rows (initially hidden)
            group.params.forEach(param => {
                const confidenceClass = param.confidence >= 80 ? 'high' : (param.confidence >= 50 ? 'medium' : 'low');
                const riskClass = param.riskLevel === 'high' ? 'risk-high' : (param.riskLevel === 'medium' ? 'risk-medium' : 'risk-low');
                const location = param.location || 'unknown';
                
                html += `<tr class="parameter-row" data-group-id="${groupId}" style="display: none;">
                    <td class="parameter-indent">
                        <span class="parameter-name"><strong>${escapeHtml(param.name)}</strong></span>
                    </td>
                    <td>
                        <span class="location-badge location-${location}">${escapeHtml(location)}</span>
                    </td>
                    <td>
                        <span class="risk-badge ${riskClass}">${escapeHtml(param.riskLevel)}</span>
                        <span class="confidence-badge ${confidenceClass}">${param.confidence}%</span>
                    </td>
                    <td></td>
                </tr>`;
            });
        });
        
        html += '</tbody></table>';
        parametersResults.innerHTML = html;

        // Render Pagination Controls (count endpoints, not parameters)
        renderPagination(endpointGroupsArray.length, currentParametersPage, container, (newPage) => {
            currentParametersPage = newPage;
            renderParameterResults(results, showHidden);
        });

        // Add expand/collapse handlers
        parametersResults.querySelectorAll('.expand-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const groupId = btn.getAttribute('data-group-id');
                const groupRow = parametersResults.querySelector(`.endpoint-group-row[data-group-id="${groupId}"]`);
                const paramRows = parametersResults.querySelectorAll(`.parameter-row[data-group-id="${groupId}"]`);
                const icon = btn.querySelector('.expand-icon');
                
                const isExpanded = groupRow.classList.contains('expanded');
                
                if (isExpanded) {
                    // Collapse
                    groupRow.classList.remove('expanded');
                    paramRows.forEach(row => row.style.display = 'none');
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    // Expand
                    groupRow.classList.add('expanded');
                    paramRows.forEach(row => row.style.display = '');
                    icon.style.transform = 'rotate(90deg)';
                }
            });
        });

        // Add copy curl handlers
        parametersResults.querySelectorAll('.copy-curl-btn').forEach((btn, index) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const groupIndex = parseInt(btn.getAttribute('data-group-index'));
                const group = pageGroups[groupIndex];
                
                if (!group) return;
                
                const curlCommand = generateCurlFromParameters(group);
                await copyToClipboard(curlCommand, btn);
            });
        });

        // Add sort handlers
        parametersResults.querySelectorAll('th.sortable').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-column');
                if (parametersSort.column === column) {
                    parametersSort.direction = parametersSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    parametersSort.column = column;
                    parametersSort.direction = 'asc';
                }
                currentParametersPage = 1; // Reset to first page
                renderParameterResults(results, showHidden);
            });
        });
    }

    function renderResponseSearchResults(results) {
        const container = document.getElementById('response-search-pagination');
        if (results.length === 0) {
            responseSearchResults.innerHTML = '<div class="empty-state">No matches found.</div>';
            if (container) container.style.display = 'none';
            return;
        }

        // Apply domain filter if set
        let filteredResults = results;
        if (selectedDomain !== 'all') {
            filteredResults = results.filter(r => {
                const domain = getDomainFromUrl(r.url);
                return domain === selectedDomain;
            });
        }

        if (filteredResults.length === 0) {
            responseSearchResults.innerHTML = '<div class="empty-state">No matches found for selected domain.</div>';
            if (container) container.style.display = 'none';
            return;
        }

        // Pagination Logic
        const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
        if (currentResponseSearchPage > totalPages) currentResponseSearchPage = 1;

        const start = (currentResponseSearchPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageResults = filteredResults.slice(start, end);

        let html = '<table class="secrets-table"><thead><tr><th>Method</th><th>File</th><th>Status</th><th>Match Preview</th></tr></thead><tbody>';
        pageResults.forEach(r => {
            const methodClass = r.method === 'POST' || r.method === 'PUT' || r.method === 'DELETE' ? 'method-write' : 'method-read';
            const statusClass = r.status >= 200 && r.status < 300 ? 'status-2xx' : (r.status >= 300 && r.status < 400 ? 'status-3xx' : (r.status >= 400 && r.status < 500 ? 'status-4xx' : 'status-5xx'));
            const fileName = r.url.split('/').pop() || r.url;

            html += `<tr>
                <td><span class="http-method ${methodClass}">${escapeHtml(r.method)}</span></td>
                <td class="secret-file"><a href="${escapeHtml(r.url)}" target="_blank" title="${escapeHtml(r.url)}">${escapeHtml(fileName)}</a></td>
                <td><span class="status-badge ${statusClass}">${r.status}</span></td>
                <td class="secret-match" title="${escapeHtml(r.matchSnippet)}">${escapeHtml(r.matchSnippet)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        responseSearchResults.innerHTML = html;

        // Render Pagination Controls
        renderPagination(filteredResults.length, currentResponseSearchPage, container, (newPage) => {
            currentResponseSearchPage = newPage;
            renderResponseSearchResults(results);
        });
    }

    // Response Search Logic
    const responseSearchBtn = document.getElementById('response-search-btn');
    const responseSearchInput = document.getElementById('response-search-input');
    const responseSearchRegexBtn = document.getElementById('response-search-regex-btn');
    const responseSearchAiBtn = document.getElementById('response-search-ai-btn');
    const responseSearchFetch = document.getElementById('response-search-fetch');
    const responseSearchResults = document.getElementById('response-search-results');

    let isRegexMode = false;

    // Initial State: Hide AI button
    if (responseSearchAiBtn) {
        responseSearchAiBtn.style.display = 'none';
    }

    // Toggle Regex Mode
    if (responseSearchRegexBtn) {
        responseSearchRegexBtn.addEventListener('click', () => {
            isRegexMode = !isRegexMode;
            responseSearchRegexBtn.classList.toggle('active', isRegexMode);
            responseSearchInput.placeholder = isRegexMode ? 'Search with Regex...' : 'Search in responses...';

            // Toggle AI Button
            if (responseSearchAiBtn) {
                responseSearchAiBtn.style.display = isRegexMode ? 'flex' : 'none';
            }
        });
    }

    // AI Regex Generation
    if (responseSearchAiBtn) {
        responseSearchAiBtn.addEventListener('click', async () => {
            const description = responseSearchInput.value.trim();
            if (!description) {
                alert('Please enter a description of what you want to find (e.g., "email addresses").');
                return;
            }

            // UI Loading State
            const originalIcon = responseSearchAiBtn.innerHTML;
            responseSearchAiBtn.innerHTML = '<span class="loading-spinner-small">⏳</span>';
            responseSearchAiBtn.disabled = true;
            responseSearchInput.disabled = true;

            try {
                const { streamExplanationWithSystem, getAISettings } = await import('../ai/index.js');
                const { apiKey } = getAISettings();

                if (!apiKey) {
                    alert('Please configure your AI API Key in Settings first.');
                    return;
                }

                const systemPrompt = "You are a regex expert. Convert the user's description into a JavaScript-compatible Regular Expression. Return ONLY the regex pattern (without slashes or flags). Do not include any explanation.";
                let generatedRegex = '';

                await streamExplanationWithSystem(apiKey, getAISettings().model, systemPrompt, description, (text) => {
                    generatedRegex = text.trim();
                }, getAISettings().provider);

                // Clean up result (remove backticks or extra text if any)
                generatedRegex = generatedRegex.replace(/^`+|`+$/g, '').trim();

                if (generatedRegex) {
                    responseSearchInput.value = generatedRegex;

                    // Enable Regex Mode automatically
                    if (!isRegexMode) {
                        isRegexMode = true;
                        if (responseSearchRegexBtn) responseSearchRegexBtn.classList.add('active');
                        responseSearchInput.placeholder = 'Search with Regex...';
                    }
                }

            } catch (e) {
                console.error('AI Regex generation failed:', e);
                alert('Failed to generate regex: ' + e.message);
            } finally {
                responseSearchAiBtn.innerHTML = originalIcon;
                responseSearchAiBtn.disabled = false;
                responseSearchInput.disabled = false;
                responseSearchInput.focus();
            }
        });
    }

    if (responseSearchBtn) {
        responseSearchBtn.addEventListener('click', async () => {
            const searchTerm = responseSearchInput.value;
            if (!searchTerm) return;

            const fetchFresh = responseSearchFetch.checked;
            const selectedDomain = domainFilter ? domainFilter.value : 'all';

            // UI Loading State
            responseSearchBtn.disabled = true;
            responseSearchBtn.textContent = 'Searching...';

            // Reset pagination
            currentResponseSearchPage = 1;
            currentResponseSearchResults = [];

            // Show progress bar if fetching
            if (fetchFresh) {
                extractorProgress.style.display = 'block';
                extractorProgressBar.style.setProperty('--progress', '0%');
                extractorProgressText.textContent = 'Preparing requests...';
            }

            try {
                // Import state to access requests
                const { state } = await import('../../core/state.js');

                // Filter requests
                const requestsToSearch = [];
                const seenSignatures = new Set();

                state.requests.forEach(req => {
                    // Domain Filter
                    if (selectedDomain !== 'all' && getDomainFromUrl(req.pageUrl || req.request.url) !== selectedDomain) {
                        return;
                    }

                    // Deduplication
                    const signature = `${req.request.method}|${req.request.url}|${req.request.postData ? req.request.postData.text : ''}`;
                    if (!seenSignatures.has(signature)) {
                        seenSignatures.add(signature);
                        requestsToSearch.push(req);
                    }
                });

                if (requestsToSearch.length === 0) {
                    responseSearchResults.innerHTML = '<div class="empty-state">No requests found to search.</div>';
                    currentResponseSearchResults = [];
                    renderResponseSearchResults(currentResponseSearchResults);
                    return;
                }

                let processed = 0;

                // Helper to check match and collect results
                const checkMatch = (content, url, method, status) => {
                    let matchFound = false;
                    let matchSnippet = '';

                    if (isRegexMode) {
                        try {
                            const regex = new RegExp(searchTerm, 'g');
                            const match = regex.exec(content);
                            if (match) {
                                matchFound = true;
                                const start = Math.max(0, match.index - 20);
                                const end = Math.min(content.length, match.index + match[0].length + 20);
                                matchSnippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
                            }
                        } catch (e) {
                            console.error('Invalid regex:', e);
                            return false;
                        }
                    } else {
                        const index = content.indexOf(searchTerm);
                        if (index !== -1) {
                            matchFound = true;
                            const start = Math.max(0, index - 20);
                            const end = Math.min(content.length, index + searchTerm.length + 20);
                            matchSnippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
                        }
                    }

                    if (matchFound) {
                        currentResponseSearchResults.push({
                            method: method,
                            url: url,
                            status: status,
                            matchSnippet: matchSnippet
                        });
                    }
                    return matchFound;
                };

                for (const req of requestsToSearch) {
                    let content = '';
                    let status = req.response.status;

                    if (fetchFresh) {
                        try {
                            const response = await fetch(req.request.url, {
                                method: req.request.method,
                                headers: req.request.headers.reduce((acc, h) => ({ ...acc, [h.name]: h.value }), {}),
                                body: req.request.postData ? req.request.postData.text : undefined
                            });
                            content = await response.text();
                            status = response.status;
                        } catch (e) {
                            console.error('Fetch failed for', req.request.url, e);
                            content = ''; // Skip if fetch fails
                        }
                    } else {
                        // Use stored content if available (HAR)
                        // Note: HAR content.text might be unavailable if not captured fully
                        content = req.response.content.text || '';

                        // If empty, try to get from network (if supported by devtools API in this context)
                        if (!content && req.getContent) {
                            content = await new Promise(resolve => req.getContent(resolve));
                        }
                    }

                    if (content) {
                        checkMatch(content, req.request.url, req.request.method, status);
                    }

                    processed++;
                    if (fetchFresh) {
                        const percent = Math.round((processed / requestsToSearch.length) * 100);
                        extractorProgressBar.style.setProperty('--progress', `${percent}%`);
                        extractorProgressText.textContent = `Searching ${processed}/${requestsToSearch.length}...`;
                    }
                }

                // Render results with pagination
                renderResponseSearchResults(currentResponseSearchResults);

                // Update domain filter with domains from results
                if (activeTab === 'response-search') {
                    populateDomainFilter();
                }

            } catch (e) {
                console.error('Search failed:', e);
                responseSearchResults.innerHTML = `<div class="empty-state error">Search failed: ${e.message}</div>`;
                currentResponseSearchResults = [];
            } finally {
                responseSearchBtn.disabled = false;
                responseSearchBtn.textContent = 'Search';
                if (fetchFresh) {
                    setTimeout(() => {
                        extractorProgress.style.display = 'none';
                    }, 1000);
                }
            }
        });
    }

    // Helper: Render Pagination Controls
    function renderPagination(totalItems, currentPage, container, onPageChange) {
        if (!container) return;

        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

        if (totalPages <= 1) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = '';

        // Previous Button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'icon-btn';
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg>';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => {
            if (currentPage > 1) onPageChange(currentPage - 1);
        };

        // Page Info
        const pageInfo = document.createElement('span');
        pageInfo.className = 'pagination-info';
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        pageInfo.style.margin = '0 10px';
        pageInfo.style.fontSize = '12px';
        pageInfo.style.alignSelf = 'center';

        // Next Button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'icon-btn';
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg>';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => {
            if (currentPage < totalPages) onPageChange(currentPage + 1);
        };

        container.appendChild(prevBtn);
        container.appendChild(pageInfo);
        container.appendChild(nextBtn);
    }
}
