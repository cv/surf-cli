import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SOCKET_PATH = "/tmp/surf.sock";
const CLI_PATH = path.join(__dirname, "../../native/cli.cjs");

describe("CLI to Socket communication", () => {
  let server: net.Server | null = null;
  let existingSocketBackedUp = false;

  beforeEach(() => {
    if (fs.existsSync(SOCKET_PATH)) {
      fs.renameSync(SOCKET_PATH, `${SOCKET_PATH}.backup`);
      existingSocketBackedUp = true;
    }
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    if (existingSocketBackedUp && fs.existsSync(`${SOCKET_PATH}.backup`)) {
      fs.renameSync(`${SOCKET_PATH}.backup`, SOCKET_PATH);
      existingSocketBackedUp = false;
    }
  });

  const runCliAndCapture = (
    args: string[],
    response: object = { result: { success: true } },
  ): Promise<{
    type: string;
    method?: string;
    params: { tool: string; args: Record<string, unknown> };
    tabId?: number;
    windowId?: number;
  }> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          socket.write(`${JSON.stringify(response)}\n`);
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(JSON.parse(data.trim()));
        });
      });

      server.listen(SOCKET_PATH, () => {
        const cli = spawn("node", [CLI_PATH, ...args]);
        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });
  };

  // Table-driven tests for command parsing
  const commandTests: Array<{
    name: string;
    args: string[];
    expectedTool: string;
    expectedArgs?: Record<string, unknown>;
    expectedGlobals?: { tabId?: number; windowId?: number };
  }> = [
    // Navigation
    {
      name: "go -> navigate",
      args: ["go", "https://example.com"],
      expectedTool: "navigate",
      expectedArgs: { url: "https://example.com" },
    },
    { name: "back", args: ["back"], expectedTool: "back" },
    { name: "forward", args: ["forward"], expectedTool: "forward" },

    // Aliases
    { name: "snap -> screenshot", args: ["snap"], expectedTool: "screenshot" },
    { name: "read -> page.read", args: ["read"], expectedTool: "page.read" },
    { name: "net -> network", args: ["net"], expectedTool: "network" },
    {
      name: "find -> search",
      args: ["find", "submit"],
      expectedTool: "search",
      expectedArgs: { term: "submit" },
    },

    // Click variants
    {
      name: "click with ref",
      args: ["click", "e5"],
      expectedTool: "click",
      expectedArgs: { ref: "e5" },
    },
    {
      name: "click with coordinates",
      args: ["click", "100", "200"],
      expectedTool: "click",
      expectedArgs: { x: 100, y: 200 },
    },
    {
      name: "click with selector",
      args: ["click", "--selector", ".btn"],
      expectedTool: "click",
      expectedArgs: { selector: ".btn" },
    },

    // Type
    {
      name: "type with text",
      args: ["type", "hello world"],
      expectedTool: "type",
      expectedArgs: { text: "hello world" },
    },
    {
      name: "type with --submit",
      args: ["type", "query", "--submit"],
      expectedTool: "type",
      expectedArgs: { text: "query", submit: true },
    },

    // Key
    { name: "key", args: ["key", "Enter"], expectedTool: "key", expectedArgs: { key: "Enter" } },

    // Mouse
    {
      name: "hover with ref",
      args: ["hover", "--ref", "e3"],
      expectedTool: "hover",
      expectedArgs: { ref: "e3" },
    },
    {
      name: "drag",
      args: ["drag", "--from", "100,100", "--to", "200,200"],
      expectedTool: "drag",
      expectedArgs: { from: "100,100", to: "200,200" },
    },

    // Scroll
    {
      name: "scroll with direction",
      args: ["scroll", "--direction", "down", "--amount", "3"],
      expectedTool: "scroll",
      expectedArgs: { direction: "down", amount: 3 },
    },
    { name: "scroll.top", args: ["scroll.top"], expectedTool: "scroll.top" },
    { name: "scroll.bottom", args: ["scroll.bottom"], expectedTool: "scroll.bottom" },
    {
      name: "scroll.to with ref",
      args: ["scroll.to", "--ref", "e10"],
      expectedTool: "scroll.to",
      expectedArgs: { ref: "e10" },
    },
    { name: "scroll.info", args: ["scroll.info"], expectedTool: "scroll.info" },

    // Page
    { name: "page.text", args: ["page.text"], expectedTool: "page.text" },
    { name: "page.state", args: ["page.state"], expectedTool: "page.state" },

    // Tab
    { name: "tab.list", args: ["tab.list"], expectedTool: "tab.list" },
    {
      name: "tab.new with url",
      args: ["tab.new", "https://github.com"],
      expectedTool: "tab.new",
      expectedArgs: { url: "https://github.com" },
    },
    {
      name: "tab.switch",
      args: ["tab.switch", "12345"],
      expectedTool: "tab.switch",
      expectedArgs: { id: 12345 },
    },
    {
      name: "tab.close",
      args: ["tab.close", "999"],
      expectedTool: "tab.close",
      expectedArgs: { id: 999 },
    },
    {
      name: "tab.name",
      args: ["tab.name", "main-tab"],
      expectedTool: "tab.name",
      expectedArgs: { name: "main-tab" },
    },
    { name: "tab.reload", args: ["tab.reload"], expectedTool: "tab.reload" },

    // Window
    {
      name: "window.new with url and size",
      args: ["window.new", "https://example.com", "--width", "1280", "--height", "720"],
      expectedTool: "window.new",
      expectedArgs: { url: "https://example.com", width: 1280, height: 720 },
    },
    {
      name: "window.new --incognito",
      args: ["window.new", "--incognito"],
      expectedTool: "window.new",
      expectedArgs: { incognito: true },
    },
    { name: "window.list", args: ["window.list"], expectedTool: "window.list" },
    {
      name: "window.focus",
      args: ["window.focus", "555"],
      expectedTool: "window.focus",
      expectedArgs: { id: 555 },
    },
    {
      name: "window.close",
      args: ["window.close", "777"],
      expectedTool: "window.close",
      expectedArgs: { id: 777 },
    },
    {
      name: "window.resize",
      args: ["window.resize", "--id", "123", "--width", "1024", "--height", "768"],
      expectedTool: "window.resize",
      expectedArgs: { id: 123, width: 1024, height: 768 },
    },

    // Wait
    {
      name: "wait.element",
      args: ["wait.element", "#result", "--timeout", "5000"],
      expectedTool: "wait.element",
      expectedArgs: { selector: "#result", timeout: 5000 },
    },
    {
      name: "wait.url",
      args: ["wait.url", "/dashboard"],
      expectedTool: "wait.url",
      expectedArgs: { pattern: "/dashboard" },
    },
    { name: "wait.network", args: ["wait.network"], expectedTool: "wait.network" },
    { name: "wait.load", args: ["wait.load"], expectedTool: "wait.load" },
    { name: "wait.dom", args: ["wait.dom"], expectedTool: "wait.dom" },

    // Locate
    {
      name: "locate.role",
      args: ["locate.role", "button", "--name", "Submit"],
      expectedTool: "locate.role",
      expectedArgs: { role: "button", name: "Submit" },
    },
    {
      name: "locate.text",
      args: ["locate.text", "Sign In"],
      expectedTool: "locate.text",
      expectedArgs: { text: "Sign In" },
    },

    // JavaScript
    {
      name: "js with code",
      args: ["js", "return document.title"],
      expectedTool: "js",
      expectedArgs: { code: "return document.title" },
    },

    // Network (network and console commands read from local files, tested separately)
    {
      name: "network.get",
      args: ["network.get", "req-123"],
      expectedTool: "network.get",
      expectedArgs: { id: "req-123" },
    },
    {
      name: "network.body",
      args: ["network.body", "req-456"],
      expectedTool: "network.body",
      expectedArgs: { id: "req-456" },
    },
    { name: "network.clear", args: ["network.clear"], expectedTool: "network.clear" },

    // Dialog
    {
      name: "dialog.accept with text",
      args: ["dialog.accept", "--text", "confirmed"],
      expectedTool: "dialog.accept",
      expectedArgs: { text: "confirmed" },
    },
    { name: "dialog.dismiss", args: ["dialog.dismiss"], expectedTool: "dialog.dismiss" },
    { name: "dialog.info", args: ["dialog.info"], expectedTool: "dialog.info" },

    // Cookie
    { name: "cookie.list", args: ["cookie.list"], expectedTool: "cookie.list" },
    {
      name: "cookie.get",
      args: ["cookie.get", "--name", "session"],
      expectedTool: "cookie.get",
      expectedArgs: { name: "session" },
    },
    {
      name: "cookie.set",
      args: ["cookie.set", "--name", "token", "--value", "abc123"],
      expectedTool: "cookie.set",
      expectedArgs: { name: "token", value: "abc123" },
    },
    { name: "cookie.clear", args: ["cookie.clear"], expectedTool: "cookie.clear" },

    // Frame
    { name: "frame.list", args: ["frame.list"], expectedTool: "frame.list" },
    {
      name: "frame.switch",
      args: ["frame.switch", "--id", "frame-1"],
      expectedTool: "frame.switch",
      expectedArgs: { id: "frame-1" },
    },
    { name: "frame.main", args: ["frame.main"], expectedTool: "frame.main" },

    // Emulation
    {
      name: "emulate.network",
      args: ["emulate.network", "slow-3g"],
      expectedTool: "emulate.network",
      expectedArgs: { preset: "slow-3g" },
    },
    {
      name: "emulate.device",
      args: ["emulate.device", "iPhone 12"],
      expectedTool: "emulate.device",
      expectedArgs: { device: "iPhone 12" },
    },
    {
      name: "emulate.cpu",
      args: ["emulate.cpu", "4"],
      expectedTool: "emulate.cpu",
      expectedArgs: { rate: 4 },
    },
    {
      name: "emulate.viewport",
      args: ["emulate.viewport", "--width", "375", "--height", "812"],
      expectedTool: "emulate.viewport",
      expectedArgs: { width: 375, height: 812 },
    },
    { name: "emulate.touch", args: ["emulate.touch"], expectedTool: "emulate.touch" },

    // History/Bookmark
    { name: "history.list", args: ["history.list"], expectedTool: "history.list" },
    {
      name: "history.search",
      args: ["history.search", "github"],
      expectedTool: "history.search",
      expectedArgs: { query: "github" },
    },
    { name: "bookmark.list", args: ["bookmark.list"], expectedTool: "bookmark.list" },

    // Form
    {
      name: "form.fill",
      args: ["form.fill", "--selector", "#email", "--value", "test@example.com"],
      expectedTool: "form.fill",
      expectedArgs: { selector: "#email", value: "test@example.com" },
    },

    // Search
    {
      name: "search",
      args: ["search", "login button"],
      expectedTool: "search",
      expectedArgs: { term: "login button" },
    },

    // Performance
    { name: "perf.metrics", args: ["perf.metrics"], expectedTool: "perf.metrics" },

    // Health
    {
      name: "health with url",
      args: ["health", "--url", "https://example.com"],
      expectedTool: "health",
      expectedArgs: { url: "https://example.com" },
    },

    // Zoom
    {
      name: "zoom --reset",
      args: ["zoom", "--reset"],
      expectedTool: "zoom",
      expectedArgs: { reset: true },
    },

    // Global options
    {
      name: "--tab-id option",
      args: ["go", "https://example.com", "--tab-id", "12345"],
      expectedTool: "navigate",
      expectedArgs: { url: "https://example.com" },
      expectedGlobals: { tabId: 12345 },
    },
    {
      name: "--window-id option",
      args: ["go", "https://example.com", "--window-id", "67890"],
      expectedTool: "navigate",
      expectedArgs: { url: "https://example.com" },
      expectedGlobals: { windowId: 67890 },
    },

    // Additional commands
    {
      name: "locate.label",
      args: ["locate.label", "Email"],
      expectedTool: "locate.label",
      expectedArgs: { label: "Email" },
    },
    { name: "tab.named", args: ["tab.named"], expectedTool: "tab.named" },
    {
      name: "tab.unname",
      args: ["tab.unname", "my-tab"],
      expectedTool: "tab.unname",
      expectedArgs: { name: "my-tab" },
    },
    { name: "perf.start", args: ["perf.start"], expectedTool: "perf.start" },
    { name: "perf.stop", args: ["perf.stop"], expectedTool: "perf.stop" },
    { name: "network.stats", args: ["network.stats"], expectedTool: "network.stats" },
    { name: "network.origins", args: ["network.origins"], expectedTool: "network.origins" },
    {
      name: "network.curl",
      args: ["network.curl", "req-789"],
      expectedTool: "network.curl",
      expectedArgs: { id: "req-789" },
    },
    {
      name: "bookmark.add",
      args: ["bookmark.add", "--title", "My Page"],
      expectedTool: "bookmark.add",
      expectedArgs: { title: "My Page" },
    },
    {
      name: "bookmark.remove",
      args: ["bookmark.remove", "--id", "abc"],
      expectedTool: "bookmark.remove",
      expectedArgs: { id: "abc" },
    },
    {
      name: "emulate.geo with --clear",
      args: ["emulate.geo", "--clear"],
      expectedTool: "emulate.geo",
      expectedArgs: { clear: true },
    },
    {
      name: "frame.js",
      args: ["frame.js", "return 1+1", "--frame", "iframe-1"],
      expectedTool: "frame.js",
      expectedArgs: { code: "return 1+1", frame: "iframe-1" },
    },

    // Tab groups
    {
      name: "tab.group with name and color",
      args: ["tab.group", "--name", "Work", "--color", "blue"],
      expectedTool: "tab.group",
      expectedArgs: { name: "Work", color: "blue" },
    },
    {
      name: "tab.group with tabs",
      args: ["tab.group", "--name", "Research", "--tabs", "1,2,3"],
      expectedTool: "tab.group",
      expectedArgs: { name: "Research", tabs: "1,2,3" },
    },
    {
      name: "tab.ungroup",
      args: ["tab.ungroup", "--tabs", "4,5"],
      expectedTool: "tab.ungroup",
      expectedArgs: { tabs: "4,5" },
    },
    { name: "tab.groups", args: ["tab.groups"], expectedTool: "tab.groups" },

    // Wait (base command)
    {
      name: "wait with duration",
      args: ["wait", "2"],
      expectedTool: "wait",
      expectedArgs: { duration: 2 },
    },

    // Upload
    {
      name: "upload with ref and files",
      args: ["upload", "--ref", "e5", "--files", "/path/to/file.pdf"],
      expectedTool: "upload",
      expectedArgs: { ref: "e5", files: "/path/to/file.pdf" },
    },

    // Resize (standalone command)
    {
      name: "resize with dimensions",
      args: ["resize", "--width", "1280", "--height", "720"],
      expectedTool: "resize",
      expectedArgs: { width: 1280, height: 720 },
    },

    // Smoke
    {
      name: "smoke with urls",
      args: ["smoke", "--urls", "https://example.com", "https://test.com"],
      expectedTool: "smoke",
      expectedArgs: { urls: ["https://example.com", "https://test.com"] },
    },
    {
      name: "smoke with routes and fail-fast",
      args: ["smoke", "--routes", "auth", "--fail-fast"],
      expectedTool: "smoke",
      expectedArgs: { routes: "auth", "fail-fast": true },
    },

    // Console (base command)
    {
      name: "console",
      args: ["console"],
      expectedTool: "console",
    },
    // Note: --level is stripped out by CLI for stream handling, so we test --limit instead
    {
      name: "console with limit",
      args: ["console", "--limit", "100"],
      expectedTool: "console",
      expectedArgs: { limit: 100 },
    },
    {
      name: "console with limit and clear",
      args: ["console", "--limit", "50", "--clear"],
      expectedTool: "console",
      expectedArgs: { limit: 50, clear: true },
    },

    // Network (base command)
    {
      name: "network with origin filter",
      args: ["network", "--origin", "api.github.com"],
      expectedTool: "network",
      expectedArgs: { origin: "api.github.com" },
    },
    {
      name: "network with method and status",
      args: ["network", "--method", "POST", "--status", "200"],
      expectedTool: "network",
      expectedArgs: { method: "POST", status: 200 },
    },
    {
      name: "network with format",
      args: ["network", "--format", "curl"],
      expectedTool: "network",
      expectedArgs: { format: "curl" },
    },
    {
      name: "network verbose",
      args: ["network", "-v"],
      expectedTool: "network",
      expectedArgs: { v: true },
    },
    {
      name: "network with multiple filters",
      args: ["network", "--type", "json", "--last", "10", "--exclude-static"],
      expectedTool: "network",
      expectedArgs: { type: "json", last: 10, "exclude-static": true },
    },
  ];

  it.each(commandTests)("$name", async (test) => {
    const request = await runCliAndCapture(test.args);

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe(test.expectedTool);

    if (test.expectedArgs) {
      for (const [key, value] of Object.entries(test.expectedArgs)) {
        if (Array.isArray(value)) {
          expect(request.params.args[key]).toEqual(value);
        } else {
          expect(request.params.args[key]).toBe(value);
        }
      }
    }

    if (test.expectedGlobals?.tabId) {
      expect(request.tabId).toBe(test.expectedGlobals.tabId);
    }
    if (test.expectedGlobals?.windowId) {
      expect(request.windowId).toBe(test.expectedGlobals.windowId);
    }
  });

  // Special cases that need custom handling
  describe("error handling", () => {
    it("exits with error when socket is not available", async () => {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const cli = spawn("node", [CLI_PATH, "go", "https://example.com"]);
        let stderr = "";

        cli.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        cli.on("close", (code) => {
          resolve({ code, stderr });
        });
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Socket not found");
    });

    it("outputs error message when server returns error", async () => {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ code: 1, stderr: "timeout" }), 5000);

        server = net.createServer((socket) => {
          socket.on("data", () => {
            socket.write(
              `${JSON.stringify({ error: { content: [{ text: "Element not found" }] } })}\n`,
            );
          });
        });

        server.listen(SOCKET_PATH, () => {
          const cli = spawn("node", [CLI_PATH, "click", "e99"]);
          let stderr = "";

          cli.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
          });

          cli.on("close", (code) => {
            clearTimeout(timeout);
            resolve({ code, stderr });
          });
        });
      });

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Element not found");
    });
  });
});
