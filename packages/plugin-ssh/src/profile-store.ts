import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SshProfile } from "./types";

interface SshConfigSection {
  defaultProfile?: string;
  profiles: Record<string, SshProfile>;
}

interface HuaCliConfig {
  ssh: SshConfigSection;
}

const DEFAULT_CONFIG: HuaCliConfig = {
  ssh: {
    profiles: {},
  },
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), ".hua", "config.json");
}

function cloneDefaultConfig(): HuaCliConfig {
  return {
    ssh: {
      defaultProfile: DEFAULT_CONFIG.ssh.defaultProfile,
      profiles: { ...DEFAULT_CONFIG.ssh.profiles },
    },
  };
}

function normalizeProfile(value: unknown): SshProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";

  if (!host || !username) {
    return null;
  }

  const portValue = input.port;
  const port =
    typeof portValue === "number" && Number.isFinite(portValue)
      ? Math.trunc(portValue)
      : typeof portValue === "string" && portValue.trim()
        ? Number.parseInt(portValue, 10)
        : 22;

  const authMethod = input.authMethod === "key" ? "key" : "password";
  const password = typeof input.password === "string" ? input.password : undefined;
  const privateKeyPath = typeof input.privateKeyPath === "string" ? input.privateKeyPath : undefined;
  const passphrase = typeof input.passphrase === "string" ? input.passphrase : undefined;

  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  return {
    host,
    port,
    username,
    authMethod,
    password,
    privateKeyPath,
    passphrase,
  };
}

function normalizeConfig(value: unknown): HuaCliConfig {
  const nextConfig = cloneDefaultConfig();
  if (!value || typeof value !== "object") {
    return nextConfig;
  }

  const root = value as Record<string, unknown>;
  const ssh = root.ssh;
  if (!ssh || typeof ssh !== "object") {
    return nextConfig;
  }

  const sshObject = ssh as Record<string, unknown>;
  if (typeof sshObject.defaultProfile === "string" && sshObject.defaultProfile.trim()) {
    nextConfig.ssh.defaultProfile = sshObject.defaultProfile.trim();
  }

  const profiles = sshObject.profiles;
  if (!profiles || typeof profiles !== "object") {
    return nextConfig;
  }

  for (const [name, profileValue] of Object.entries(profiles as Record<string, unknown>)) {
    const profile = normalizeProfile(profileValue);
    if (!profile) {
      continue;
    }

    nextConfig.ssh.profiles[name] = profile;
  }

  if (nextConfig.ssh.defaultProfile && !nextConfig.ssh.profiles[nextConfig.ssh.defaultProfile]) {
    delete nextConfig.ssh.defaultProfile;
  }

  return nextConfig;
}

export function loadConfig(): HuaCliConfig {
  const configPath = getConfigFilePath();
  if (!fs.existsSync(configPath)) {
    return cloneDefaultConfig();
  }

  const raw = fs.readFileSync(configPath, "utf8");
  if (!raw.trim()) {
    return cloneDefaultConfig();
  }

  const parsed = JSON.parse(raw) as unknown;
  return normalizeConfig(parsed);
}

function saveConfig(config: HuaCliConfig): void {
  const configPath = getConfigFilePath();
  const configDirectory = path.dirname(configPath);

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

  existing.ssh = config.ssh;
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

export function listProfiles(): Array<{ name: string; isDefault: boolean; profile: SshProfile }> {
  const config = loadConfig();
  const defaultProfile = config.ssh.defaultProfile;
  return Object.entries(config.ssh.profiles)
    .map(([name, profile]) => ({
      name,
      profile,
      isDefault: name === defaultProfile,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addOrUpdateProfile(name: string, profile: SshProfile): void {
  const config = loadConfig();
  config.ssh.profiles[name] = profile;
  if (!config.ssh.defaultProfile) {
    config.ssh.defaultProfile = name;
  }
  saveConfig(config);
}

export function removeProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.ssh.profiles[name]) {
    return false;
  }

  delete config.ssh.profiles[name];
  if (config.ssh.defaultProfile === name) {
    const remainingNames = Object.keys(config.ssh.profiles).sort((a, b) => a.localeCompare(b));
    config.ssh.defaultProfile = remainingNames[0];
  }
  saveConfig(config);
  return true;
}

export function setDefaultProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.ssh.profiles[name]) {
    return false;
  }

  config.ssh.defaultProfile = name;
  saveConfig(config);
  return true;
}

export function getProfile(name: string): SshProfile | null {
  const config = loadConfig();
  return config.ssh.profiles[name] ?? null;
}

export function getDefaultProfileName(): string | null {
  const config = loadConfig();
  return config.ssh.defaultProfile ?? null;
}

export function resolveProfile(name?: string): { name: string; profile: SshProfile } | null {
  const config = loadConfig();
  const targetName = name?.trim() || config.ssh.defaultProfile;
  if (!targetName) {
    return null;
  }

  const profile = config.ssh.profiles[targetName];
  if (!profile) {
    return null;
  }

  return {
    name: targetName,
    profile,
  };
}

export function getConfigPath(): string {
  return getConfigFilePath();
}
