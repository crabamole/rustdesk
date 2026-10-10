let HOST = "/ws/id";
let CONFIG_KEY = "";
let API_SERVER = "";

export function setConfig(host: string, key: string) {
  HOST = host;
  CONFIG_KEY = key;
}

export function getHost(): string {
  return HOST;
}

export function getConfigKey(): string {
  return CONFIG_KEY;
}

export function getApiServer(): string {
  return API_SERVER || location.origin;
}

export function resolveUri(value: string): string {
  if (value.startsWith("/")) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    return scheme + "://" + location.host + value;
  }
  return value;
}

export function getDefaultUri(): string {
  return resolveUri(HOST);
}

// hbbs names the relay pod to dial; the web client never picks one itself.
export function getRelayUri(relayServer?: string): string {
  if (relayServer && /^wss?:\/\//.test(relayServer)) return relayServer;
  throw new Error("No WebSocket relay from the rendezvous server: " + JSON.stringify(relayServer ?? ""));
}

export async function loadConfig(): Promise<void> {
  try {
    const resp = await fetch("config.json");
    if (resp.ok) {
      const config = await resp.json();
      if (config.host) HOST = config.host;
      if (config.key) CONFIG_KEY = config.key;
      if (config.api) API_SERVER = config.api;
      console.log("Loaded config: host=" + HOST);
    }
  } catch (e) {
    console.log("Failed to load config.json (" + e + "), using defaults (host=" + HOST + ")");
  }
}
