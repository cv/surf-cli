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

  it("sends navigate command as tool_request to socket", async () => {
    // Create a mock socket server that captures the request
    const receivedData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          // Send a response so CLI doesn't hang
          socket.write(`${JSON.stringify({ result: { success: true } })}\n`);
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      server.listen(SOCKET_PATH, () => {
        // Run CLI command
        const cli = spawn("node", [CLI_PATH, "go", "https://example.com"]);

        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    const request = JSON.parse(receivedData.trim());
    expect(request.type).toBe("tool_request");
    expect(request.method).toBe("execute_tool");
    expect(request.params.tool).toBe("navigate");
    expect(request.params.args.url).toBe("https://example.com");
  });

  it("sends click command with element reference", async () => {
    const receivedData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          socket.write(`${JSON.stringify({ result: { success: true } })}\n`);
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      server.listen(SOCKET_PATH, () => {
        const cli = spawn("node", [CLI_PATH, "click", "e5"]);
        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    const request = JSON.parse(receivedData.trim());
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
    const receivedData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          socket.write(`${JSON.stringify({ result: { success: true } })}\n`);
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      server.listen(SOCKET_PATH, () => {
        const cli = spawn("node", [CLI_PATH, "type", "hello world"]);
        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    const request = JSON.parse(receivedData.trim());
    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("type");
    expect(request.params.args.text).toBe("hello world");
  });

  it("resolves snap alias to screenshot command", async () => {
    const receivedData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          // Return a screenshot-like response
          socket.write(
            `${JSON.stringify({ result: { base64: "abc123", width: 800, height: 600 } })}\n`,
          );
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      server.listen(SOCKET_PATH, () => {
        const cli = spawn("node", [CLI_PATH, "snap"]);
        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    const request = JSON.parse(receivedData.trim());
    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("screenshot");
  });

  it("includes tabId in request when --tab-id is provided", async () => {
    const receivedData = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 5000);

      server = net.createServer((socket) => {
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk.toString();
          socket.write(`${JSON.stringify({ result: { success: true } })}\n`);
        });
        socket.on("close", () => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      server.listen(SOCKET_PATH, () => {
        const cli = spawn("node", [CLI_PATH, "go", "https://example.com", "--tab-id", "12345"]);
        cli.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });

    const request = JSON.parse(receivedData.trim());
    expect(request.type).toBe("tool_request");
    expect(request.params.tool).toBe("navigate");
    expect(request.tabId).toBe(12345);
  });
});
