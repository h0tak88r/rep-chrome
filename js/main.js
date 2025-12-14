// Main Entry Point
import { state, addRequest } from './core/state.js';
import {
    initUI, elements, renderRequestItem, filterRequests, updateHistoryButtons,
    clearAllRequestsUI, setupResizeHandle, setupSidebarResize, setupContextMenu,
    setupUndoRedo, captureScreenshot, exportRequests, importRequests, toggleAllGroups,
    toggleAllObjects
} from './ui/main-ui.js';
import { setupNetworkListener } from './network/capture.js';
import { setupBulkReplay } from './features/bulk-replay/index.js';
import { copyToClipboard } from './core/utils/dom.js';
import { renderDiff } from './core/utils/misc.js';
import { highlightHTTP, getHostname } from './core/utils/network.js';

// Feature Modules
import { initTheme } from './ui/theme.js';
import { initMultiTabCapture } from './network/multi-tab.js';
import { initExtractorUI } from './features/extractors/ui.js';
import { setupAIFeatures } from './features/ai/index.js';
import { handleSendRequest } from './network/handler.js';
import { initSearch } from './search/index.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI Elements
    initUI();

    // Initialize Features
    initTheme();
    initMultiTabCapture();
    initExtractorUI();
    setupBulkReplay();
    setupAIFeatures(elements);
    initSearch();

    // Promotional Banner
    const promoBanner = document.getElementById('promo-banner');
    const closeBannerBtn = document.getElementById('close-banner');

    // Check if banner was previously dismissed
    const bannerDismissed = localStorage.getItem('repPlusBannerDismissed');
    if (bannerDismissed === 'true') {
        promoBanner.classList.add('hidden');
    }

    // Handle banner dismissal
    if (closeBannerBtn) {
        closeBannerBtn.addEventListener('click', () => {
            promoBanner.classList.add('hidden');
            localStorage.setItem('repPlusBannerDismissed', 'true');
        });
    }

    // Setup Network Listener (Current Tab)
    setupNetworkListener((request) => {
        // Auto-star if group is starred
        const pageHostname = getHostname(request.pageUrl || request.request.url);
        const requestHostname = getHostname(request.request.url);

        if (state.starredPages.has(pageHostname)) {
            // Only auto-star if it's a first-party request
            if (pageHostname === requestHostname) {
                request.starred = true;
            }
        }

        if (state.starredDomains.has(requestHostname)) {
            request.starred = true;
        }

        const index = addRequest(request);
        renderRequestItem(request, index);
    });

    // Setup UI Components
    setupResizeHandle();
    setupSidebarResize();
    setupContextMenu();
    setupUndoRedo();

    // Event Listeners

    // Send Request
    if (elements.sendBtn) {
        elements.sendBtn.addEventListener('click', handleSendRequest);
    }

    // Search & Filter
    if (elements.searchBar) {
        elements.searchBar.addEventListener('input', (e) => {
            state.currentSearchTerm = e.target.value.toLowerCase();
            filterRequests();
        });
    }

    if (elements.regexToggle) {
        elements.regexToggle.addEventListener('click', () => {
            state.useRegex = !state.useRegex;
            elements.regexToggle.classList.toggle('active', state.useRegex);
            elements.regexToggle.title = state.useRegex
                ? 'Regex mode enabled (click to disable)'
                : 'Toggle Regex Mode (enable to use regex patterns)';
            filterRequests();
        });
    }

    document.querySelectorAll('.filter-btn:not(#color-filter-btn)').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn:not(#color-filter-btn)').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.filter;
            filterRequests();
        });
    });

    // Clear All
    if (elements.clearAllBtn) {
        elements.clearAllBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all requests?')) {
                clearAllRequestsUI();
            }
        });
    }

    // Toggle Groups
    if (elements.toggleGroupsBtn) {
        elements.toggleGroupsBtn.addEventListener('click', toggleAllGroups);
    }

    // Toggle Objects (for JSON responses)
    if (elements.toggleObjectsBtn) {
        elements.toggleObjectsBtn.addEventListener('click', toggleAllObjects);
    }

    // Export/Import
    if (elements.exportBtn) elements.exportBtn.addEventListener('click', exportRequests);
    if (elements.importBtn) elements.importBtn.addEventListener('click', () => elements.importFile.click());
    if (elements.importFile) {
        elements.importFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importRequests(e.target.files[0]);
                e.target.value = ''; // Reset
            }
        });
    }

    // History Navigation
    if (elements.historyBackBtn) {
        elements.historyBackBtn.addEventListener('click', () => {
            if (state.historyIndex > 0) {
                state.historyIndex--;
                const item = state.requestHistory[state.historyIndex];
                elements.rawRequestInput.innerText = item.rawText;
                elements.useHttpsCheckbox.checked = item.useHttps;
                updateHistoryButtons();
            }
        });
    }

    if (elements.historyFwdBtn) {
        elements.historyFwdBtn.addEventListener('click', () => {
            if (state.historyIndex < state.requestHistory.length - 1) {
                state.historyIndex++;
                const item = state.requestHistory[state.historyIndex];
                elements.rawRequestInput.innerText = item.rawText;
                elements.useHttpsCheckbox.checked = item.useHttps;
                updateHistoryButtons();
            }
        });
    }

    // Copy Buttons
    if (elements.copyReqBtn) {
        elements.copyReqBtn.addEventListener('click', () => {
            copyToClipboard(elements.rawRequestInput.innerText, elements.copyReqBtn);
        });
    }

    if (elements.copyResBtn) {
        elements.copyResBtn.addEventListener('click', () => {
            copyToClipboard(elements.rawResponseDisplay.innerText, elements.copyResBtn);
        });
    }

    // Screenshot
    if (elements.screenshotBtn) {
        elements.screenshotBtn.addEventListener('click', captureScreenshot);
    }

    // Diff Toggle
    if (elements.showDiffCheckbox) {
        elements.showDiffCheckbox.addEventListener('change', () => {
            if (state.regularRequestBaseline && state.currentResponse) {
                if (elements.showDiffCheckbox.checked) {
                    elements.rawResponseDisplay.innerHTML = renderDiff(state.regularRequestBaseline, state.currentResponse);
                } else {
                    elements.rawResponseDisplay.innerHTML = highlightHTTP(state.currentResponse);
                }
            }
        });
    }
});
