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
    // Back up existing socket if present (don't break running surf)
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
    // Clean up test socket
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
    // Restore backed up socket
    if (existingSocketBackedUp && fs.existsSync(`${SOCKET_PATH}.backup`)) {
      fs.renameSync(`${SOCKET_PATH}.backup`, SOCKET_PATH);
      existingSocketBackedUp = false;
    }
  });

  // Helper to run CLI and capture the request sent to socket
  const runCliAndCapture = (
    args: string[],
    response: object = { result: { success: true } },
  ): Promise<object> => {
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

  it("sends navigate command as tool_request to socket", async () => {
    const request = (await runCliAndCapture(["go", "https://example.com"])) as {
      type: string;
      method: string;
      params: { tool: string; args: { url: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.method).toBe("execute_tool");
    expect(request.params.tool).toBe("navigate");
    expect(request.params.args.url).toBe("https://example.com");
  });

  it("sends click command with element reference", async () => {
    const request = (await runCliAndCapture(["click", "e5"])) as {
      type: string;
      params: { tool: string; args: { ref: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("click");
    expect(request.params.args.ref).toBe("e5");
  });

  it("exits with error when socket is not available", async () => {
    // Don't start a server - socket file doesn't exist
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

  it("sends type command with text argument", async () => {
    const request = (await runCliAndCapture(["type", "hello world"])) as {
      type: string;
      params: { tool: string; args: { text: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("type");
    expect(request.params.args.text).toBe("hello world");
  });

  it("resolves snap alias to screenshot command", async () => {
    const request = (await runCliAndCapture(["snap"], {
      result: { base64: "abc123", width: 800, height: 600 },
    })) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("screenshot");
  });

  it("includes tabId in request when --tab-id is provided", async () => {
    const request = (await runCliAndCapture([
      "go",
      "https://example.com",
      "--tab-id",
      "12345",
    ])) as {
      type: string;
      params: { tool: string };
      tabId: number;
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("navigate");
    expect(request.tabId).toBe(12345);
  });

  it("includes windowId in request when --window-id is provided", async () => {
    const request = (await runCliAndCapture([
      "go",
      "https://example.com",
      "--window-id",
      "67890",
    ])) as {
      type: string;
      params: { tool: string };
      windowId: number;
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("navigate");
    expect(request.windowId).toBe(67890);
  });

  it("resolves read alias to page.read command", async () => {
    const request = (await runCliAndCapture(["read"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("page.read");
  });

  it("sends click command with x,y coordinates", async () => {
    const request = (await runCliAndCapture(["click", "100", "200"])) as {
      type: string;
      params: { tool: string; args: { x: number; y: number } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("click");
    expect(request.params.args.x).toBe(100);
    expect(request.params.args.y).toBe(200);
  });

  it("sends namespaced tab.list command", async () => {
    const request = (await runCliAndCapture(["tab.list"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("tab.list");
  });
});
