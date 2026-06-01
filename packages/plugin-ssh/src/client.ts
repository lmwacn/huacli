import fs from "node:fs";
import { Client } from "ssh2";
import { SshProfile } from "./types";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function execCommand(profile: SshProfile, command: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(new Error(`Exec failed: ${err.message}`));
          return;
        }

        stream.on("close", (code: number) => {
          exitCode = code;
          conn.end();
          resolve({ stdout, stderr, exitCode });
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      });
    });

    conn.on("error", (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    const connectConfig: Record<string, unknown> = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
    };

    if (profile.authMethod === "key" && profile.privateKeyPath) {
      try {
        connectConfig.privateKey = fs.readFileSync(profile.privateKeyPath);
        if (profile.passphrase) {
          connectConfig.passphrase = profile.passphrase;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to read private key: ${message}`));
        return;
      }
    } else if (profile.password) {
      connectConfig.password = profile.password;
    }

    conn.connect(connectConfig);
  });
}
