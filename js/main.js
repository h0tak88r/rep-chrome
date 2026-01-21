// Main Entry Point
import { state, actions } from './core/state.js';
import { events, EVENT_NAMES } from './core/events.js';
import {
    initUI, elements,
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
import { initExtractorUI } from './features/extractors/index.js';
import { setupAIFeatures } from './features/ai/index.js';
import { setupLLMChat } from './features/llm-chat/index.js';
import { handleSendRequest } from './network/handler.js';
import { initSearch } from './search/index.js';
import { initAuthAnalyzer } from './features/auth-analyzer/index.js';
import { initAuthAnalyzerPanel } from './features/auth-analyzer/panel.js';
import { initAuthAnalyzerConfigPanel } from './features/auth-analyzer/config-panel.js';
import { initAuthAnalyzerComparison } from './features/auth-analyzer/comparison-display.js';

// UI Modules
import { setupBlockControls } from './ui/block-controls.js';
import { setupFilters } from './ui/filters.js';
import { setupSidebar } from './ui/sidebar.js';
import { setupViewTabs } from './ui/view-tabs.js';
import { setupRawRequestEditor, initLayoutToggle, initPreviewControls } from './ui/request-editor.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI Elements
    initUI();

    // Ensure all modals are closed by default
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });

    // Initialize Features
    initTheme();
    initMultiTabCapture();
    initExtractorUI();
    setupBulkReplay();
    setupAIFeatures(elements);
    setupLLMChat(elements);
    initSearch();

    // Initialize Auth Analyzer
    console.log('[Auth Analyzer] Initializing...');
    const authAnalyzer = initAuthAnalyzer();
    window.authAnalyzer = authAnalyzer;
    console.log('[Auth Analyzer] Instance created:', authAnalyzer);

    // Initialize Auth Analyzer Panel
    const authAnalyzerPanel = initAuthAnalyzerPanel();
    window.authAnalyzerPanel = authAnalyzerPanel;

    // Setup Auth Analyzer toggle button
    const authAnalyzerToggleBtn = document.getElementById('auth-analyzer-toggle-btn');
    const authAnalyzerBadge = document.getElementById('auth-analyzer-badge');
    if (authAnalyzerToggleBtn) {
        console.log('[Auth Analyzer] Toggle button found, attaching handler');
        authAnalyzerToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Auth Analyzer] Toggle button clicked!');
            console.log('[Auth Analyzer] Panel object:', authAnalyzerPanel);
            console.log('[Auth Analyzer] Panel visible:', authAnalyzerPanel?.isVisible);

            if (authAnalyzerPanel) {
                authAnalyzerPanel.toggle();
                authAnalyzerToggleBtn.classList.toggle('active', authAnalyzerPanel.isVisible);
                console.log('[Auth Analyzer] Panel toggled. New state:', authAnalyzerPanel.isVisible);
            } else {
                console.error('[Auth Analyzer] Panel object not initialized!');
            }
        });

        // Update badge when results are added
        events.on('AUTH_ANALYZER_RESULT', () => {
            const criticalCount = authAnalyzerPanel.getCriticalCount();
            if (criticalCount > 0) {
                authAnalyzerBadge.textContent = criticalCount;
                authAnalyzerBadge.style.display = 'inline-block';
            } else {
                authAnalyzerBadge.style.display = 'none';
            }
        });
    } else {
        console.error('[Auth Analyzer] Toggle button NOT FOUND in DOM!');
    }

    // Initialize Auth Analyzer Configuration Panel
    const authAnalyzerConfigPanel = initAuthAnalyzerConfigPanel(authAnalyzer);
    window.authAnalyzerConfigPanel = authAnalyzerConfigPanel;

    // Initialize Auth Analyzer Comparison Display
    initAuthAnalyzerComparison();

    // Promotional Banner
    if (elements.promoBanner && elements.closeBannerBtn) {
        // Check if banner was previously dismissed
        const bannerDismissed = localStorage.getItem('repPlusBannerDismissed');
        if (bannerDismissed === 'true') {
            elements.promoBanner.classList.add('hidden');
        }

        // Handle banner dismissal
        elements.closeBannerBtn.addEventListener('click', () => {
            elements.promoBanner.classList.add('hidden');
            localStorage.setItem('repPlusBannerDismissed', 'true');
        });
    }

    // Setup Network Listener (Current Tab)
    const processCapturedRequest = (request) => {
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

        // Use action to add request (automatically emits events)
        const index = actions.request.add(request);
    };

    setupNetworkListener((request) => {
        if (state.blockRequests) {
            const hasActiveList = state.requests.length > 0;
            const hasQueued = state.blockedQueue.length > 0;
            if (!hasActiveList && !hasQueued) {
                // Show the first blocked request immediately so the user can step through
                processCapturedRequest(request);
            } else {
                state.blockedQueue.push(request);
                // Emit event to update block buttons
                events.emit('block-queue:updated');
            }
            return;
        }
        processCapturedRequest(request);
    });

    // Setup UI Components
    setupResizeHandle();
    setupSidebarResize();
    setupContextMenu();
    setupUndoRedo();

    // Setup UI Features
    setupBlockControls(processCapturedRequest);
    setupFilters();
    setupSidebar();
    setupViewTabs();
    initPreviewControls();
    setupRawRequestEditor(elements.rawRequestInput, elements.sendBtn);
    initLayoutToggle(elements.layoutToggleBtn);

    // Send Request
    if (elements.sendBtn) {
        elements.sendBtn.addEventListener('click', handleSendRequest);
    }

    // Test with Auth Analyzer button
    const testAuthBtn = document.getElementById('test-auth-btn');
    if (testAuthBtn) {
        testAuthBtn.addEventListener('click', async () => {
            if (!authAnalyzer.enabled || !authAnalyzer.config.swapCookie) {
                alert('⚠️ Auth Analyzer not configured!\n\nPlease configure a test cookie first:\nMore (⋮) → Auth Analyzer');
                return;
            }

            // Find selected request from DOM
            const selectedItem = document.querySelector('.request-item.selected');
            if (!selectedItem) {
                alert('No request selected');
                return;
            }

            const requestIndex = parseInt(selectedItem.dataset.index);
            const request = state.requests[requestIndex];

            if (!request) {
                alert('Could not find request data');
                return;
            }
            testAuthBtn.disabled = true;
            testAuthBtn.textContent = '🔒 Testing...';

            try {
                await authAnalyzer.processRequest(request);
                testAuthBtn.textContent = '✅ Done';
                setTimeout(() => {
                    testAuthBtn.textContent = '🔒 Test Auth';
                    testAuthBtn.disabled = false;
                }, 1500);

                // Show results panel
                if (authAnalyzerPanel) {
                    authAnalyzerPanel.show();
                }
            } catch (err) {
                console.error('[Test Auth] Failed:', err);
                alert('Test failed: ' + err.message);
                testAuthBtn.textContent = '🔒 Test Auth';
                testAuthBtn.disabled = false;
            }
        });
    }

    // Remove Duplicates Toggle
    if (elements.removeDuplicatesBtn) {
        // Load saved preference (default: true/enabled)
        const removeDuplicatesEnabled = localStorage.getItem('rep_remove_duplicates') !== 'false';
        updateRemoveDuplicatesButton(removeDuplicatesEnabled);

        elements.removeDuplicatesBtn.addEventListener('click', () => {
            const currentState = localStorage.getItem('rep_remove_duplicates') !== 'false';
            const newState = !currentState;

            localStorage.setItem('rep_remove_duplicates', newState.toString());
            updateRemoveDuplicatesButton(newState);

            // If enabling, remove existing duplicates
            if (newState) {
                const removedCount = actions.request.removeDuplicates();
                if (removedCount > 0) {
                    console.log(`Removed ${removedCount} duplicate request${removedCount !== 1 ? 's' : ''}`);
                } else {
                    console.log('No duplicates found to remove');
                }
            }
        });
    }

    function updateRemoveDuplicatesButton(enabled) {
        if (!elements.removeDuplicatesBtn) return;

        if (enabled) {
            elements.removeDuplicatesBtn.classList.add('active');
            elements.removeDuplicatesBtn.title = 'Remove duplicate requests (enabled)';
        } else {
            elements.removeDuplicatesBtn.classList.remove('active');
            elements.removeDuplicatesBtn.title = 'Remove duplicate requests (disabled)';
        }
    }

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

    // More Menu Toggle
    const moreMenuBtn = document.getElementById('more-menu-btn');
    const moreMenu = document.getElementById('more-menu');
    if (moreMenuBtn && moreMenu) {
        moreMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moreMenu.classList.toggle('hidden');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!moreMenu.contains(e.target) && e.target !== moreMenuBtn) {
                moreMenu.classList.add('hidden');
            }
        });
    }

    // Export/Import (now in more menu)
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

    // Close more menu after clicking an item
    if (moreMenu) {
        moreMenu.addEventListener('click', (e) => {
            if (e.target.closest('.more-menu-item')) {
                setTimeout(() => {
                    moreMenu.classList.add('hidden');
                }, 100);
            }
        });
    }

    // Auth Analyzer Config Button (in More Menu)
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('#auth-analyzer-btn');
        if (btn) {
            console.log('[Auth Analyzer] Config button clicked');
            e.preventDefault();
            e.stopPropagation();

            if (window.authAnalyzerConfigPanel) {
                window.authAnalyzerConfigPanel.show();
                // Close more menu
                if (moreMenu) moreMenu.classList.add('hidden');
            } else {
                console.error('[Auth Analyzer] Config panel not initialized');
            }
        }
    });

    // History Navigation
    // Undo/Redo buttons
    if (elements.undoBtn) {
        elements.undoBtn.addEventListener('click', () => {
            if (state.undoStack.length <= 1) return;

            const currentContent = elements.rawRequestInput.innerText || elements.rawRequestInput.textContent;
            state.redoStack.push(currentContent);

            state.undoStack.pop();
            const previousContent = state.undoStack[state.undoStack.length - 1];

            if (previousContent !== undefined) {
                elements.rawRequestInput.textContent = previousContent;
                elements.rawRequestInput.innerHTML = highlightHTTP(previousContent);
                // Update undo/redo button states
                events.emit(EVENT_NAMES.UI_UPDATE_HISTORY_BUTTONS);
            }
        });
    }

    if (elements.redoBtn) {
        elements.redoBtn.addEventListener('click', () => {
            if (state.redoStack.length === 0) return;

            const nextContent = state.redoStack.pop();
            if (nextContent !== undefined) {
                state.undoStack.push(nextContent);
                elements.rawRequestInput.textContent = nextContent;
                elements.rawRequestInput.innerHTML = highlightHTTP(nextContent);
                // Update undo/redo button states
                events.emit(EVENT_NAMES.UI_UPDATE_HISTORY_BUTTONS);
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
