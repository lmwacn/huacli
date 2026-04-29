import { definePlugin } from "@hua/plugin-sdk";
import {
  addOrUpdateProfile,
  getConfigPath,
  getDefaultProfileName,
  getProfile,
  listProfiles,
  removeProfile,
  resolveProfile,
  setDefaultProfile,
  SqlProfile,
} from "./profile-store";

function readStringOption(options: Record<string, unknown>, key: string): string {
  const value = options[key];
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function maskPassword(password?: string): string {
  if (!password) {
    return "(empty)";
  }
  return "*".repeat(Math.max(6, Math.min(12, password.length)));
}

function formatProfile(name: string, profile: SqlProfile, isDefault: boolean): string {
  const defaultTag = isDefault ? " (default)" : "";
  return `${name}${defaultTag} -> ${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}

export const sqlPlugin = definePlugin({
  name: "sql",
  description: "SQL tools and database commands",
  commands: [
    {
      name: "query",
      description: "Run a SQL query against a configured datasource",
      arguments: ["<statement>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const statement = context.args[0] ?? "";
        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SQL profile. Use `hua sql profile add <name> --host ... --user ... --database ...` first.",
          );
        }

        context.log(`[sql] profile=${resolved.name}`);
        context.log(`[sql] query=${statement}`);
        context.log(
          `[sql] target=${resolved.profile.user}@${resolved.profile.host}:${resolved.profile.port}/${resolved.profile.database}`,
        );
        context.log("SQL execution is not connected yet. Next step is wiring mysql2 and profile config.");
      },
    },
    {
      name: "list",
      parentPath: ["profile"],
      aliases: ["ls"],
      description: "List configured SQL connection profiles",
      async action(context) {
        const profiles = listProfiles();
        if (profiles.length === 0) {
          context.log(`No profiles configured yet. Config file: ${getConfigPath()}`);
          return;
        }

        context.log(`Config file: ${getConfigPath()}`);
        for (const item of profiles) {
          context.log(formatProfile(item.name, item.profile, item.isDefault));
        }
      },
    },
    {
      name: "add",
      parentPath: ["profile"],
      description: "Create or update a SQL connection profile",
      arguments: ["<name>"],
      options: [
        { flags: "--host <host>", description: "Database host" },
        { flags: "--port <port>", description: "Database port", defaultValue: 3306 },
        { flags: "--user <user>", description: "Database user" },
        { flags: "--password <password>", description: "Database password (optional)" },
        { flags: "--database <database>", description: "Database name" },
      ],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const host = readStringOption(context.options, "host");
        const user = readStringOption(context.options, "user");
        const database = readStringOption(context.options, "database");
        const password = readStringOption(context.options, "password");
        const port = Number.parseInt(readStringOption(context.options, "port") || "3306", 10);

        if (!host || !user || !database) {
          throw new Error("Missing required options. Required: --host, --user, --database.");
        }
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error("Option --port must be a positive integer.");
        }

        addOrUpdateProfile(name, {
          driver: "mysql",
          host,
          port,
          user,
          password: password || undefined,
          database,
        });

        const defaultProfile = getDefaultProfileName();
        context.log(`Saved profile: ${name}`);
        context.log(
          formatProfile(
            name,
            { driver: "mysql", host, port, user, password: password || undefined, database },
            defaultProfile === name,
          ),
        );
      },
    },
    {
      name: "use",
      parentPath: ["profile"],
      description: "Set default SQL profile",
      arguments: ["<name>"],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const ok = setDefaultProfile(name);
        if (!ok) {
          throw new Error(`Profile not found: ${name}`);
        }

        context.log(`Default SQL profile set to: ${name}`);
      },
    },
    {
      name: "show",
      parentPath: ["profile"],
      description: "Show profile detail by name or current default profile",
      arguments: ["[name]"],
      async action(context) {
        const inputName = (context.args[0] ?? "").trim();
        const targetName = inputName || getDefaultProfileName() || "";
        if (!targetName) {
          throw new Error("No default profile set. Use `hua sql profile add <name> ...` first.");
        }

        const profile = getProfile(targetName);
        if (!profile) {
          throw new Error(`Profile not found: ${targetName}`);
        }

        const isDefault = getDefaultProfileName() === targetName;
        context.log(formatProfile(targetName, profile, isDefault));
        context.log(`driver=${profile.driver}`);
        context.log(`password=${maskPassword(profile.password)}`);
      },
    },
    {
      name: "remove",
      parentPath: ["profile"],
      aliases: ["rm"],
      description: "Remove a SQL connection profile",
      arguments: ["<name>"],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const ok = removeProfile(name);
        if (!ok) {
          throw new Error(`Profile not found: ${name}`);
        }

        const currentDefault = getDefaultProfileName();
        context.log(`Removed profile: ${name}`);
        context.log(`Current default profile: ${currentDefault ?? "(none)"}`);
      },
    },
  ],
});
