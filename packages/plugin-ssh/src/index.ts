import readline from "node:readline";
import { Client } from "ssh2";
import { definePlugin } from "@hua/plugin-sdk";
import { buildConnectConfig, execCommand, uploadFile, downloadFile } from "./client";
import {
  addOrUpdateProfile,
  getConfigPath,
  getDefaultProfileName,
  getProfile,
  listProfiles,
  removeProfile,
  resolveProfile,
  setDefaultProfile,
} from "./profile-store";
import { SshProfile } from "./types";

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

function formatProfile(name: string, profile: SshProfile, isDefault: boolean): string {
  const defaultTag = isDefault ? " (default)" : "";
  return `${name}${defaultTag} -> ${profile.username}@${profile.host}:${profile.port}`;
}

export const sshPlugin = definePlugin({
  name: "ssh",
  description: "SSH remote server commands",
  commands: [
    {
      name: "exec",
      description: "Execute a command on a remote SSH server",
      arguments: ["<command>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const command = context.args[0] ?? "";
        if (!command) {
          throw new Error("Command is required.");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          const result = await execCommand(profile, command);

          if (result.stdout) {
            context.log(result.stdout);
          }

          if (result.stderr) {
            context.log(result.stderr);
          }

          if (result.exitCode !== 0) {
            throw new Error(`Command exited with code ${result.exitCode}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`SSH exec failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "shell",
      description: "Interactive SSH shell with connection reuse (30s idle timeout)",
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
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;
        const timeoutSec = Number.parseInt(readStringOption(context.options, "timeout") || "30", 10);
        const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 30) * 1000;

        const conn = new Client();
        await new Promise<void>((resolve, reject) => {
          conn.on("ready", () => resolve());
          conn.on("error", (err) => reject(new Error(`SSH connection failed: ${err.message}`)));
          conn.connect(buildConnectConfig(profile));
        });

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let closed = false;

        const resetTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (closed) return;
            closed = true;
            conn.end();
            process.exit(0);
          }, timeoutMs);
        };

        const closeConn = () => {
          if (closed) return;
          closed = true;
          if (idleTimer) clearTimeout(idleTimer);
          conn.end();
        };

        const isTTY = process.stdin.isTTY;

        if (isTTY) {
          context.log(`Connected to ${profile.username}@${profile.host}:${profile.port}`);
          context.log(`Idle timeout: ${timeoutSec}s | Type 'exit' to quit`);
        }

        resetTimer();

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: isTTY ? "ssh> " : undefined,
          terminal: isTTY,
        });

        if (isTTY) rl.prompt();

        let running = false;
        let inputClosed = false;
        const queue: string[] = [];

        const tryExit = () => {
          if (inputClosed && !running && queue.length === 0) {
            closeConn();
            process.exit(0);
          }
        };

        const executeCommand = (line: string) => {
          running = true;
          resetTimer();

          conn.exec(line, (err, stream) => {
            if (err) {
              console.error(`Error: ${err.message}`);
              running = false;
              if (isTTY) rl.prompt();
              if (queue.length > 0) {
                executeCommand(queue.shift()!);
              } else {
                tryExit();
              }
              return;
            }

            stream.stderr.on("data", (data: Buffer) => {
              process.stderr.write(data);
            });

            stream.on("data", (data: Buffer) => {
              process.stdout.write(data);
            });

            stream.on("close", () => {
              running = false;
              if (isTTY) rl.prompt();
              if (queue.length > 0) {
                executeCommand(queue.shift()!);
              } else {
                tryExit();
              }
            });
          });
        };

        rl.on("line", (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) {
            if (isTTY) rl.prompt();
            return;
          }

          if (["exit", "quit", "\\q"].includes(trimmed.toLowerCase())) {
            rl.close();
            return;
          }

          if (running) {
            queue.push(trimmed);
            return;
          }

          executeCommand(trimmed);
        });

        rl.on("close", () => {
          inputClosed = true;
          tryExit();
        });

        await new Promise<void>((resolve) => {
          rl.on("close", resolve);
          process.on("SIGINT", () => {
            closeConn();
            rl.close();
            resolve();
          });
        });
      },
    },
    {
      name: "upload",
      description: "Upload a local file to remote server via SFTP",
      arguments: ["<localPath>", "<remotePath>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const localPath = (context.args[0] ?? "").trim();
        let remotePath = (context.args[1] ?? "").trim();

        // Git Bash auto-converts /root/... to Windows path, undo it
        if (remotePath.startsWith("C:/Program Files/Git")) {
          remotePath = remotePath.slice("C:/Program Files/Git".length);
        }

        if (!localPath || !remotePath) {
          throw new Error("Usage: hua ssh upload <localPath> <remotePath>");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          await uploadFile(profile, localPath, remotePath);
          context.log(`Uploaded: ${localPath} -> ${profile.host}:${remotePath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Upload failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "download",
      description: "Download a file from remote server via SFTP",
      arguments: ["<remotePath>", "<localPath>"],
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        let remotePath = (context.args[0] ?? "").trim();
        const localPath = (context.args[1] ?? "").trim();

        // Git Bash auto-converts /root/... to Windows path, undo it
        if (remotePath.startsWith("C:/Program Files/Git")) {
          remotePath = remotePath.slice("C:/Program Files/Git".length);
        }

        if (!remotePath || !localPath) {
          throw new Error("Usage: hua ssh download <remotePath> <localPath>");
        }

        const explicitProfile = readStringOption(context.options, "profile");
        const resolved = resolveProfile(explicitProfile);

        if (!resolved) {
          throw new Error(
            "No available SSH profile. Use `hua ssh profile add <name> --host ... --username ...` first.",
          );
        }

        const { profile } = resolved;

        try {
          await downloadFile(profile, remotePath, localPath);
          context.log(`Downloaded: ${profile.host}:${remotePath} -> ${localPath}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Download failed (target: ${profile.username}@${profile.host}:${profile.port}): ${message}`);
        }
      },
    },
    {
      name: "list",
      parentPath: ["profile"],
      aliases: ["ls"],
      description: "List configured SSH profiles",
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
      description: "Create or update an SSH profile",
      arguments: ["<name>"],
      options: [
        { flags: "--host <host>", description: "SSH server host" },
        { flags: "--port <port>", description: "SSH server port", defaultValue: 22 },
        { flags: "--username <username>", description: "SSH username" },
        { flags: "--auth-method <method>", description: "Authentication method: password or key", defaultValue: "password" },
        { flags: "--password <password>", description: "Password (for password auth)" },
        { flags: "--private-key <path>", description: "Path to private key file (for key auth)" },
        { flags: "--passphrase <passphrase>", description: "Passphrase for private key (optional)" },
      ],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const host = readStringOption(context.options, "host");
        const username = readStringOption(context.options, "username");
        const authMethod = readStringOption(context.options, "authMethod") || "password";
        const password = readStringOption(context.options, "password");
        const privateKeyPath = readStringOption(context.options, "privateKey");
        const passphrase = readStringOption(context.options, "passphrase");
        const port = Number.parseInt(readStringOption(context.options, "port") || "22", 10);

        if (!host || !username) {
          throw new Error("Missing required options. Required: --host, --username.");
        }
        if (!Number.isInteger(port) || port <= 0) {
          throw new Error("Option --port must be a positive integer.");
        }
        if (authMethod !== "password" && authMethod !== "key") {
          throw new Error("Option --auth-method must be 'password' or 'key'.");
        }

        const profile: SshProfile = {
          host,
          port,
          username,
          authMethod: authMethod as "password" | "key",
          password: password || undefined,
          privateKeyPath: privateKeyPath || undefined,
          passphrase: passphrase || undefined,
        };

        addOrUpdateProfile(name, profile);

        const defaultProfile = getDefaultProfileName();
        context.log(`Saved profile: ${name}`);
        context.log(formatProfile(name, profile, defaultProfile === name));
      },
    },
    {
      name: "use",
      parentPath: ["profile"],
      description: "Set default SSH profile",
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

        context.log(`Default SSH profile set to: ${name}`);
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
          throw new Error("No default profile set. Use `hua ssh profile add <name> ...` first.");
        }

        const profile = getProfile(targetName);
        if (!profile) {
          throw new Error(`Profile not found: ${targetName}`);
        }

        const isDefault = getDefaultProfileName() === targetName;
        context.log(formatProfile(targetName, profile, isDefault));
        context.log(`authMethod=${profile.authMethod}`);
        context.log(`password=${maskPassword(profile.password)}`);
        if (profile.privateKeyPath) {
          context.log(`privateKeyPath=${profile.privateKeyPath}`);
        }
      },
    },
    {
      name: "remove",
      parentPath: ["profile"],
      aliases: ["rm"],
      description: "Remove an SSH profile",
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
