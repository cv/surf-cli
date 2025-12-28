import { CDPController } from "../cdp/controller";
import { debugLog } from "../utils/debug";
import { initNativeMessaging } from "../native/port-manager";

debugLog("Service worker loaded");

const cdp = new CDPController();

const screenshotCache = new Map<string, { base64: string; width: number; height: number }>();
let screenshotCounter = 0;

function generateScreenshotId(): string {
  return `screenshot_${++screenshotCounter}_${Date.now()}`;
}

function cacheScreenshot(id: string, data: { base64: string; width: number; height: number }): void {
  screenshotCache.set(id, data);
  if (screenshotCache.size > 10) {
    const oldest = screenshotCache.keys().next().value;
    if (oldest) screenshotCache.delete(oldest);
  }
}

function getScreenshot(id: string): { base64: string; width: number; height: number } | null {
  return screenshotCache.get(id) || null;
}

const tabGroups = new Map<number, number>();
const navigationResolvers = new Map<number, () => void>();

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    const resolver = navigationResolvers.get(details.tabId);
    if (resolver) {
      resolver();
      navigationResolvers.delete(details.tabId);
    }
  }
});

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  if (details.frameId === 0) {
    const resolver = navigationResolvers.get(details.tabId);
    if (resolver) {
      resolver();
      navigationResolvers.delete(details.tabId);
    }
  }
});

async function openSidePanel(tabId: number): Promise<void> {
  chrome.sidePanel.setOptions({
    tabId,
    path: `sidepanel/index.html?tabId=${encodeURIComponent(tabId)}`,
    enabled: true,
  });
  chrome.sidePanel.open({ tabId });
  
  await ensureTabGroup(tabId);
}

