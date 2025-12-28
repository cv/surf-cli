import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { setSharedTargetTabId, getSharedTargetTabId } from "./shared";

const computerSchema = Type.Object({
  action: Type.Union([
    Type.Literal("left_click"),
    Type.Literal("right_click"),
    Type.Literal("double_click"),
    Type.Literal("triple_click"),
    Type.Literal("type"),
    Type.Literal("key"),
    Type.Literal("screenshot"),
    Type.Literal("scroll"),
    Type.Literal("scroll_to"),
    Type.Literal("hover"),
    Type.Literal("drag"),
    Type.Literal("wait"),
  ], {
    description: `Action to perform:
* left_click/right_click/double_click/triple_click: Click at coordinates or ref
* type: Type text
* key: Press keyboard key(s), supports chords like "cmd+a"
* screenshot: Capture screen
* scroll: Scroll in a direction
* scroll_to: Scroll element into view by ref
* hover: Move mouse without clicking
* drag: Drag from start_coordinate to coordinate
* wait: Wait for duration seconds`,
  }),
  coordinate: Type.Optional(Type.Array(Type.Number(), {
    description: "[x, y] coordinates for clicks, scroll, hover, drag end",
  })),
  start_coordinate: Type.Optional(Type.Array(Type.Number(), {
    description: "[x, y] starting coordinates for drag",
  })),
  ref: Type.Optional(Type.String({
    description: 'Element ref_id from read_page. Alternative to coordinate for clicks.',
  })),
  text: Type.Optional(Type.String({
    description: 'Text to type (for "type") or key to press (for "key"). Keys can be chords like "cmd+a".',
  })),
  modifiers: Type.Optional(Type.String({
    description: 'Modifier keys: "ctrl", "shift", "alt", "cmd". Combine with "+" e.g., "ctrl+shift"',
  })),
  scroll_direction: Type.Optional(Type.Union([
    Type.Literal("up"),
    Type.Literal("down"),
    Type.Literal("left"),
    Type.Literal("right"),
  ], { description: "Scroll direction" })),
  scroll_amount: Type.Optional(Type.Number({
    description: "Scroll amount in wheel ticks (default: 3)",
  })),
  duration: Type.Optional(Type.Number({
    description: "Seconds to wait (for wait action, max 30)",
  })),
});

type ComputerParams = {
  action: string;
  coordinate?: number[];
  start_coordinate?: number[];
  ref?: string;
  text?: string;
  modifiers?: string;
  scroll_direction?: string;
  scroll_amount?: number;
  duration?: number;
};

export function setComputerToolTabId(tabId: number | null): void {
  setSharedTargetTabId(tabId);
}

const getTargetTabId = getSharedTargetTabId;

async function getCoordinatesFromRef(tabId: number, ref: string): Promise<{ x: number; y: number }> {
  const result = await chrome.runtime.sendMessage({
    type: "GET_ELEMENT_COORDINATES",
    tabId,
    ref,
  });
  if (result.error) throw new Error(result.error);
  return { x: result.x, y: result.y };
}

