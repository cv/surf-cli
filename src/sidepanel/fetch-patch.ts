const originalFetch = globalThis.fetch;

let useNativeHost = false;
let nativeStreamCallbacks = new Map<string, {
  onStart: (status: number, headers: Record<string, string>) => void;
  onChunk: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}>();
let streamIdCounter = 0;

export function setUseNativeHost(value: boolean) {
  useNativeHost = value;
  console.log("[Pi Agent] Native host for API calls:", value ? "enabled" : "disabled");
}

export function handleNativeApiResponse(msg: any): boolean {
  const { type, streamId } = msg;
  if (!streamId || !nativeStreamCallbacks.has(streamId)) return false;
  
  const callbacks = nativeStreamCallbacks.get(streamId)!;
  
  switch (type) {
    case "API_RESPONSE_START":
      callbacks.onStart(msg.status, msg.headers);
      return true;
    case "API_RESPONSE_CHUNK":
      callbacks.onChunk(msg.chunk);
      return true;
    case "API_RESPONSE_END":
      callbacks.onEnd();
      nativeStreamCallbacks.delete(streamId);
      return true;
    case "API_RESPONSE_ERROR":
      callbacks.onError(msg.error);
      nativeStreamCallbacks.delete(streamId);
      return true;
  }
  return false;
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  if (Array.isArray(headers)) {
    const obj: Record<string, string> = {};
    for (const [key, value] of headers) {
      obj[key] = value;
    }
    return obj;
  }
  return headers as Record<string, string>;
}

globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  
  if (useNativeHost && url.includes("api.anthropic.com")) {
    const headersObj = headersToObject(init?.headers);
    console.log("[Pi Agent] Routing Anthropic API call through native host:", url, "headers:", Object.keys(headersObj));
    
    return new Promise((resolve, reject) => {
      const streamId = `stream_${++streamIdCounter}_${Date.now()}`;
      let responseBody = "";
      let status = 200;
      let headers: Record<string, string> = {};
      
      nativeStreamCallbacks.set(streamId, {
        onStart: (s, h) => {
          status = s;
          headers = h;
        },
        onChunk: (chunk) => {
          responseBody += chunk;
        },
        onEnd: () => {
          resolve(new Response(responseBody, { status, headers }));
        },
        onError: (error) => {
          reject(new Error(error));
        },
      });
      
      chrome.runtime.sendMessage({
        type: "NATIVE_API_REQUEST",
        streamId,
        url,
        method: init?.method || "POST",
        headers: headersObj,
        body: init?.body,
      }).catch(err => {
        nativeStreamCallbacks.delete(streamId);
        reject(err);
      });
    });
  }
  
  return originalFetch(input, init);
};