async function ensureTabGroup(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      tabGroups.set(tabId, tab.groupId);
      return;
    }
    
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: "Pi Agent",
      color: "blue",
      collapsed: false,
    });
    tabGroups.set(tabId, groupId);
  } catch (e) {
    debugLog("Could not create tab group:", e);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await openSidePanel(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-side-panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await openSidePanel(tab.id);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cdp.detach(tabId);
  tabGroups.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(
  message: any,
  sender: chrome.runtime.MessageSender
): Promise<any> {
  const tabId = message.tabId;

  switch (message.type) {
    case "GET_CURRENT_TAB_ID": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { tabId: tab?.id };
    }

    case "EXECUTE_SCREENSHOT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await cdp.captureScreenshot(tabId);
        const screenshotId = generateScreenshotId();
        cacheScreenshot(screenshotId, result);
        return { ...result, screenshotId };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "EXECUTE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.click(tabId, message.x, message.y, "left", 1, mods);
      return { success: true };
    }

    case "EXECUTE_RIGHT_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.rightClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_DOUBLE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.doubleClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_TRIPLE_CLICK": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.tripleClick(tabId, message.x, message.y, mods);
      return { success: true };
    }

    case "EXECUTE_DRAG": {
      if (!tabId) throw new Error("No tabId provided");
      const mods = message.modifiers ? cdp.parseModifiers(message.modifiers) : 0;
      await cdp.drag(tabId, message.startX, message.startY, message.endX, message.endY, mods);
      return { success: true };
    }

    case "EXECUTE_HOVER": {
      if (!tabId) throw new Error("No tabId provided");
      await cdp.hover(tabId, message.x, message.y);
      return { success: true };
    }

    case "EXECUTE_TYPE": {
      if (!tabId) throw new Error("No tabId provided");
      if (message.text === undefined || message.text === null) throw new Error("No text provided");
      await cdp.type(tabId, message.text);
      return { success: true };
    }

    case "EXECUTE_SCROLL": {
      if (!tabId) throw new Error("No tabId provided");
      const viewport = await cdp.getViewportSize(tabId);
      const x = message.x ?? viewport.width / 2;
      const y = message.y ?? viewport.height / 2;
      await cdp.scroll(tabId, x, y, message.deltaX, message.deltaY);
      return { success: true };
    }

    case "EXECUTE_KEY": {
      if (!tabId) throw new Error("No tabId provided");
      const key = message.key;
      if (!key) throw new Error("No key provided");
      if (key.includes("+")) {
        await cdp.pressKeyChord(tabId, key);
      } else {
        await cdp.pressKey(tabId, key);
      }
      return { success: true };
    }

    case "EXECUTE_NAVIGATE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.url) throw new Error("No url provided");
      
      const navigationPromise = new Promise<void>((resolve) => {
        navigationResolvers.set(tabId, resolve);
        setTimeout(() => {
          if (navigationResolvers.has(tabId)) {
            navigationResolvers.delete(tabId);
            resolve();
          }
        }, 30000);
      });
      
      await chrome.tabs.update(tabId, { url: message.url });
      await navigationPromise;
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return { success: true };
    }

    case "GET_VIEWPORT_SIZE": {
      if (!tabId) throw new Error("No tabId provided");
      return await cdp.getViewportSize(tabId);
    }

    case "READ_PAGE": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        await chrome.tabs.sendMessage(tabId, { type: "HIDE_FOR_TOOL_USE" }, { frameId: 0 });
      } catch (e) {}
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "GENERATE_ACCESSIBILITY_TREE",
          options: message.options || {},
        }, { frameId: 0 });
        return result;
      } catch (err) {
        return { 
          error: "Content script not loaded. Try refreshing the page.",
          pageContent: "",
          viewport: { width: 0, height: 0 }
        };
      } finally {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "SHOW_AFTER_TOOL_USE" });
        } catch (e) {}
      }
    }

    case "GET_ELEMENT_COORDINATES": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          ref: message.ref,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "FORM_INPUT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "FORM_INPUT",
          ref: message.ref,
          value: message.value,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "SCROLL_TO_ELEMENT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, {
          type: "SCROLL_TO_ELEMENT",
          ref: message.ref,
        }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "GET_PAGE_TEXT": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_TEXT" }, { frameId: 0 });
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "SHOW_AGENT_INDICATORS":
    case "HIDE_AGENT_INDICATORS":
    case "SHOW_STATIC_INDICATOR":
    case "HIDE_STATIC_INDICATOR": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        return await chrome.tabs.sendMessage(tabId, { type: message.type });
      } catch (err) {
        return { error: "Content script not loaded" };
      }
    }

    case "STOP_AGENT": {
      const fromTabId = message.fromTabId;
      let targetTabId: number | undefined;
      
      if (fromTabId === "CURRENT_TAB" && sender.tab?.id) {
        targetTabId = sender.tab.id;
      } else if (typeof fromTabId === "number") {
        targetTabId = fromTabId;
      }
      
      if (targetTabId) {
        chrome.runtime.sendMessage({ type: "STOP_AGENT", targetTabId });
      }
      return { success: true };
    }

    case "OPEN_SIDEPANEL": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await openSidePanel(tab.id);
      }
      return { success: true };
    }

    case "DISMISS_STATIC_INDICATOR": {
      return { success: true };
    }

    case "STATIC_INDICATOR_HEARTBEAT": {
      return { success: true };
    }

    case "CLICK_REF": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        const coords = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          ref: message.ref,
        }, { frameId: 0 });
        if (coords.error) return { error: coords.error };

        const button = message.button || "left";
        if (button === "right") {
          await cdp.rightClick(tabId, coords.x, coords.y);
        } else if (button === "double") {
          await cdp.doubleClick(tabId, coords.x, coords.y);
        } else {
          await cdp.click(tabId, coords.x, coords.y, "left", 1, 0);
        }
        return { success: true };
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "HOVER_REF": {
      if (!tabId) throw new Error("No tabId provided");
      try {
        const coords = await chrome.tabs.sendMessage(tabId, {
          type: "GET_ELEMENT_COORDINATES",
          ref: message.ref,
        }, { frameId: 0 });
        if (coords.error) return { error: coords.error };
        await cdp.hover(tabId, coords.x, coords.y);
        return { success: true };
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "PING": {
      return { success: true, status: "connected" };
    }

    case "EXECUTE_JAVASCRIPT": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.code) throw new Error("No code provided");

      try {
        const escaped = message.code.replace(/`/g, "\\`").replace(/\$/g, "\\$");
        const expression = `(function() { 'use strict'; try { return eval(\`${escaped}\`); } catch (e) { throw e; } })()`;
        
        const result = await cdp.evaluateScript(tabId, expression);
        
        if (result.exceptionDetails) {
          const err = result.exceptionDetails.exception?.description || 
                      result.exceptionDetails.text || 
                      "Script execution failed";
          return { error: err };
        }
        
        const value = result.result?.value;
        const output = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
        return { output: output?.substring(0, 50000) || "undefined" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Script execution failed";
        if (msg.includes("Cannot access") || msg.includes("Cannot attach")) {
          return { error: "Cannot execute JavaScript on this page (restricted URL)" };
        }
        return { error: msg };
      }
    }

    case "READ_CONSOLE_MESSAGES": {
      if (!tabId) throw new Error("No tabId provided");

      try {
        await cdp.enableConsoleTracking(tabId);
      } catch (e) {}

      const messages = cdp.getConsoleMessages(tabId, {
        onlyErrors: message.onlyErrors,
        pattern: message.pattern,
        limit: message.limit || 100,
      });

      if (message.clear) {
        cdp.clearConsoleMessages(tabId);
      }

      return { messages };
    }

    case "CLEAR_CONSOLE_MESSAGES": {
      if (!tabId) throw new Error("No tabId provided");
      cdp.clearConsoleMessages(tabId);
      return { success: true };
    }

    case "READ_NETWORK_REQUESTS": {
      if (!tabId) throw new Error("No tabId provided");

      try {
        await cdp.enableNetworkTracking(tabId);
      } catch (e) {}

      const requests = cdp.getNetworkRequests(tabId, {
        urlPattern: message.urlPattern,
        limit: message.limit || 100,
      });

      if (message.clear) {
        cdp.clearNetworkRequests(tabId);
      }

      return { requests };
    }

    case "CLEAR_NETWORK_REQUESTS": {
      if (!tabId) throw new Error("No tabId provided");
      cdp.clearNetworkRequests(tabId);
      return { success: true };
    }

    case "RESIZE_WINDOW": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.width || !message.height) throw new Error("width and height required");

      const tab = await chrome.tabs.get(tabId);
      if (!tab.windowId) throw new Error("Tab has no window");

      await chrome.windows.update(tab.windowId, {
        width: Math.floor(message.width),
        height: Math.floor(message.height),
      });

      return { success: true, width: message.width, height: message.height };
    }

    case "TABS_CREATE": {
      const activeTab = tabId ? await chrome.tabs.get(tabId) : null;

      const newTab = await chrome.tabs.create({
        url: message.url || "about:blank",
        active: false,
      });

      if (!newTab.id) throw new Error("Failed to create tab");

      if (activeTab?.groupId && activeTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await chrome.tabs.group({ tabIds: newTab.id, groupId: activeTab.groupId });
      }

      return { 
        success: true, 
        tabId: newTab.id, 
        url: newTab.url || message.url || "about:blank" 
      };
    }

    case "UPLOAD_IMAGE": {
      if (!tabId) throw new Error("No tabId provided");
      if (!message.screenshotId) throw new Error("screenshotId required");
      if (!message.ref && !message.coordinate) throw new Error("ref or coordinate required");

      const screenshot = getScreenshot(message.screenshotId);
      if (!screenshot) throw new Error(`Screenshot not found: ${message.screenshotId}`);

      try {
        const result = await chrome.tabs.sendMessage(tabId, {
          type: "UPLOAD_IMAGE",
          base64: screenshot.base64,
          ref: message.ref,
          coordinate: message.coordinate,
          filename: message.filename || "screenshot.png",
        }, { frameId: 0 });

        return result;
      } catch (err) {
        return { error: "Content script not loaded. Try refreshing the page." };
      }
    }

    case "GET_TABS": {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
      };
    }

    case "GET_AUTH": {
      const { sendToNativeHost } = await import("../native/port-manager");
      try {
        const result = await sendToNativeHost({ type: "GET_AUTH" });
        return result;
      } catch (err) {
        return { 
          auth: null, 
          hint: "Native host not connected. Make sure pi-chrome native host is installed." 
        };
      }
    }

    case "NATIVE_API_REQUEST": {
      const { sendToNativeHost } = await import("../native/port-manager");
      try {
        await sendToNativeHost({
          type: "API_REQUEST",
          streamId: message.streamId,
          url: message.url,
          method: message.method,
          headers: message.headers,
          body: message.body,
        });
        return { sent: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Unknown error" };
      }
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  debugLog("Extension installed/updated:", details.reason);
});

initNativeMessaging(async (msg) => {
  let tabId = msg.tabId;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  return handleMessage({ ...msg, tabId }, {} as chrome.runtime.MessageSender);
});
