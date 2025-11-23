# rep+

rep+ is a lightweight Chrome DevTools extension inspired by Burp Suite's Repeater, now supercharged with AI. I often need to poke at a few requests without spinning up the full Burp stack, so I built this extension to keep my workflow fast, focused, and intelligent with integrated LLM support.

![Image](https://github.com/user-attachments/assets/a4767b2d-9246-4f69-a7cd-a99c05edc78e)

## What it does

- **No Proxy Setup**: Works directly in Chrome. No need to configure system proxies or install CA certificates like in Burp Suite.
- **Capture & Replay**: Captures every HTTP request you trigger while testing. Replay any request and freely manipulate the raw method, path, headers, or body to probe endpoints.
- **Filters & Regex**: Powerful search across URL, headers, and body. Toggle **Regex Mode** for advanced pattern matching (e.g., finding specific tokens or IDs).
- **Converters**: Right-click context menu to instantly encode/decode data:
  - Base64
  - URL Encode/Decode
  - JWT Decode (view payload instantly)
  - Hex / UTF-8
- **Screenshots**: Built-in screenshot tool to capture the request/response pair for bug reports.
- **History & Navigation**: Undo/redo support for edits and history navigation for selected requests.
- **Starring**: Pin important requests to keep them at the top of your list.
- **Clear Workspace**: Instantly clear all captured requests with a single click to start a fresh session.
- **Export & Import**: Export requests as JSON to share findings with teammates or import them later. Perfect for rep+ ↔ rep+ workflows.
- **Bulk Replay**: Burp Suite Intruder-style attacks with four attack modes:
  - **Sniper**: Tests each position independently with its own payloads
  - **Battering Ram**: All positions receive the same payload
  - **Pitchfork**: Zips payloads across positions (index-wise)
  - **Cluster Bomb**: Tests all combinations (Cartesian product)
  
  Mark multiple parameters with `§`, choose your attack type, configure payloads (List or Numbers) for each position, and inspect detailed results for every attempt. Includes pause/resume functionality for long-running attacks.
  - **Response Diff**: Git-style diff view to highlight changes between the baseline response and each attack result. Toggle "Diff View" to see additions (green) and deletions (red) at a glance.
- **AI Capabilities**: Integrated with Anthropic's Claude to help you understand requests and responses.
  - **Explain Request**: Click the ✨ button to get a detailed explanation of the current request.
  - **Suggest Attack Vectors**: Click the ▼ menu and select **Suggest Attack Vectors** to get a prioritized security checklist of potential vulnerabilities (IDOR, SQLi, etc.) tailored to the current request.
  - **Context Menu**: Highlight any text (header, parameter, error), right-click, and select **"Explain with AI"** for a targeted explanation.
  - **Streaming Responses**: Explanations appear in real-time.
  - **Configuration**: Configure your Anthropic API Key and Model (Claude 3.5 Sonnet, Opus, Haiku) in the Settings 🤖 menu.

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/bscript/rep.git
   ```
2. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/` in your browser.
   - Enable **Developer mode** (toggle in the top right corner).
3. **Load the Extension**:
   - Click **Load unpacked**.
   - Select the `rep` folder you just cloned.
4. **Open DevTools**:
   - Press `F12` or right-click -> Inspect.
   - Look for the **rep+** tab (you might need to click the `>>` overflow menu).

This combo makes rep+ handy for bug bounty hunters and vulnerability researchers who want Burp-like iteration without the heavyweight UI. Install the extension, open DevTools, head to the rep+ panel, and start hacking. 😎

