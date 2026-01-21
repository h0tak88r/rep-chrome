// Response Comparator for Auth Analyzer
// Compares responses and detects authorization bypasses

/**
 * Compares HTTP responses and detects authorization bypasses
 */
export class ResponseComparator {
    /**
     * Compare two responses
     * @returns 'SAME', 'SIMILAR', or 'DIFFERENT'
     */
    compare(originalResponse, replayedResponse) {
        console.log('[Comparator] ===== STARTING COMPARISON =====');
        console.log('[Comparator] Original status:', originalResponse.status);
        console.log('[Comparator] Replayed status:', replayedResponse.status);
        console.log('[Comparator] Status match:', originalResponse.status === replayedResponse.status);

        const statusMatch = originalResponse.status === replayedResponse.status;

        // Handle error responses
        if (replayedResponse.error) {
            console.log('[Comparator] Replayed response has error, returning ERROR');
            return 'ERROR';
        }

        console.log('[Comparator] Original body length:', originalResponse.body?.length || 0);
        console.log('[Comparator] Replayed body length:', replayedResponse.body?.length || 0);
        console.log('[Comparator] Original body preview:', (originalResponse.body || '').substring(0, 200));
        console.log('[Comparator] Replayed body preview:', (replayedResponse.body || '').substring(0, 200));

        // Normalize bodies for comparison
        const normalizedOriginal = this.normalizeBody(originalResponse.body);
        const normalizedReplayed = this.normalizeBody(replayedResponse.body);

        console.log('[Comparator] Normalized original length:', normalizedOriginal?.length || 0);
        console.log('[Comparator] Normalized replayed length:', normalizedReplayed?.length || 0);
        console.log('[Comparator] Normalized original preview:', normalizedOriginal.substring(0, 200));
        console.log('[Comparator] Normalized replayed preview:', normalizedReplayed.substring(0, 200));
        console.log('[Comparator] Bodies match after normalization:', normalizedOriginal === normalizedReplayed);

        // Same body and status (after normalization)
        if (statusMatch && normalizedOriginal === normalizedReplayed) {
            console.log('[Comparator] ✅ Result: SAME (status + normalized body match)');
            return 'SAME';
        }

        // Similar: same status + ±5% body length
        if (statusMatch) {
            const originalLength = normalizedOriginal?.length || 0;
            const replayedLength = normalizedReplayed?.length || 0;

            if (originalLength === 0 && replayedLength === 0) {
                console.log('[Comparator] ✅ Result: SAME (both empty)');
                return 'SAME';
            }

            const lengthDiff = Math.abs(originalLength - replayedLength);
            const lengthPercent = lengthDiff / Math.max(originalLength, 1);

            console.log('[Comparator] Length difference:', lengthDiff, 'bytes');
            console.log('[Comparator] Length difference %:', (lengthPercent * 100).toFixed(2) + '%');

            // User requested: If status is same, but body different -> SIMILAR (Warning)
            // This is to catch cases where successful requests (200 OK) happen but content varies slightly (timestamps, etc)
            // independent of the length difference.
            console.log('[Comparator] ⚠️ Result: SIMILAR (Status match, body content different)');
            return 'SIMILAR';
        }

        console.log('[Comparator] ❌ Result: DIFFERENT');
        return 'DIFFERENT';
    }

    /**
     * Normalize response body for comparison
     * Handles JSON prettification, whitespace, and formatting differences
     */
    normalizeBody(body) {
        if (!body) {
            console.log('[Comparator] Normalizing empty body');
            return '';
        }

        console.log('[Comparator] Attempting JSON parse...');
        // Try to parse as JSON - if it works, re-serialize in canonical form
        try {
            const parsed = JSON.parse(body);
            console.log('[Comparator] ✓ JSON parse successful');
            // Serialize with sorted keys for deterministic comparison
            const normalized = JSON.stringify(this.sortObject(parsed));
            console.log('[Comparator] Normalized JSON length:', normalized.length);
            return normalized;
        } catch (e) {
            console.log('[Comparator] ✗ JSON parse failed, treating as plain text');
            // Not JSON, normalize whitespace
            const normalized = body
                .replace(/\s+/g, ' ')  // Collapse all whitespace to single spaces
                .replace(/>\s+</g, '><')  // Remove whitespace between HTML tags
                .trim();
            console.log('[Comparator] Normalized text length:', normalized.length);
            return normalized;
        }
    }

    /**
     * Deep sort object keys for consistent JSON comparison
     */
    sortObject(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObject(item));
        }

        const sorted = {};
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = this.sortObject(obj[key]);
        });
        return sorted;
    }

    /**
     * Detect authorization bypass
     */
    detectBypass(originalResponse, replayedResponse, sessionPrivilege) {
        const result = this.compare(originalResponse, replayedResponse);

        // Error responses are not bypasses
        if (result === 'ERROR') {
            return {
                bypass: false,
                severity: 'NONE',
                result,
                message: 'Request failed'
            };
        }

        // If low-privilege session gets SAME/SIMILAR response, it's a potential bypass
        if (sessionPrivilege === 'low' && (result === 'SAME' || result === 'SIMILAR')) {
            return {
                bypass: true,
                severity: result === 'SAME' ? 'HIGH' : 'MEDIUM',
                result,
                message: `Low-privilege session received ${result} response as high-privilege session`
            };
        }

        // If medium-privilege session gets SAME response, it might be a bypass
        if (sessionPrivilege === 'medium' && result === 'SAME') {
            return {
                bypass: true,
                severity: 'MEDIUM',
                result,
                message: 'Medium-privilege session received SAME response as high-privilege session'
            };
        }

        // Expected behavior: DIFFERENT response for lower privileges
        return {
            bypass: false,
            severity: 'NONE',
            result,
            message: 'Authorization working as expected'
        };
    }

    /**
     * Calculate response diff
     */
    calculateDiff(original, replayed) {
        // Simple line-by-line diff
        const originalLines = (original.body || '').split('\n');
        const replayedLines = (replayed.body || '').split('\n');

        const diff = [];
        const maxLines = Math.max(originalLines.length, replayedLines.length);

        for (let i = 0; i < maxLines; i++) {
            const originalLine = originalLines[i] || '';
            const replayedLine = replayedLines[i] || '';

            if (originalLine === replayedLine) {
                diff.push({ type: 'same', original: originalLine, replayed: replayedLine });
            } else {
                diff.push({ type: 'different', original: originalLine, replayed: replayedLine });
            }
        }

        return diff;
    }

    /**
     * Get bypass severity color
     */
    getSeverityColor(severity) {
        switch (severity) {
            case 'HIGH':
                return '#f44336'; // Red
            case 'MEDIUM':
                return '#ff9800'; // Orange
            case 'LOW':
                return '#ffeb3b'; // Yellow
            default:
                return '#4caf50'; // Green
        }
    }

    /**
     * Get result badge text
     */
    getResultBadge(result) {
        switch (result) {
            case 'SAME':
                return '🔴 SAME';
            case 'SIMILAR':
                return '🟡 SIMILAR';
            case 'DIFFERENT':
                return '🟢 DIFFERENT';
            case 'ERROR':
                return '⚠️ ERROR';
            default:
                return '❓ UNKNOWN';
        }
    }
}
