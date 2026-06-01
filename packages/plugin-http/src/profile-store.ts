import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HttpProfile } from "./types";

interface HttpConfigSection {
  defaultProfile?: string;
  profiles: Record<string, HttpProfile>;
}

interface HuaCliConfig {
  http: HttpConfigSection;
}

function getConfigFilePath(): string {
  return path.join(os.homedir(), ".hua", "config.json");
}

function loadFullConfig(): HuaCliConfig {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    return { http: { profiles: {} } };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  if (!raw.trim()) {
    return { http: { profiles: {} } };
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const http = parsed.http as Record<string, unknown> | undefined;

  if (!http || typeof http !== "object") {
    return { http: { profiles: {} } };
  }

  const profiles: Record<string, HttpProfile> = {};
  const rawProfiles = http.profiles as Record<string, unknown> | undefined;

  if (rawProfiles && typeof rawProfiles === "object") {
    for (const [name, value] of Object.entries(rawProfiles)) {
      if (!value || typeof value !== "object") continue;
      const p = value as Record<string, unknown>;
      const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim() : "";
      if (!baseUrl) continue;

      profiles[name] = {
        baseUrl,
        headers: typeof p.headers === "object" && p.headers !== null ? p.headers as Record<string, string> : undefined,
        timeout: typeof p.timeout === "number" ? p.timeout : undefined,
        auth: typeof p.auth === "object" && p.auth !== null ? p.auth as HttpProfile["auth"] : undefined,
      };
    }
  }

  return {
    http: {
      defaultProfile: typeof http.defaultProfile === "string" ? http.defaultProfile : undefined,
      profiles,
    },
  };
}

function saveFullConfig(config: Record<string, unknown>): void {
  const configPath = getConfigFilePath();
  const configDir = path.dirname(configPath);

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf8").trim();
    if (raw) {
      try {
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        existing = {};
      }
    }
  }

  existing.http = config.http;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

export function listProfiles(): Array<{ name: string; isDefault: boolean; profile: HttpProfile }> {
  const config = loadFullConfig();
  return Object.entries(config.http.profiles)
    .map(([name, profile]) => ({
      name,
      profile,
      isDefault: name === config.http.defaultProfile,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addOrUpdateProfile(name: string, profile: HttpProfile): void {
  const fullConfig = JSON.parse(JSON.stringify(loadFullConfig())) as Record<string, unknown>;
  const httpSection = fullConfig.http as HttpConfigSection;
  httpSection.profiles[name] = profile;
  if (!httpSection.defaultProfile) {
    httpSection.defaultProfile = name;
  }
  saveFullConfig(fullConfig);
}

export function removeProfile(name: string): boolean {
  const fullConfig = JSON.parse(JSON.stringify(loadFullConfig())) as Record<string, unknown>;
  const httpSection = fullConfig.http as HttpConfigSection;
  if (!httpSection.profiles[name]) {
    return false;
  }

  delete httpSection.profiles[name];
  if (httpSection.defaultProfile === name) {
    const remaining = Object.keys(httpSection.profiles).sort((a, b) => a.localeCompare(b));
    httpSection.defaultProfile = remaining[0];
  }
  saveFullConfig(fullConfig);
  return true;
}

export function setDefaultProfile(name: string): boolean {
  const fullConfig = JSON.parse(JSON.stringify(loadFullConfig())) as Record<string, unknown>;
  const httpSection = fullConfig.http as HttpConfigSection;
  if (!httpSection.profiles[name]) {
    return false;
  }

  httpSection.defaultProfile = name;
  saveFullConfig(fullConfig);
  return true;
}

export function getProfile(name: string): HttpProfile | null {
  const config = loadFullConfig();
  return config.http.profiles[name] ?? null;
}

export function getDefaultProfileName(): string | null {
  const config = loadFullConfig();
  return config.http.defaultProfile ?? null;
}

export function resolveProfile(name?: string): { name: string; profile: HttpProfile } | null {
  const config = loadFullConfig();
  const targetName = name?.trim() || config.http.defaultProfile;
  if (!targetName) {
    return null;
  }

  const profile = config.http.profiles[targetName];
  if (!profile) {
    return null;
  }

  return { name: targetName, profile };
}

export function getConfigPath(): string {
  return getConfigFilePath();
}
