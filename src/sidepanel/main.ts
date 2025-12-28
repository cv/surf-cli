import { setUseNativeHost, handleNativeApiResponse } from "./fetch-patch";
import { getModel, type OAuthCredentials, refreshOAuthToken } from "@mariozechner/pi-ai";
import {
  Agent,
  type AgentState,
  ApiKeyPromptDialog,
  AppStorage,
  ChatPanel,
  CustomProvidersStore,
  ProviderKeysStore,
  ProviderTransport,
  SessionsStore,
  SettingsStore,
  setAppStorage,
} from "@mariozechner/pi-web-ui";
import "@mariozechner/pi-web-ui/app.css";
import { ChromeStorageBackend } from "../storage/chrome-storage-backend";
import { getBrowserTools, setTargetTabId, BROWSER_AGENT_SYSTEM_PROMPT } from "../tools/browser-tools";
import { debugLog } from "../utils/debug";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type?.startsWith("API_RESPONSE_")) {
    handleNativeApiResponse(message);
  }
});

interface AuthData {
  anthropic?: OAuthCredentials;
  [key: string]: OAuthCredentials | undefined;
}

async function fetchAndStoreOAuthCredentials(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_AUTH" });
    debugLog("GET_AUTH response:", response);
    
    if (response?.auth?.anthropic) {
      const anthropicAuth = response.auth.anthropic as OAuthCredentials;
      let accessToken = anthropicAuth.access;
      
      if (anthropicAuth.expires && Date.now() > anthropicAuth.expires - 60000) {
        debugLog("Anthropic token expired or expiring soon, refreshing...");
        try {
          const newCreds = await refreshOAuthToken("anthropic", anthropicAuth);
          accessToken = newCreds.access;
          debugLog("Token refreshed successfully");
        } catch (e) {
          debugLog("Failed to refresh token:", e);
        }
      }
      
      if (accessToken) {
        await providerKeys.set("anthropic", accessToken);
        setUseNativeHost(true);
        debugLog("Stored Anthropic OAuth token, routing via native host");
      }
    } else if (response?.hint) {
      debugLog("Auth hint:", response.hint);
    }
  } catch (e) {
    debugLog("Failed to fetch OAuth credentials:", e);
  }
}

const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const configs = [
  settings.getConfig(),
  SessionsStore.getMetadataConfig(),
  providerKeys.getConfig(),
  customProviders.getConfig(),
  sessions.getConfig(),
];

const backend = new ChromeStorageBackend({ stores: configs });

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(
  settings,
  providerKeys,
  sessions,
  customProviders,
  backend
);
setAppStorage(storage);

let agent: Agent;
let chatPanel: ChatPanel;
let currentSessionId: string | null = null;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function getTabIdFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  const tabId = params.get("tabId");
  return tabId ? parseInt(tabId, 10) : null;
}

let associatedTabId: number | null = getTabIdFromUrl();

async function getSessionIdForTab(tabId: number | null): Promise<string> {
  if (!tabId) return `session-${Date.now()}`;
  
  const storageKey = `tab-session-${tabId}`;
  const result = await chrome.storage.session.get(storageKey);
  
  if (result[storageKey]) {
    return result[storageKey];
  }
  
  const newSessionId = `tab-${tabId}-${Date.now()}`;
  await chrome.storage.session.set({ [storageKey]: newSessionId });
  return newSessionId;
}

async function loadOrCreateSession(tabId: number | null): Promise<Partial<AgentState>> {
  const sessionId = await getSessionIdForTab(tabId);
  currentSessionId = sessionId;

  try {
    const sessionData = await sessions.loadSession(sessionId);
    if (sessionData && sessionData.messages && sessionData.messages.length > 0) {
      return {
        systemPrompt: BROWSER_AGENT_SYSTEM_PROMPT,
        model: sessionData.model || getModel("anthropic", "claude-sonnet-4-20250514"),
        thinkingLevel: sessionData.thinkingLevel || "off",
        messages: sessionData.messages,
        tools: [],
      };
    }
  } catch (e) {
    debugLog("Failed to load session:", e);
  }

  return {
    systemPrompt: BROWSER_AGENT_SYSTEM_PROMPT,
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
    thinkingLevel: "off",
    messages: [],
    tools: [],
  };
}

function debouncedSaveSession(state: AgentState): void {
  if (!currentSessionId) return;
  
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  
  saveDebounceTimer = setTimeout(async () => {
    try {
      const hasUserMsg = state.messages.some(m => m.role === "user");
      const hasAssistantMsg = state.messages.some(m => m.role === "assistant");
      if (!hasUserMsg || !hasAssistantMsg) return;
      
      await sessions.saveSession(currentSessionId!, state, undefined, "Tab Session");
    } catch (e) {
      debugLog("Failed to save session:", e);
    }
  }, 1000);
}

async function createAgent(initialState: Partial<AgentState>) {
  const transport = new ProviderTransport();
  
  agent = new Agent({
    initialState: initialState as AgentState,
    transport,
  });

  await chatPanel.setAgent(agent, {
    onApiKeyRequired: async (provider: string) => {
      return await ApiKeyPromptDialog.prompt(provider);
    },
    toolsFactory: (_agent, _agentInterface, _artifactsPanel, _runtimeProvidersFactory) => 
      getBrowserTools(),
  });

  agent.subscribe(async (event) => {
    if (event.type !== "state-update") return;
    const { pendingToolCalls } = event.state;
    
    debouncedSaveSession(event.state);
    
    if (!associatedTabId) return;
    
    if (pendingToolCalls.size > 0) {
      try {
        await chrome.runtime.sendMessage({
          type: "SHOW_AGENT_INDICATORS",
          tabId: associatedTabId,
        });
      } catch (e) {}
    } else {
      try {
        await chrome.runtime.sendMessage({
          type: "HIDE_AGENT_INDICATORS",
          tabId: associatedTabId,
        });
      } catch (e) {}
    }
  });
}

async function init() {
  const app = document.getElementById("app");
  if (!app) throw new Error("App container not found");

  chatPanel = new ChatPanel();
  app.appendChild(chatPanel);

  setTargetTabId(associatedTabId);

  await fetchAndStoreOAuthCredentials();

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === associatedTabId) {
      associatedTabId = null;
      setTargetTabId(null);
      if (agent) agent.abort();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STOP_AGENT" && 
        message.targetTabId === associatedTabId && 
        agent) {
      agent.abort();
    }
  });

  const initialState = await loadOrCreateSession(associatedTabId);
  await createAgent(initialState);
  debugLog("Side panel initialized for tab:", associatedTabId);
}

init().catch(console.error);
