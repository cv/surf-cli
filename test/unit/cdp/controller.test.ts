import { vi } from "vitest";
import { CDPController } from "../../../src/cdp/controller";

// Mock chrome.debugger API
const mockChrome = {
  debugger: {
    attach: vi.fn(),
    detach: vi.fn(),
    sendCommand: vi.fn(),
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

// Set global chrome before tests
vi.stubGlobal("chrome", mockChrome);

describe("CDPController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseModifiers", () => {
    let controller: CDPController;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns 0 for undefined input", () => {
      expect(controller.parseModifiers(undefined)).toBe(0);
    });

    it("returns 0 for empty string", () => {
      expect(controller.parseModifiers("")).toBe(0);
    });

    it("parses single modifier 'shift'", () => {
      expect(controller.parseModifiers("shift")).toBe(8);
    });

    it("parses single modifier 'ctrl'", () => {
      expect(controller.parseModifiers("ctrl")).toBe(2);
    });

    it("parses single modifier 'alt'", () => {
      expect(controller.parseModifiers("alt")).toBe(1);
    });

    it("parses single modifier 'meta'", () => {
      expect(controller.parseModifiers("meta")).toBe(4);
    });

    it("parses combined modifiers 'ctrl+shift'", () => {
      // ctrl=2, shift=8, combined=10
      expect(controller.parseModifiers("ctrl+shift")).toBe(10);
    });

    it("parses combined modifiers 'alt+shift+ctrl'", () => {
      // alt=1, ctrl=2, shift=8, combined=11
      expect(controller.parseModifiers("alt+shift+ctrl")).toBe(11);
    });

    it("handles case insensitivity", () => {
      expect(controller.parseModifiers("SHIFT")).toBe(8);
      expect(controller.parseModifiers("Ctrl")).toBe(2);
    });

    it("handles aliases for ctrl", () => {
      expect(controller.parseModifiers("control")).toBe(2);
    });

    it("handles aliases for meta", () => {
      expect(controller.parseModifiers("cmd")).toBe(4);
      expect(controller.parseModifiers("command")).toBe(4);
      expect(controller.parseModifiers("win")).toBe(4);
      expect(controller.parseModifiers("windows")).toBe(4);
    });

    it("ignores unknown modifiers", () => {
      expect(controller.parseModifiers("unknown")).toBe(0);
      expect(controller.parseModifiers("ctrl+unknown")).toBe(2);
    });
  });

  describe("getConsoleMessages", () => {
    let controller: CDPController;
    const tabId = 123;

    beforeEach(() => {
      controller = new CDPController();
      // Clear console messages returns empty array for unknown tab
    });

    it("returns empty array for tab with no messages", () => {
      const messages = controller.getConsoleMessages(tabId);
      expect(messages).toStrictEqual([]);
    });

    it("returns empty array after clearing messages", () => {
      controller.clearConsoleMessages(tabId);
      const messages = controller.getConsoleMessages(tabId);
      expect(messages).toStrictEqual([]);
    });
  });

  describe("getNetworkRequests", () => {
    let controller: CDPController;
    const tabId = 456;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns empty array for tab with no requests", () => {
      const requests = controller.getNetworkRequests(tabId);
      expect(requests).toStrictEqual([]);
    });

    it("returns empty array after clearing requests", () => {
      controller.clearNetworkRequests(tabId);
      const requests = controller.getNetworkRequests(tabId);
      expect(requests).toStrictEqual([]);
    });
  });

  describe("getDialogInfo", () => {
    let controller: CDPController;
    const tabId = 789;

    beforeEach(() => {
      controller = new CDPController();
    });

    it("returns null when no dialog is pending", () => {
      const dialog = controller.getDialogInfo(tabId);
      expect(dialog).toBeNull();
    });
  });
});
