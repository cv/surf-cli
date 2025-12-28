import {
  type AgentContext,
  type AgentLoopConfig,
  agentLoop,
  agentLoopContinue,
  type Message,
  type UserMessage,
} from "@mariozechner/pi-ai";
import { getAppStorage } from "@mariozechner/pi-web-ui";
import type { AgentRunConfig, AgentTransport } from "@mariozechner/pi-web-ui";
import { nativeApiFetch } from "../native/native-api-transport";
import { debugLog } from "../utils/debug";

function isOAuthToken(apiKey: string): boolean {
  return apiKey.startsWith("sk-ant-oat");
}

export class NativeProviderTransport implements AgentTransport {
  private async getModel(cfg: AgentRunConfig) {
    const apiKey = await getAppStorage().providerKeys.get(cfg.model.provider);
    if (!apiKey) {
      throw new Error("no-api-key");
    }
    return cfg.model;
  }

  private buildContext(messages: Message[], cfg: AgentRunConfig): AgentContext {
    return {
      systemPrompt: cfg.systemPrompt,
      messages,
      tools: cfg.tools,
    };
  }

  private buildLoopConfig(model: AgentRunConfig["model"], cfg: AgentRunConfig): AgentLoopConfig {
    return {
      model,
      reasoning: cfg.reasoning,
      getApiKey: async (provider: string) => {
        const key = await getAppStorage().providerKeys.get(provider);
        return key ?? undefined;
      },
      getQueuedMessages: cfg.getQueuedMessages,
      customFetch: async (url: string, init?: RequestInit) => {
        const apiKey = await getAppStorage().providerKeys.get(cfg.model.provider);
        
        if (apiKey && isOAuthToken(apiKey)) {
          debugLog("Using native host for OAuth API request");
          return this.nativeFetch(url, init);
        }
        
        return fetch(url, init);
      },
    };
  }

  private async nativeFetch(url: string, init?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      let status = 200;
      let headers: Record<string, string> = {};

      nativeApiFetch(
        url,
        {
          method: init?.method as string,
          headers: init?.headers as Record<string, string>,
          body: init?.body as string,
        },
        {
          onStart: (s, h) => {
            status = s;
            headers = h;
          },
          onChunk: (chunk) => {
            chunks.push(chunk);
          },
          onEnd: () => {
            const body = chunks.join("");
            const response = new Response(body, {
              status,
              headers,
            });
            resolve(response);
          },
          onError: (error) => {
            reject(new Error(error));
          },
        }
      );
    });
  }

  async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
    const model = await this.getModel(cfg);
    const context = this.buildContext(messages, cfg);
    const pc = this.buildLoopConfig(model, cfg);

    for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal)) {
      yield ev;
    }
  }

  async *continue(messages: Message[], cfg: AgentRunConfig, signal?: AbortSignal) {
    const model = await this.getModel(cfg);
    const context = this.buildContext(messages, cfg);
    const pc = this.buildLoopConfig(model, cfg);

    for await (const ev of agentLoopContinue(context, pc, signal)) {
      yield ev;
    }
  }
}
