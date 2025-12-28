#!/usr/bin/env node
const net = require("net");
const path = require("path");
const os = require("os");
const fs = require("fs");

const SOCKET_PATH = "/tmp/pi-chrome.sock";
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help") {
  console.log(`Usage: pi-chrome <command> [options]

Commands:
  screenshot [--output FILE]      Capture screenshot
  navigate --url URL              Navigate to URL
  click --x X --y Y               Click at coordinates
  click --ref REF [--right|--double]  Click element by ref
  hover --x X --y Y               Hover at coordinates
  hover --ref REF                 Hover over element by ref
  drag --from X,Y --to X,Y        Drag between positions
  type --text TEXT                Type text
  key --key KEY                   Press key (e.g., Enter, cmd+a)
  read-page [--filter all] [--ref REF]  Get accessibility tree
  form-input --ref REF --value V  Set form field value
  scroll --direction DIR [--amount N]  Scroll page (up/down/left/right)
  scroll-to --ref REF             Scroll element into view
  get-text                        Extract page text
  wait --seconds N                Wait (CLI-side, 1-30s)
  status                          Check extension connection
  tabs                            List open tabs
  get-auth                        Get OAuth credentials from ~/.pi/agent/auth.json

Options:
  --tab-id ID                     Target specific tab
  --json                          Output raw JSON
  --help                          Show this help
`);
  process.exit(0);
}

const command = args[0];
const options = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      options[key] = args[++i];
    } else {
      options[key] = true;
    }
  }
}

const buildMessage = () => {
  switch (command) {
    case "screenshot":
      return { type: "EXECUTE_SCREENSHOT" };
    case "navigate":
      if (!options.url) {
        console.error("Error: --url is required");
        process.exit(1);
      }
      return { type: "EXECUTE_NAVIGATE", url: options.url };
    case "click":
      if (options.ref) {
        return {
          type: "CLICK_REF",
          ref: options.ref,
          button: options.right ? "right" : options.double ? "double" : "left",
        };
      }
      if (options.x === undefined || options.y === undefined) {
        console.error("Error: --x and --y are required (or use --ref)");
        process.exit(1);
      }
      return { type: "EXECUTE_CLICK", x: +options.x, y: +options.y };
    case "hover":
      if (options.ref) {
        return { type: "HOVER_REF", ref: options.ref };
      }
      if (options.x === undefined || options.y === undefined) {
        console.error("Error: --x and --y are required (or use --ref)");
        process.exit(1);
      }
      return { type: "EXECUTE_HOVER", x: +options.x, y: +options.y };
    case "drag": {
      if (!options.from || !options.to) {
        console.error("Error: --from and --to are required");
        process.exit(1);
      }
      const [startX, startY] = options.from.split(",").map(Number);
      const [endX, endY] = options.to.split(",").map(Number);
      return { type: "EXECUTE_DRAG", startX, startY, endX, endY };
    }
    case "type":
      if (options.text === undefined) {
        console.error("Error: --text is required");
        process.exit(1);
      }
      return { type: "EXECUTE_TYPE", text: options.text };
    case "key":
      if (!options.key) {
        console.error("Error: --key is required");
        process.exit(1);
      }
      return { type: "EXECUTE_KEY", key: options.key };
    case "read-page":
      return {
        type: "READ_PAGE",
        options: { filter: options.filter || "interactive", refId: options.ref },
      };
    case "form-input":
      if (!options.ref || options.value === undefined) {
        console.error("Error: --ref and --value are required");
        process.exit(1);
      }
      return { type: "FORM_INPUT", ref: options.ref, value: options.value };
    case "scroll": {
      if (!options.direction) {
        console.error("Error: --direction is required (up/down/left/right)");
        process.exit(1);
      }
      const amount = (+options.amount || 3) * 100;
      const deltas = {
        up: { deltaX: 0, deltaY: -amount },
        down: { deltaX: 0, deltaY: amount },
        left: { deltaX: -amount, deltaY: 0 },
        right: { deltaX: amount, deltaY: 0 },
      };
      const { deltaX, deltaY } = deltas[options.direction] || { deltaX: 0, deltaY: 0 };
      return { type: "EXECUTE_SCROLL", deltaX, deltaY };
    }
    case "scroll-to":
      if (!options.ref) {
        console.error("Error: --ref is required");
        process.exit(1);
      }
      return { type: "SCROLL_TO_ELEMENT", ref: options.ref };
    case "get-text":
      return { type: "GET_PAGE_TEXT" };
    case "wait": {
      const seconds = Math.min(30, Math.max(1, +options.seconds || 1));
      return { type: "LOCAL_WAIT", seconds };
    }
    case "status":
      return { type: "PING" };
    case "tabs":
      return { type: "GET_TABS" };
    case "get-auth":
      return { type: "GET_AUTH" };
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
};

const msg = buildMessage();

if (msg.type === "LOCAL_WAIT") {
  setTimeout(() => {
    console.log(`Waited ${msg.seconds} seconds`);
    process.exit(0);
  }, msg.seconds * 1000);
} else {
  if (options["tab-id"] !== undefined) msg.tabId = +options["tab-id"];

  const socket = net.createConnection(SOCKET_PATH, () => {
    socket.write(JSON.stringify(msg) + "\n");
  });

  const timeout = setTimeout(() => {
    console.error("Error: Request timed out");
    socket.destroy();
    process.exit(1);
  }, 30000);

  let responseBuffer = "";

  socket.on("data", (data) => {
    responseBuffer += data.toString();
    const lines = responseBuffer.split("\n");

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const response = JSON.parse(line);
        handleResponse(response);
      } catch (e) {
        console.error("Invalid response:", line);
        process.exit(1);
      }
    }

    responseBuffer = lines[lines.length - 1];
  });

  socket.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.error("Error: Pi Chrome extension not connected.");
      console.error("Make sure Chrome is running with the extension active.");
    } else if (err.code === "ECONNREFUSED") {
      console.error("Error: Connection refused. The native host may not be running.");
    } else {
      console.error("Connection error:", err.message);
    }
    process.exit(1);
  });

  const handleResponse = (response) => {
    clearTimeout(timeout);
    if (response.error) {
      console.error("Error:", response.error);
      process.exit(1);
    }

    if (command === "screenshot" && options.output) {
      const buf = Buffer.from(response.base64, "base64");
      fs.writeFileSync(options.output, buf);
      console.log(`Saved to ${options.output}`);
    } else if (options.json) {
      console.log(JSON.stringify(response, null, 2));
    } else if (command === "read-page") {
      console.log(response.pageContent || "");
    } else if (command === "get-text") {
      console.log(response.text || "");
    } else if (command === "tabs") {
      if (response.tabs) {
        for (const tab of response.tabs) {
          console.log(`${tab.id}\t${tab.title}\t${tab.url}`);
        }
      }
    } else if (command === "status") {
      console.log("connected");
    } else if (command === "get-auth") {
      if (response.hint) {
        console.error(response.hint);
      }
      if (response.auth) {
        console.log(JSON.stringify(response.auth, null, 2));
      }
    } else if (command === "screenshot") {
      console.log(response.base64);
    } else {
      console.log(response.success ? "OK" : JSON.stringify(response));
    }

    socket.end();
    process.exit(0);
  };
}
