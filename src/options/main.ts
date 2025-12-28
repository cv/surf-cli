import "@mariozechner/pi-web-ui/app.css";

const app = document.getElementById("app")!;

app.innerHTML = `
  <h1 style="font-size: 1.5rem; font-weight: bold; margin-bottom: 1.5rem;">Pi Agent Settings</h1>
  
  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">API Keys</h2>
    <p style="color: #666; margin-bottom: 1rem;">
      API keys are stored locally in your browser and never sent to any server except the provider's API.
    </p>
    <button id="clear-keys" style="padding: 0.5rem 1rem; background: #dc2626; color: white; border: none; border-radius: 0.375rem; cursor: pointer;">
      Clear All API Keys
    </button>
  </section>
  
  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Debug Mode</h2>
    <label style="display: flex; align-items: center; gap: 0.5rem;">
      <input type="checkbox" id="debug-mode" style="width: 1rem; height: 1rem;" />
      <span>Enable debug logging</span>
    </label>
  </section>
  
  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">Static Indicator</h2>
    <label style="display: flex; align-items: center; gap: 0.5rem;">
      <span>Heartbeat interval (seconds):</span>
      <input type="number" id="heartbeat-interval" min="5" max="60" value="10" style="width: 4rem; padding: 0.25rem 0.5rem; border: 1px solid #ccc; border-radius: 0.25rem;" />
    </label>
    <p style="color: #666; font-size: 0.875rem; margin-top: 0.5rem;">
      How often the static indicator checks if Pi Agent is still active (5-60 seconds).
    </p>
  </section>
  
  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem;">About</h2>
    <p style="color: #666;">
      Pi Agent v${chrome.runtime.getManifest().version}
    </p>
  </section>
`;

document.getElementById("clear-keys")?.addEventListener("click", async () => {
  if (confirm("Are you sure you want to clear all stored API keys?")) {
    const keys = await chrome.storage.local.get(null);
    const keysToClear = Object.keys(keys).filter(k => k.startsWith("provider-keys:"));
    await chrome.storage.local.remove(keysToClear);
    alert("API keys cleared.");
  }
});

const debugCheckbox = document.getElementById("debug-mode") as HTMLInputElement | null;
if (debugCheckbox) {
  chrome.storage.local.get("debugMode").then(({ debugMode }) => {
    debugCheckbox.checked = !!debugMode;
  });
  debugCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ debugMode: debugCheckbox.checked });
  });
}

const heartbeatInput = document.getElementById("heartbeat-interval") as HTMLInputElement | null;
if (heartbeatInput) {
  chrome.storage.local.get("heartbeatInterval").then(({ heartbeatInterval }) => {
    heartbeatInput.value = String(heartbeatInterval ?? 10);
  });
  heartbeatInput.addEventListener("change", () => {
    const value = Math.max(5, Math.min(60, parseInt(heartbeatInput.value, 10) || 10));
    heartbeatInput.value = String(value);
    chrome.storage.local.set({ heartbeatInterval: value });
  });
}
