// Network Operations
import { events, EVENT_NAMES } from '../core/events.js';

export function setupNetworkListener(onRequestCaptured) {
    // Get the current page URL once at setup
    let currentPageUrl = '';
    if (chrome.devtools && chrome.devtools.inspectedWindow) {
        chrome.devtools.inspectedWindow.eval('window.location.href', (result, isException) => {
            if (!isException && result) {
                currentPageUrl = result;
            }
        });
    }

    // Update page URL when navigation occurs
    chrome.devtools.network.onNavigated.addListener((url) => {
        currentPageUrl = url;
    });

    chrome.devtools.network.onRequestFinished.addListener((request) => {
        // Filter out data URLs or extension schemes
        if (!request.request.url.startsWith('http')) return;

        // Filter out requests sent by rep+ extension (replayed requests)
        // Check if request has our custom header
        if (request.request.headers) {
            const hasRepPlusHeader = request.request.headers.some(h =>
                (h.name === 'X-Rep-Plus-Replay' || h.name.toLowerCase() === 'x-rep-plus-replay') &&
                h.value === 'true'
            );
            if (hasRepPlusHeader) {
                return; // Skip requests sent by our extension
            }
        }

        // Filter out Chrome extension requests
        // Extension IDs are 32-character alphanumeric strings
        const extensionIdPattern = /^[a-z]{32}$/i;
        try {
            const urlObj = new URL(request.request.url);
            const hostname = urlObj.hostname.toLowerCase();

            // Check if hostname is an extension ID (32 alphanumeric chars)
            // or contains chrome-extension:// scheme
            if (extensionIdPattern.test(hostname) ||
                request.request.url.startsWith('chrome-extension://') ||
                request.request.url.startsWith('chrome://') ||
                request.request.url.startsWith('moz-extension://')) {
                return;
            }
        } catch (e) {
            // If URL parsing fails, continue with other checks
        }

        // Filter out static resources (JS, CSS, images, fonts, etc.)
        const url = request.request.url.toLowerCase();
        const staticExtensions = [
            '.css', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
            '.woff', '.woff2', '.ttf', '.eot', '.otf',
            '.mp4', '.webm', '.mp3', '.wav',
            '.pdf'
        ];

        // Check if URL ends with any static extension
        const isStatic = staticExtensions.some(ext => {
            return url.endsWith(ext) || url.includes(ext + '?');
        });

        if (isStatic) {
            // console.log('Skipping static resource:', request.request.url);
            return;
        }

        // Store the capture time for relative time display
        request.capturedAt = Date.now();

        // Store the page URL that this request belongs to
        // Filter out requests from extension contexts
        const pageUrl = currentPageUrl || request.request.url;

        // Skip if pageUrl is from an extension (chrome-extension:// or extension ID hostname)
        try {
            const pageUrlObj = new URL(pageUrl);
            const pageHostname = pageUrlObj.hostname.toLowerCase();
            if (extensionIdPattern.test(pageHostname) ||
                pageUrl.startsWith('chrome-extension://') ||
                pageUrl.startsWith('chrome://') ||
                pageUrl.startsWith('moz-extension://')) {
                return;
            }
        } catch (e) {
            // If URL parsing fails, continue
        }

        request.pageUrl = pageUrl;

        // Fetch response content so we can show it without switching tabs
        // Wrap getContent in a promise with timeout to ensure we don't hang
        const getContentPromise = new Promise((resolve) => {
            let resolved = false;

            // Timeout after 1 second
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    // console.warn('getContent timed out for', request.request.url);
                    resolve({ body: null, encoding: null });
                }
            }, 1000);

            try {
                request.getContent((body, encoding) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeoutId);
                        resolve({ body, encoding });
                    }
                });
            } catch (e) {
                // console.error('getContent threw error', e);
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    resolve({ body: null, encoding: null });
                }
            }
        });

        getContentPromise.then(({ body, encoding }) => {
            const responseStatus = request.response?.status || request.response?.statusCode || '';
            const responseStatusText = request.response?.statusText || '';
            const responseHeaders = request.response?.headers || [];

            const enhancedRequest = {
                ...request,
                responseBody: body || '',
                responseEncoding: encoding || '',
                responseStatus,
                responseStatusText,
                responseHeaders
            };

            onRequestCaptured(enhancedRequest);

            // Emit event for features that need to process responses (e.g., Auth Analyzer)
            console.log('[Network Capture] Emitting NETWORK_RESPONSE_RECEIVED for:', enhancedRequest.request.url);
            events.emit(EVENT_NAMES.NETWORK_RESPONSE_RECEIVED, enhancedRequest);
        });
    });
}

