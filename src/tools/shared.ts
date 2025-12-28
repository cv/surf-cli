let targetTabId: number | null = null;

export function setSharedTargetTabId(tabId: number | null): void {
  targetTabId = tabId;
}

export async function getSharedTargetTabId(): Promise<number> {
  if (targetTabId) return targetTabId;
  const response = await chrome.runtime.sendMessage({ type: "GET_CURRENT_TAB_ID" });
  if (!response.tabId) throw new Error("No active tab");
  return response.tabId;
}
