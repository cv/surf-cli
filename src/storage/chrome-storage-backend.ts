import type {
  StorageBackend,
  StorageTransaction,
  StoreConfig,
} from "@mariozechner/pi-web-ui";

export class ChromeStorageBackend implements StorageBackend {
  private storeConfigs: Map<string, StoreConfig>;

  constructor(config: { stores: StoreConfig[] }) {
    this.storeConfigs = new Map(config.stores.map((s) => [s.name, s]));
  }

  private key(storeName: string, key: string): string {
    return `${storeName}:${key}`;
  }

  async get<T = unknown>(storeName: string, key: string): Promise<T | null> {
    const fullKey = this.key(storeName, key);
    const result = await chrome.storage.local.get(fullKey);
    return (result[fullKey] as T) ?? null;
  }

  async set<T = unknown>(
    storeName: string,
    key: string,
    value: T
  ): Promise<void> {
    const fullKey = this.key(storeName, key);
    await chrome.storage.local.set({ [fullKey]: value });
  }

  async delete(storeName: string, key: string): Promise<void> {
    const fullKey = this.key(storeName, key);
    await chrome.storage.local.remove(fullKey);
  }

  async keys(storeName: string, prefix?: string): Promise<string[]> {
    const all = await chrome.storage.local.get(null);
    const storePrefix = `${storeName}:`;
    const fullPrefix = prefix ? `${storePrefix}${prefix}` : storePrefix;

    return Object.keys(all)
      .filter((k) => k.startsWith(fullPrefix))
      .map((k) => k.slice(storePrefix.length));
  }

  async getAllFromIndex<T = unknown>(
    storeName: string,
    indexName: string,
    direction: "asc" | "desc" = "asc"
  ): Promise<T[]> {
    const allKeys = await this.keys(storeName);
    const items: T[] = [];

    for (const key of allKeys) {
      const item = await this.get<T>(storeName, key);
      if (item) items.push(item);
    }

    items.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[indexName];
      const bVal = (b as Record<string, unknown>)[indexName];
      if (aVal === undefined || aVal === null || bVal === undefined || bVal === null) return 0;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    });

    return items;
  }

  async clear(storeName: string): Promise<void> {
    const allKeys = await this.keys(storeName);
    const fullKeys = allKeys.map((k) => this.key(storeName, k));
    if (fullKeys.length > 0) {
      await chrome.storage.local.remove(fullKeys);
    }
  }

  async has(storeName: string, key: string): Promise<boolean> {
    return (await this.get(storeName, key)) !== null;
  }

  async transaction<T>(
    storeNames: string[],
    mode: "readonly" | "readwrite",
    operation: (tx: StorageTransaction) => Promise<T>
  ): Promise<T> {
    const tx: StorageTransaction = {
      get: <U>(storeName: string, key: string) => this.get<U>(storeName, key),
      set: <U>(storeName: string, key: string, value: U) =>
        this.set(storeName, key, value),
      delete: (storeName: string, key: string) => this.delete(storeName, key),
    };
    return await operation(tx);
  }

  async getQuotaInfo(): Promise<{
    usage: number;
    quota: number;
    percent: number;
  }> {
    if (chrome.storage.local.getBytesInUse) {
      const usage = await chrome.storage.local.getBytesInUse(null);
      const quota = 10 * 1024 * 1024;
      return { usage, quota, percent: (usage / quota) * 100 };
    }
    return { usage: 0, quota: 10 * 1024 * 1024, percent: 0 };
  }

  async requestPersistence(): Promise<boolean> {
    return true;
  }
}
