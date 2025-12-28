# Pi Agent Chrome Extension

AI-powered browser automation and chat extension with native messaging support for pi-coding-agent integration.

## Features

- **Browser Automation**: Control the browser with mouse, keyboard, and navigation actions via CDP
- **Page Understanding**: Accessibility tree extraction for intelligent page interaction
- **Visual Feedback**: Glow border and stop button when agent is active
- **Chat Interface**: Full ChatPanel integration from pi-web-ui
- **Session Persistence**: Per-tab conversation history (persists until browser closes)
- **Debug Mode**: Optional verbose logging for troubleshooting
- **Native Messaging**: Unix socket server for pi-coding-agent integration (`/tmp/pi-chrome.sock`)
- **JavaScript Execution**: Run JS on pages via CDP (bypasses CSP restrictions)
- **Console/Network Monitoring**: Track console messages and network requests via CDP events

## Installation

### Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build
npm run check    # Type check
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `dist/` folder

## Usage

1. Click the Pi Agent icon or press `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows/Linux)
2. Enter your API key when prompted
3. Chat with the agent to control the browser

### Example Commands

- "Take a screenshot"
- "Navigate to github.com"
- "Read the page and find the search button"
- "Click on the login link"
- "Fill in the email field with test@example.com"

## Available Tools

### Core Tools (Side Panel)

| Tool | Description |
|------|-------------|
| `computer` | Unified mouse/keyboard actions (click, type, key, scroll, hover, drag, wait) |
| `read_page` | Get page accessibility tree with element ref_ids |
| `form_input` | Set form field values by ref_id (more reliable than click+type) |
| `screenshot` | Capture the current page |
| `navigate` | Go to a URL or back/forward (waits for page load) |
| `get_page_text` | Extract readable text from page |
| `wait` | Wait for a duration (respects abort signal) |

### Additional Tools (Native Messaging)

| Tool | Description |
|------|-------------|
| `tabs_context` | Get all open tabs with IDs, titles, URLs |
| `tabs_create` | Create a new empty tab |
| `javascript_tool` | Execute JavaScript on page via CDP (bypasses CSP) |
| `read_console_messages` | Read browser console messages (log, warn, error) |
| `read_network_requests` | Read HTTP requests (XHR, Fetch, etc.) |
| `upload_image` | Upload screenshot to file input or drag-drop target |
| `resize_window` | Resize browser window to specific dimensions |

## Architecture

```
src/
├── sidepanel/          # Side panel UI (ChatPanel)
├── service-worker/     # Background service worker (message routing, CDP orchestration)
├── content/            # Content scripts
│   ├── accessibility-tree.ts  # Page understanding, element refs, upload_image
│   └── visual-indicator.ts    # Glow border, stop button
├── cdp/                # Chrome DevTools Protocol controller
│   └── controller.ts          # Mouse, keyboard, screenshot, console/network tracking
├── tools/              # Agent tools
│   ├── browser-tools.ts       # High-level tools (screenshot, navigate, etc.)
│   ├── computer-tool.ts       # Unified computer tool
│   └── shared.ts              # Shared utilities
├── storage/            # Chrome storage backend for pi-web-ui
├── options/            # Options page (API keys, debug mode, heartbeat interval)
└── utils/              # Utilities
    └── debug.ts               # Debug logging

native/
└── host.cjs            # Native messaging host with Unix socket server
```

## Native Messaging Integration

The extension includes a native messaging host that exposes browser tools to external agents via Unix socket.

### Setup

```bash
cd native
./install.sh           # Install native host manifest
node host.cjs          # Start the native host (creates /tmp/pi-chrome.sock)
```

### Protocol

Send JSON-RPC style requests to `/tmp/pi-chrome.sock`:

```bash
(echo '{"type":"tool_request","method":"execute_tool","params":{"tool":"tabs_context","args":{}},"id":"1"}'; sleep 2) | nc -U /tmp/pi-chrome.sock
```

Response format:
```json
{"type":"tool_response","id":"1","result":{"content":[{"type":"text","text":"..."}]}}
```

### Custom Tool: find_elements

A companion tool at `~/.pi/agent/tools/find-elements/` uses an LLM to search the accessibility tree:

1. Call `read_page` to get the tree
2. Call `find_elements(tree, query)` with natural language query
3. Returns matching element refs for use with `computer` tool

## Options

Access via right-click extension icon > Options, or `chrome://extensions` > Pi Agent > Details > Extension options.

- **Clear API Keys**: Remove all stored provider API keys
- **Debug Mode**: Enable verbose logging to console
- **Heartbeat Interval**: How often the static indicator checks agent status (5-60 seconds)

## Permissions

| Permission | Purpose |
|------------|---------|
| `sidePanel` | Side panel UI |
| `storage`, `unlimitedStorage` | API keys and session persistence |
| `debugger` | CDP for browser automation (mouse, keyboard, screenshots) |
| `tabs`, `tabGroups` | Tab management and grouping |
| `scripting` | Content script injection |
| `webNavigation` | Detect page load completion |
| `<all_urls>` | Access all pages for automation |

## Limitations

- Cannot automate `chrome://` pages, the Chrome Web Store, or other extensions
- CDP debugger attachment shows a banner ("Chrome is being controlled by automated test software")
- Some sites may detect automation via CDP
- First CDP operation on a new tab takes ~5-8 seconds (debugger attachment)
- Content scripts require page navigation after extension reload to inject

## Development

### Key Files

- `manifest.json` - Extension manifest (MV3)
- `vite.config.ts` - Build configuration
- `src/service-worker-loader.js` - Loads service worker as ES module

### Building

The build outputs to `dist/` with the following structure:
- `sidepanel/index.html` + `sidepanel/index.js` - Side panel
- `service-worker/index.js` - Background worker
- `content/*.js` - Content scripts
- `options/options.html` + `options/options.js` - Options page

### Debugging

1. Enable debug mode in Options
2. Open Chrome DevTools on any page
3. Check Console for `[Pi Agent]` prefixed logs
4. For service worker logs: `chrome://extensions` > Pi Agent > "Inspect views: service worker"

## Related Files

| Location | Purpose |
|----------|---------|
| `~/.pi/agent/tools/find-elements/` | LLM-powered element search tool |
| `~/.pi/agent/skills/pi-chrome-browser/` | Skill file with tool reference |
| `/tmp/pi-chrome.sock` | Unix socket for native messaging |

## License

Private - Not for redistribution.
