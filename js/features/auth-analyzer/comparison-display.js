/**
 * Auth Analyzer - Response Comparison Display
 * Shows both original and swapped responses when viewing Auth Analyzer results
 */

import { events, EVENT_NAMES } from '../../core/events.js';

let comparisonContainer = null;

/**
 * Initialize the comparison display
 */
export function initAuthAnalyzerComparison() {
    // Listen for request selection
    events.on(EVENT_NAMES.UI_REQUEST_SELECTED, (request) => {
        // Check if this request has swapped data
        const swappedData = window.__authAnalyzerSwappedResponse;

        if (swappedData && swappedData.requestId === request.id) {
            console.log('[Auth Comparison] Showing comparison for request:', request.id);
            showComparison(request, swappedData);
        } else {
            hideComparison();
        }
    });
}

/**
 * Show comparison view
 */
function showComparison(request, swappedData) {
    // Find or create comparison container
    if (!comparisonContainer) {
        comparisonContainer = document.createElement('div');
        comparisonContainer.id = 'auth-analyzer-comparison';
        comparisonContainer.style.cssText = `
            background: var(--bg-secondary);
            border-bottom: 2px solid var(--border-color);
            padding: 12px 16px;
            margin-bottom: 8px;
        `;
    }

    // Get comparison color
    const colors = {
        'SAME': '#f44336',
        'SIMILAR': '#ff9800',
        'DIFFERENT': '#4caf50'
    };
    const color = colors[swappedData.comparison] || '#999';
    const icon = {
        'SAME': '🔴',
        'SIMILAR': '🟠',
        'DIFFERENT': '🟢'
    }[swappedData.comparison] || '';

    // Build HTML
    comparisonContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--text-primary);">
                ${icon} Auth Analyzer Comparison
            </span>
            <span style="background: ${color}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                ${swappedData.comparison}
            </span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 11px;">
            <div>
                <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">
                    Original Response (Your Session)
                </div>
                <div style="color: var(--text-secondary);">
                    Status: <span style="font-family: monospace; color: var(--text-primary);">${request.response?.status || request.responseStatus || '?'}</span>
                </div>
            </div>
            <div>
                <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">
                    Swapped Response (Test Session)
                </div>
                <div style="color: var(--text-secondary);">
                    Status: <span style="font-family: monospace; color: var(--text-primary);">${swappedData.response.status || '?'}</span>
                </div>
            </div>
        </div>
        <div style="margin-top: 8px; font-size: 10px; color: var(--text-secondary); font-style: italic;">
            ${getComparisonMessage(swappedData.comparison)}
        </div>
    `;

    // Insert at the top of response content area
    const responseContent = document.querySelector('.response-content') ||
        document.querySelector('#response-content') ||
        document.querySelector('.panel-content');

    if (responseContent) {
        // Remove if already there
        const existing = document.getElementById('auth-analyzer-comparison');
        if (existing) existing.remove();

        // Insert at the beginning
        responseContent.insertBefore(comparisonContainer, responseContent.firstChild);
    }
}

/**
 * Hide comparison view
 */
function hideComparison() {
    if (comparisonContainer && comparisonContainer.parentNode) {
        comparisonContainer.parentNode.removeChild(comparisonContainer);
    }
}

/**
 * Get message based on comparison result
 */
function getComparisonMessage(comparison) {
    switch (comparison) {
        case 'SAME':
            return '⚠️ Responses are identical - potential authorization bypass detected!';
        case 'SIMILAR':
            return '⚠️ Responses are similar - manual review recommended';
        case 'DIFFERENT':
            return '✓ Responses are different - authorization appears to be enforced';
        default:
            return '';
    }
}
