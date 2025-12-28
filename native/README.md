# Pi Chrome Native Messaging Host

Native messaging host that bridges pi-coding-agent to the Chrome extension via Unix socket.

## Architecture

```
Pi-Agent → Unix Socket (/tmp/pi-chrome.sock) → Native Host (host.cjs) → Chrome Native Messaging → Extension
```

## Files

| File | Purpose |
|------|---------|
| `host.cjs` | Main native host with socket server and tool request handling |
| `cli.cjs` | CLI tool for testing socket communication |
| `protocol.cjs` | Chrome native messaging protocol helpers |
| `host-wrapper.py` | Python wrapper for native host execution |
| `host.sh` | Shell script to start the host |

## Setup

1. Install the native host manifest:
```bash
# The manifest points Chrome to the host executable
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cat > ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.anthropic.pi_chrome.json << EOF
{
  "name": "com.anthropic.pi_chrome",
  "description": "Pi Chrome Extension Native Host",
  "path": "$PWD/host-wrapper.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
}
EOF
```

2. Start the native host:
```bash
node host.cjs
```

The host creates a Unix socket at `/tmp/pi-chrome.sock`.

## Protocol

### Tool Request

```json
{
  "type": "tool_request",
  "method": "execute_tool",
  "params": {
    "tool": "TOOL_NAME",
    "args": { ... },
    "tabId": 123
  },
  "id": "unique-request-id"
}
```

### Tool Response (Success)

```json
{
  "type": "tool_response",
  "id": "unique-request-id",
  "result": {
    "content": [
      { "type": "text", "text": "Result message" }
    ]
  }
}
```

### Tool Response (With Image)

```json
{
  "type": "tool_response",
  "id": "unique-request-id",
  "result": {
    "content": [
      { "type": "text", "text": "Screenshot captured" },
      { "type": "image", "data": "base64...", "mimeType": "image/png" }
    ]
  }
}
```

### Tool Response (Error)

```json
{
  "type": "tool_response",
  "id": "unique-request-id",
  "error": {
    "content": [{ "type": "text", "text": "Error message" }]
  }
}
```

## Available Tools

| Tool | Args | Description |
|------|------|-------------|
| `tabs_context` | - | Get all open tabs |
| `navigate` | `tabId`, `url` | Navigate to URL or back/forward |
| `read_page` | `tabId`, `filter?` | Get accessibility tree |
| `screenshot` | `tabId` | Capture page screenshot |
| `computer` | `tabId`, `action`, ... | Mouse/keyboard actions |
| `form_input` | `tabId`, `ref`, `value` | Set form field value |
| `get_page_text` | `tabId` | Extract page text |
| `javascript_tool` | `tabId`, `code` | Execute JavaScript via CDP |
| `read_console_messages` | `tabId`, `pattern?` | Read console output |
| `read_network_requests` | `tabId`, `urlPattern?` | Read network requests |
| `upload_image` | `tabId`, `imageId`, `ref`/`coordinate` | Upload image |
| `resize_window` | `tabId`, `width`, `height` | Resize browser window |
| `tabs_create` | - | Create new tab |

## Testing

Using netcat:
```bash
(echo '{"type":"tool_request","method":"execute_tool","params":{"tool":"tabs_context","args":{}},"id":"1"}'; sleep 2) | nc -U /tmp/pi-chrome.sock
```

Using the CLI:
```bash
node cli.cjs tabs_context
node cli.cjs screenshot --tabId 123
node cli.cjs read_page --tabId 123 --filter interactive
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Socket not found | Ensure `node host.cjs` is running |
| No response | Check extension is loaded in Chrome |
| "Content script not loaded" | Navigate to page first |
| Slow first operation | Normal - CDP debugger attachment takes ~5s |
