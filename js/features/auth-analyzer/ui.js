// Auth Analyzer UI Controller
// Handles the side panel UI for authorization testing

import { getAuthAnalyzer } from './index.js';
import { events } from '../../core/events.js';

export class AuthAnalyzerUI {
    constructor() {
        this.authAnalyzer = getAuthAnalyzer();
        this.panel = document.getElementById('auth-analyzer-panel');
        this.sessionModal = document.getElementById('auth-session-modal');
        this.currentEditingSession = null;

        this.init();
    }

    init() {
        // Panel controls
        document.getElementById('auth-analyzer-close')?.addEventListener('click', () => this.closePanel());
        document.getElementById('auth-start-btn')?.addEventListener('click', () => this.startTesting());
        document.getElementById('auth-stop-btn')?.addEventListener('click', () => this.stopTesting());
        document.getElementById('auth-clear-results-btn')?.addEventListener('click', () => this.clearResults());

        // Session controls
        document.getElementById('auth-add-session-btn')?.addEventListener('click', () => this.showAddSessionModal());
        document.getElementById('auth-session-save')?.addEventListener('click', () => this.saveSession());
        document.getElementById('auth-session-cancel')?.addEventListener('click', () => this.closeSessionModal());

        // Modal close
        this.sessionModal?.querySelector('.modal-close')?.addEventListener('click', () => this.closeSessionModal());

        // Listen for Auth Analyzer events
        events.on('AUTH_ANALYZER_RESULT', (result) => this.addResult(result));
        events.on('AUTH_ANALYZER_SESSION_ADDED', () => this.renderSessions());
        events.on('AUTH_ANALYZER_SESSION_REMOVED', () => this.renderSessions());
        events.on('AUTH_ANALYZER_SESSION_UPDATED', () => this.renderSessions());

        // Initial render
        this.renderSessions();
        this.renderResults();
    }

    openPanel() {
        this.panel.classList.add('open');
    }

    closePanel() {
        this.panel.classList.remove('open');
    }

    togglePanel() {
        if (this.panel.classList.contains('open')) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    }

    startTesting() {
        this.authAnalyzer.start();
        document.getElementById('auth-start-btn').style.display = 'none';
        document.getElementById('auth-stop-btn').style.display = 'flex';
        document.getElementById('auth-status-text').textContent = 'Running';
        document.querySelector('.auth-status').classList.add('running');
    }

    stopTesting() {
        this.authAnalyzer.stop();
        document.getElementById('auth-start-btn').style.display = 'flex';
        document.getElementById('auth-stop-btn').style.display = 'none';
        document.getElementById('auth-status-text').textContent = 'Stopped';
        document.querySelector('.auth-status').classList.remove('running');
    }

    clearResults() {
        this.authAnalyzer.clearResults();
        this.renderResults();
    }

    showAddSessionModal() {
        this.currentEditingSession = null;
        document.getElementById('auth-session-modal-title').textContent = 'Add Session';
        document.getElementById('auth-session-name').value = '';
        document.getElementById('auth-session-privilege').value = 'low';
        document.getElementById('auth-session-color').value = this.getRandomColor();
        document.getElementById('auth-session-cookie').value = '';
        this.sessionModal.style.display = 'flex';
    }

    closeSessionModal() {
        this.sessionModal.style.display = 'none';
    }

    saveSession() {
        const name = document.getElementById('auth-session-name').value.trim();
        const privilege = document.getElementById('auth-session-privilege').value;
        const color = document.getElementById('auth-session-color').value;
        const cookie = document.getElementById('auth-session-cookie').value.trim();

        if (!name) {
            alert('Please enter a session name');
            return;
        }

        const { Session } = this.authAnalyzer;
        const session = new Session(name, color);
        session.privilege = privilege;

        if (cookie) {
            session.headers = { 'Cookie': cookie };
        } else {
            session.headersToRemove = ['Cookie'];
        }

        this.authAnalyzer.addSession(session);
        this.closeSessionModal();
    }

    renderSessions() {
        const container = document.getElementById('auth-sessions-list');
        const sessions = this.authAnalyzer.sessionManager.sessions;

        if (sessions.length === 0) {
            container.innerHTML = '<div class="empty-state-small">No sessions. Click "+ Add" to create one.</div>';
            return;
        }

        container.innerHTML = sessions.map(session => `
            <div class="auth-session-card ${session.active ? '' : 'inactive'}" 
                 style="border-left-color: ${session.color}">
                <div class="auth-session-header">
                    <span class="auth-session-name">${this.escapeHtml(session.name)}</span>
                    <div class="auth-session-actions">
                        <button onclick="window.authAnalyzerUI.toggleSession('${session.id}')" title="Toggle active">
                            ${session.active ? '✓' : '○'}
                        </button>
                        <button onclick="window.authAnalyzerUI.removeSession('${session.id}')" title="Remove">
                            ×
                        </button>
                    </div>
                </div>
                <div class="auth-session-info">
                    <span class="auth-session-privilege">${session.privilege.toUpperCase()}</span>
                    ${session.parameters.length} parameters
                </div>
            </div>
        `).join('');
    }

    renderResults() {
        const container = document.getElementById('auth-results-list');
        const countEl = document.getElementById('auth-results-count');
        const results = this.authAnalyzer.results;

        countEl.textContent = results.length;

        if (results.length === 0) {
            container.innerHTML = '<div class="empty-state-small">No results. Start testing to see checks.</div>';
            return;
        }

        container.innerHTML = results.slice(-20).reverse().map(result => {
            const url = new URL(result.originalRequest.url);
            const bypasses = result.sessionResults.filter(sr => sr.comparison?.bypass).length;

            return `
                <div class="auth-result-card">
                    <div class="auth-result-header">
                        <span class="auth-result-method">${result.originalRequest.method}</span>
                        <span class="auth-result-url" title="${this.escapeHtml(url.pathname)}">
                            ${this.escapeHtml(url.pathname)}
                        </span>
                        ${bypasses > 0 ? `<span style="color: #f44336; font-weight: 600;">⚠️ ${bypasses}</span>` : ''}
                    </div>
                    <div class="auth-result-sessions">
                        ${result.sessionResults.map(sr => `
                            <div class="auth-result-session">
                                <span class="auth-result-session-name">${this.escapeHtml(sr.sessionName)}</span>
                                <span class="auth-result-status ${sr.comparison.result.toLowerCase()}">
                                    ${sr.comparison.result}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    addResult(result) {
        this.renderResults();

        // Show notification if bypass detected
        const bypasses = result.sessionResults.filter(sr => sr.comparison?.bypass);
        if (bypasses.length > 0) {
            console.warn(`[Auth Analyzer] 🔴 Bypass detected: ${result.originalRequest.url}`);
            bypasses.forEach(sr => {
                console.warn(`  - ${sr.sessionName}: ${sr.comparison.severity} severity`);
            });
        }
    }

    toggleSession(sessionId) {
        this.authAnalyzer.toggleSession(sessionId);
    }

    removeSession(sessionId) {
        if (confirm('Remove this session?')) {
            this.authAnalyzer.removeSession(sessionId);
        }
    }

    getRandomColor() {
        const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize and expose globally
let authAnalyzerUIInstance = null;

export function initAuthAnalyzerUI() {
    if (!authAnalyzerUIInstance) {
        authAnalyzerUIInstance = new AuthAnalyzerUI();
        window.authAnalyzerUI = authAnalyzerUIInstance; // Expose for onclick handlers
    }
    return authAnalyzerUIInstance;
}

export function getAuthAnalyzerUI() {
    return authAnalyzerUIInstance;
}