export function parseRequest(rawContent, useHttps) {
    const lines = rawContent.split('\n');
    if (lines.length === 0) {
        throw new Error('No content to send');
    }

    // Parse Request Line
    const requestLine = lines[0].trim();
    const reqLineParts = requestLine.split(' ');
    if (reqLineParts.length < 2) {
        throw new Error('Invalid Request Line. Format: METHOD PATH HTTP/1.1');
    }

    const method = reqLineParts[0].toUpperCase();
    const path = reqLineParts[1];

    // Split Headers and Body
    let headers = {};
    let bodyText = null;
    let isBody = false;
    let host = '';

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        if (!isBody) {
            if (line.trim() === '') {
                isBody = true;
                continue;
            }

            // Skip HTTP/2 pseudo-headers (start with :)
            if (line.trim().startsWith(':')) {
                continue;
            }

            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();

                if (key && value) {
                    if (key.toLowerCase() === 'host') {
                        host = value;
                    } else {
                        headers[key] = value;
                    }
                }
            }
        } else {
            // Body content
            if (bodyText === null) bodyText = line;
            else bodyText += '\n' + line;
        }
    }

    if (!host) {
        throw new Error('Host header is missing!');
    }

    const scheme = useHttps ? 'https' : 'http';
    const url = `${scheme}://${host}${path}`;

    // Filter out forbidden headers
    const forbiddenHeaders = [
        'accept-charset', 'accept-encoding', 'access-control-request-headers',
        'access-control-request-method', 'connection', 'content-length',
        'date', 'dnt', 'expect', 'host', 'keep-alive',
        'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'
    ];

    const filteredHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        const isForbidden = forbiddenHeaders.includes(lowerKey) ||
            lowerKey.startsWith('sec-') ||
            lowerKey.startsWith('proxy-');

        if (!isForbidden) {
            if (/^[a-zA-Z0-9\-_]+$/.test(key)) {
                filteredHeaders[key] = value;
            }
        }
    }

    // Add cache-busting headers to prevent 304 Not Modified responses
    // This ensures we always get fresh responses when replaying requests
    filteredHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    filteredHeaders['Pragma'] = 'no-cache';
    filteredHeaders['Expires'] = '0';

    // Remove conditional headers that might cause 304 responses
    delete filteredHeaders['If-None-Match'];
    delete filteredHeaders['If-Modified-Since'];

    const options = {
        method: method,
        headers: filteredHeaders,
        mode: 'cors',
        credentials: 'include',
        cache: 'no-store' // Fetch API cache control
    };

    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && bodyText) {
        options.body = bodyText;
    }

    return { url, options, method, filteredHeaders, bodyText };
}

export async function executeRequest(url, options) {
    // Add a custom header to identify requests sent by rep+ extension
    // This allows us to filter them out from being captured
    if (!options.headers) {
        options.headers = {};
    }
    options.headers['X-Rep-Plus-Replay'] = 'true';

    const startTime = performance.now();
    const response = await fetch(url, options);
    const endTime = performance.now();
    const duration = (endTime - startTime).toFixed(0);

    const responseBody = await response.text();
    const size = new TextEncoder().encode(responseBody).length;

    return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: responseBody,
        size: size,
        duration: duration
    };
}