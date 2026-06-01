import mysql from "mysql2/promise";
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

function formatResults(columns: mysql.FieldPacket[], rows: unknown[]): string {
  if (rows.length === 0) {
    return "(empty result set)";
  }

  const colWidths = columns.map((col) => col.name.length);
  const data = rows as Record<string, unknown>[];

  for (const row of data) {
    columns.forEach((col, i) => {
      const val = String(row[col.name] ?? "NULL");
      colWidths[i] = Math.max(colWidths[i], val.length);
    });
  }

  const header = columns.map((col, i) => col.name.padEnd(colWidths[i])).join(" | ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");

  const lines: string[] = [header, separator];
  for (const row of data) {
    const rowStr = columns.map((col, i) => String(row[col.name] ?? "NULL").padEnd(colWidths[i])).join(" | ");
    lines.push(rowStr);
  }

  lines.push(`\n${rows.length} row(s) returned`);
  return lines.join("\n");
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

        const { profile } = resolved;

        let connection: mysql.Connection | null = null;
        try {
          connection = await mysql.createConnection({
            host: profile.host,
            port: profile.port,
            user: profile.user,
            password: profile.password,
            database: profile.database,
          });

          const [rows, fields] = await connection.query(statement);

          if (!fields || fields.length === 0) {
            const affectedRows = (rows as mysql.ResultSetHeader).affectedRows;
            if (affectedRows !== undefined) {
              context.log(`Query OK, ${affectedRows} row(s) affected`);
            } else {
              context.log("Query executed successfully");
            }
          } else {
            context.log(formatResults(fields as mysql.FieldPacket[], rows as unknown[]));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Query failed (target: ${profile.user}@${profile.host}:${profile.port}/${profile.database}): ${message}`);
        } finally {
          if (connection) {
            await connection.end();
          }
        }
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
