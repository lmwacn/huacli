import mysql from "mysql2/promise";
import readline from "node:readline";
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
            connectTimeout: 5000,
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
      name: "shell",
      description: "Interactive SQL shell with connection reuse (30s idle timeout)",
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
        {
          flags: "-t, --timeout <seconds>",
          description: "Idle timeout in seconds (default: 30)",
          defaultValue: 30,
        },
      ],
      async action(context) {
        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SQL profile. Use `hua sql profile add <name> --host ... --user ... --database ...` first.",
          );
        }

        const { profile } = resolved;
        const timeoutSec = Number.parseInt(readStringOption(context.options, "timeout") || "30", 10);
        const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 30) * 1000;

        const connection = await mysql.createConnection({
          host: profile.host,
          port: profile.port,
          user: profile.user,
          password: profile.password,
          database: profile.database,
          connectTimeout: 5000,
          multipleStatements: true,
        });

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let closed = false;

        const resetTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(async () => {
            if (closed) return;
            closed = true;
            try { await connection.end(); } catch {}
            process.exit(0);
          }, timeoutMs);
        };

        const closeConn = async () => {
          if (closed) return;
          closed = true;
          if (idleTimer) clearTimeout(idleTimer);
          try { await connection.end(); } catch {}
        };

        const isTTY = process.stdin.isTTY;

        if (isTTY) {
          context.log(`Connected to ${profile.user}@${profile.host}:${profile.port}/${profile.database}`);
          context.log(`Idle timeout: ${timeoutSec}s | Type 'exit' to quit`);
        }

        resetTimer();

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: isTTY ? "sql> " : undefined,
          terminal: isTTY,
        });

        if (isTTY) rl.prompt();

        let buffer = "";

        rl.on("line", async (line: string) => {
          const trimmed = line.trim();

          // exit/quit check (always, even mid-buffer)
          const cmd = trimmed.replace(/;+$/, "").toLowerCase();
          if (["exit", "quit", "\\q"].includes(cmd)) {
            buffer = "";
            rl.close();
            return;
          }

          buffer += (buffer ? "\n" : "") + line;

          // Check if statement is complete (ends with ;)
          const bufTrimmed = buffer.trim();
          if (!bufTrimmed.endsWith(";")) {
            // Incomplete statement, show continuation prompt
            if (isTTY) process.stdout.write("  -> ");
            return;
          }

          const statement = bufTrimmed.replace(/;+$/, "").trim();
          buffer = "";

          if (!statement) {
            if (isTTY) rl.prompt();
            return;
          }

          resetTimer();

          try {
            const [rows, fields] = await connection.query(statement);

            const anyFields = fields as any;
            const anyRows = rows as any;

            // multipleStatements: fields is array of FieldPacket[] for each result
            if (Array.isArray(anyFields) && anyFields.length > 0 && Array.isArray(anyFields[0])) {
              for (let i = 0; i < anyFields.length; i++) {
                if (anyFields[i] && anyFields[i].length > 0) {
                  console.log(formatResults(anyFields[i], anyRows[i] || []));
                } else if (i < anyRows.length) {
                  const affectedRows = anyRows[i]?.affectedRows;
                  if (affectedRows !== undefined) {
                    console.log(`Query OK, ${affectedRows} row(s) affected`);
                  } else {
                    console.log("Query executed successfully");
                  }
                }
                if (i < anyFields.length - 1) console.log("");
              }
            } else if (anyFields && anyFields.length > 0) {
              console.log(formatResults(anyFields, anyRows));
            } else {
              const affectedRows = anyRows?.affectedRows;
              if (affectedRows !== undefined) {
                console.log(`Query OK, ${affectedRows} row(s) affected`);
              } else {
                console.log("Query executed successfully");
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${message}`);
          }

          if (isTTY) rl.prompt();
        });

        rl.on("close", async () => {
          await closeConn();
          process.exit(0);
        });

        // Keep process alive waiting for input
        await new Promise<void>((resolve) => {
          rl.on("close", resolve);
          process.on("SIGINT", async () => {
            await closeConn();
            rl.close();
            resolve();
          });
        });
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
