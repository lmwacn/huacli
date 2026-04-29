import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SqlProfile {
  driver: "mysql";
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

interface SqlConfigSection {
  defaultProfile?: string;
  profiles: Record<string, SqlProfile>;
}

interface HuaCliConfig {
  sql: SqlConfigSection;
}

const DEFAULT_CONFIG: HuaCliConfig = {
  sql: {
    profiles: {},
  },
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), ".hua", "config.json");
}

function cloneDefaultConfig(): HuaCliConfig {
  return {
    sql: {
      defaultProfile: DEFAULT_CONFIG.sql.defaultProfile,
      profiles: { ...DEFAULT_CONFIG.sql.profiles },
    },
  };
}

function normalizeProfile(value: unknown): SqlProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const host = typeof input.host === "string" ? input.host.trim() : "";
  const user = typeof input.user === "string" ? input.user.trim() : "";
  const database = typeof input.database === "string" ? input.database.trim() : "";
  const driver = input.driver === "mysql" ? "mysql" : "mysql";
  const portValue = input.port;
  const port =
    typeof portValue === "number" && Number.isFinite(portValue)
      ? Math.trunc(portValue)
      : typeof portValue === "string" && portValue.trim()
        ? Number.parseInt(portValue, 10)
        : 3306;
  const password = typeof input.password === "string" ? input.password : undefined;

  if (!host || !user || !database || !Number.isInteger(port) || port <= 0) {
    return null;
  }

  return {
    driver,
    host,
    port,
    user,
    password,
    database,
  };
}

function normalizeConfig(value: unknown): HuaCliConfig {
  const nextConfig = cloneDefaultConfig();
  if (!value || typeof value !== "object") {
    return nextConfig;
  }

  const root = value as Record<string, unknown>;
  const sql = root.sql;
  if (!sql || typeof sql !== "object") {
    return nextConfig;
  }

  const sqlObject = sql as Record<string, unknown>;
  if (typeof sqlObject.defaultProfile === "string" && sqlObject.defaultProfile.trim()) {
    nextConfig.sql.defaultProfile = sqlObject.defaultProfile.trim();
  }

  const profiles = sqlObject.profiles;
  if (!profiles || typeof profiles !== "object") {
    return nextConfig;
  }

  for (const [name, profileValue] of Object.entries(profiles as Record<string, unknown>)) {
    const profile = normalizeProfile(profileValue);
    if (!profile) {
      continue;
    }

    nextConfig.sql.profiles[name] = profile;
  }

  if (nextConfig.sql.defaultProfile && !nextConfig.sql.profiles[nextConfig.sql.defaultProfile]) {
    delete nextConfig.sql.defaultProfile;
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
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function listProfiles(): Array<{ name: string; isDefault: boolean; profile: SqlProfile }> {
  const config = loadConfig();
  const defaultProfile = config.sql.defaultProfile;
  return Object.entries(config.sql.profiles)
    .map(([name, profile]) => ({
      name,
      profile,
      isDefault: name === defaultProfile,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addOrUpdateProfile(name: string, profile: SqlProfile): void {
  const config = loadConfig();
  config.sql.profiles[name] = profile;
  if (!config.sql.defaultProfile) {
    config.sql.defaultProfile = name;
  }
  saveConfig(config);
}

export function removeProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.sql.profiles[name]) {
    return false;
  }

  delete config.sql.profiles[name];
  if (config.sql.defaultProfile === name) {
    const remainingNames = Object.keys(config.sql.profiles).sort((a, b) => a.localeCompare(b));
    config.sql.defaultProfile = remainingNames[0];
  }
  saveConfig(config);
  return true;
}

export function setDefaultProfile(name: string): boolean {
  const config = loadConfig();
  if (!config.sql.profiles[name]) {
    return false;
  }

  config.sql.defaultProfile = name;
  saveConfig(config);
  return true;
}

export function getProfile(name: string): SqlProfile | null {
  const config = loadConfig();
  return config.sql.profiles[name] ?? null;
}

export function getDefaultProfileName(): string | null {
  const config = loadConfig();
  return config.sql.defaultProfile ?? null;
}

export function resolveProfile(name?: string): { name: string; profile: SqlProfile } | null {
  const config = loadConfig();
  const targetName = name?.trim() || config.sql.defaultProfile;
  if (!targetName) {
    return null;
  }

  const profile = config.sql.profiles[targetName];
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