export const computerTool: AgentTool<typeof computerSchema, any> = {
  name: "computer",
  label: "Computer",
  description: `Mouse and keyboard control for browser automation.

Actions: left_click, right_click, double_click, triple_click, type, key, screenshot, scroll, scroll_to, hover, drag, wait.

Click by ref (preferred): Use ref from read_page for reliable clicks.
Click by coordinate: Use screenshot first to find exact position. Click center of elements, not edges.

Key combinations: Use "cmd+a", "ctrl+shift+v", etc. Common keys: Enter, Tab, Escape, ArrowDown.

Tips:
- If click fails, verify coordinates match the element center
- Use scroll_to before clicking off-screen elements
- Use wait after actions that trigger page updates`,
  parameters: computerSchema,
  execute: async (toolCallId, params: ComputerParams, signal) => {
    const tabId = await getTargetTabId();
    const { action, coordinate, start_coordinate, ref, text, modifiers, scroll_direction, scroll_amount, duration } = params;

    try {
      switch (action) {
        case "screenshot": {
          const result = await chrome.runtime.sendMessage({
            type: "EXECUTE_SCREENSHOT",
            tabId,
          });
          if (result.error) throw new Error(result.error);
          return {
            content: [{ type: "image", data: result.base64, mimeType: "image/png" }],
            details: { width: result.width, height: result.height },
          };
        }

        case "left_click":
        case "right_click":
        case "double_click":
        case "triple_click": {
          let x: number, y: number;
          if (ref) {
            const coords = await getCoordinatesFromRef(tabId, ref);
            x = coords.x;
            y = coords.y;
          } else if (coordinate && coordinate.length >= 2) {
            x = coordinate[0];
            y = coordinate[1];
          } else {
            throw new Error("Must provide coordinate or ref for click actions");
          }

          const messageType = action === "left_click" ? "EXECUTE_CLICK" : 
                              action === "right_click" ? "EXECUTE_RIGHT_CLICK" :
                              action === "double_click" ? "EXECUTE_DOUBLE_CLICK" : "EXECUTE_TRIPLE_CLICK";
          await chrome.runtime.sendMessage({
            type: messageType,
            tabId,
            x,
            y,
            modifiers,
          });

          return {
            content: [{ type: "text", text: `${action} at (${x}, ${y})${ref ? ` (${ref})` : ""}` }],
            details: { x, y, ref },
          };
        }

        case "type": {
          if (!text) throw new Error("text is required for type action");
          await chrome.runtime.sendMessage({
            type: "EXECUTE_TYPE",
            tabId,
            text,
          });
          return {
            content: [{ type: "text", text: `Typed: "${text}"` }],
            details: { text },
          };
        }

        case "key": {
          if (!text) throw new Error("text (key name) is required for key action");
          await chrome.runtime.sendMessage({
            type: "EXECUTE_KEY",
            tabId,
            key: text,
          });
          return {
            content: [{ type: "text", text: `Pressed: ${text}` }],
            details: { key: text },
          };
        }

        case "scroll": {
          if (!scroll_direction) throw new Error("scroll_direction is required for scroll action");
          let x = 0, y = 0;
          if (coordinate && coordinate.length >= 2) {
            x = coordinate[0];
            y = coordinate[1];
          } else {
            const viewport = await chrome.runtime.sendMessage({ type: "GET_VIEWPORT_SIZE", tabId });
            if (viewport.error) throw new Error(viewport.error);
            x = viewport.width / 2;
            y = viewport.height / 2;
          }

          const amount = (scroll_amount || 3) * 100;
          const deltas: Record<string, { deltaX: number; deltaY: number }> = {
            up: { deltaX: 0, deltaY: -amount },
            down: { deltaX: 0, deltaY: amount },
            left: { deltaX: -amount, deltaY: 0 },
            right: { deltaX: amount, deltaY: 0 },
          };

          await chrome.runtime.sendMessage({
            type: "EXECUTE_SCROLL",
            tabId,
            x,
            y,
            ...deltas[scroll_direction],
          });

          return {
            content: [{ type: "text", text: `Scrolled ${scroll_direction}` }],
            details: { direction: scroll_direction, amount },
          };
        }

        case "scroll_to": {
          if (!ref) throw new Error("ref is required for scroll_to action");
          await chrome.runtime.sendMessage({
            type: "SCROLL_TO_ELEMENT",
            tabId,
            ref,
          });
          return {
            content: [{ type: "text", text: `Scrolled ${ref} into view` }],
            details: { ref },
          };
        }

        case "hover": {
          let x: number, y: number;
          if (ref) {
            const coords = await getCoordinatesFromRef(tabId, ref);
            x = coords.x;
            y = coords.y;
          } else if (coordinate && coordinate.length >= 2) {
            x = coordinate[0];
            y = coordinate[1];
          } else {
            throw new Error("Must provide coordinate or ref for hover");
          }

          await chrome.runtime.sendMessage({
            type: "EXECUTE_HOVER",
            tabId,
            x,
            y,
          });

          return {
            content: [{ type: "text", text: `Hovered at (${x}, ${y})` }],
            details: { x, y },
          };
        }

        case "drag": {
          if (!start_coordinate || start_coordinate.length < 2) {
            throw new Error("start_coordinate is required for drag");
          }
          if (!coordinate || coordinate.length < 2) {
            throw new Error("coordinate (end position) is required for drag");
          }

          await chrome.runtime.sendMessage({
            type: "EXECUTE_DRAG",
            tabId,
            startX: start_coordinate[0],
            startY: start_coordinate[1],
            endX: coordinate[0],
            endY: coordinate[1],
            modifiers,
          });

          return {
            content: [{ type: "text", text: `Dragged from (${start_coordinate[0]}, ${start_coordinate[1]}) to (${coordinate[0]}, ${coordinate[1]})` }],
            details: { start: start_coordinate, end: coordinate },
          };
        }

        case "wait": {
          const seconds = Math.min(duration || 1, 30);
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(resolve, seconds * 1000);
            signal?.addEventListener("abort", () => {
              clearTimeout(timeout);
              reject(new Error("Aborted"));
            }, { once: true });
          });
          return {
            content: [{ type: "text", text: `Waited ${seconds} seconds` }],
            details: { duration: seconds },
          };
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` }],
        details: {},
      };
    }
  },
};
