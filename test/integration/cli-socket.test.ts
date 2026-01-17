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

  it("sends click command with --selector option", async () => {
    const request = (await runCliAndCapture(["click", "--selector", ".submit-btn"])) as {
      type: string;
      params: { tool: string; args: { selector: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("click");
    expect(request.params.args.selector).toBe(".submit-btn");
  });

  it("sends js command with code argument", async () => {
    const request = (await runCliAndCapture(["js", "return document.title"])) as {
      type: string;
      params: { tool: string; args: { code: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("js");
    expect(request.params.args.code).toBe("return document.title");
  });

  it("sends window.new command with url and options", async () => {
    const request = (await runCliAndCapture([
      "window.new",
      "https://example.com",
      "--width",
      "1280",
      "--height",
      "720",
    ])) as {
      type: string;
      params: { tool: string; args: { url: string; width: number; height: number } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("window.new");
    expect(request.params.args.url).toBe("https://example.com");
    expect(request.params.args.width).toBe(1280);
    expect(request.params.args.height).toBe(720);
  });

  it("sends window.new with --incognito boolean flag", async () => {
    const request = (await runCliAndCapture(["window.new", "--incognito"])) as {
      type: string;
      params: { tool: string; args: { incognito: boolean } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("window.new");
    expect(request.params.args.incognito).toBe(true);
  });

  it("sends scroll command with direction and amount", async () => {
    const request = (await runCliAndCapture([
      "scroll",
      "--direction",
      "down",
      "--amount",
      "3",
    ])) as {
      type: string;
      params: { tool: string; args: { direction: string; amount: number } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("scroll");
    expect(request.params.args.direction).toBe("down");
    expect(request.params.args.amount).toBe(3);
  });

  it("sends wait.element command with selector and timeout", async () => {
    const request = (await runCliAndCapture(["wait.element", "#result", "--timeout", "5000"])) as {
      type: string;
      params: { tool: string; args: { selector: string; timeout: number } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("wait.element");
    expect(request.params.args.selector).toBe("#result");
    expect(request.params.args.timeout).toBe(5000);
  });

  it("sends type command with --submit flag", async () => {
    const request = (await runCliAndCapture(["type", "search query", "--submit"])) as {
      type: string;
      params: { tool: string; args: { text: string; submit: boolean } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("type");
    expect(request.params.args.text).toBe("search query");
    expect(request.params.args.submit).toBe(true);
  });

  it("resolves net alias to network command", async () => {
    const request = (await runCliAndCapture(["net"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("network");
  });

  it("sends tab.new command with url", async () => {
    const request = (await runCliAndCapture(["tab.new", "https://github.com"])) as {
      type: string;
      params: { tool: string; args: { url: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("tab.new");
    expect(request.params.args.url).toBe("https://github.com");
  });

  it("outputs error message when server returns error", async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const timeout = setTimeout(() => resolve({ code: 1, stderr: "timeout" }), 5000);

      server = net.createServer((socket) => {
        socket.on("data", () => {
          // Return an error response
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

  it("sends key command with key name", async () => {
    const request = (await runCliAndCapture(["key", "Enter"])) as {
      type: string;
      params: { tool: string; args: { key: string } };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("key");
    expect(request.params.args.key).toBe("Enter");
  });

  it("sends console command", async () => {
    const request = (await runCliAndCapture(["console"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("console");
  });

  it("sends back command", async () => {
    const request = (await runCliAndCapture(["back"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("back");
  });

  it("sends forward command", async () => {
    const request = (await runCliAndCapture(["forward"])) as {
      type: string;
      params: { tool: string };
    };

    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("forward");
  });
});
