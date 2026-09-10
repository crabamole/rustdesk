let HOST = "/ws/id";
let RELAY_HOST = "/ws/relay";
let CONFIG_KEY = "";
let API_SERVER = "";

export function setConfig(host: string, relay: string, key: string) {
  HOST = host;
  RELAY_HOST = relay;
  CONFIG_KEY = key;
}

export function getHost(): string {
  return HOST;
}

export function getRelayHost(): string {
  return RELAY_HOST;
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

export function getDefaultUri(isRelay: Boolean = false): string {
  const raw = isRelay ? (RELAY_HOST || HOST) : HOST;
  return resolveUri(raw);
}

export async function loadConfig(): Promise<void> {
  try {
    const resp = await fetch("config.json");
    if (resp.ok) {
      const config = await resp.json();
      if (config.host) HOST = config.host;
      if (config.relay) RELAY_HOST = config.relay;
      if (config.key) CONFIG_KEY = config.key;
      if (config.api) API_SERVER = config.api;
      console.log("Loaded config: host=" + HOST + ", relay=" + (RELAY_HOST || HOST));
    }
  } catch (e) {
    console.log("Failed to load config.json (" + e + "), using defaults (host=" + HOST + ")");
  }
}
