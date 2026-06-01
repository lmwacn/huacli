import fs from "node:fs";
import path from "node:path";
import { Client, SFTPWrapper } from "ssh2";
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

function buildConnectConfig(profile: SshProfile): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
  };

  if (profile.authMethod === "key" && profile.privateKeyPath) {
    config.privateKey = fs.readFileSync(profile.privateKeyPath);
    if (profile.passphrase) {
      config.passphrase = profile.passphrase;
    }
  } else if (profile.password) {
    config.password = profile.password;
  }

  return config;
}

function connectSftp(profile: SshProfile): Promise<{ sftp: SFTPWrapper; conn: Client }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          reject(new Error(`SFTP init failed: ${err.message}`));
          return;
        }
        resolve({ sftp, conn });
      });
    });

    conn.on("error", (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    conn.connect(buildConnectConfig(profile));
  });
}

export async function uploadFile(profile: SshProfile, localPath: string, remotePath: string): Promise<void> {
  const { sftp, conn } = await connectSftp(profile);

  return new Promise<void>((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) {
        sftp.end();
        conn.end();
        reject(new Error(`Upload failed: ${err.message}`));
        return;
      }
      sftp.end();
      conn.end();
      resolve();
    });
  });
}

export async function downloadFile(profile: SshProfile, remotePath: string, localPath: string): Promise<void> {
  const { sftp, conn } = await connectSftp(profile);

  const localDir = path.dirname(localPath);
  fs.mkdirSync(localDir, { recursive: true });

  return new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => {
      if (err) {
        sftp.end();
        conn.end();
        reject(new Error(`Download failed: ${err.message}`));
        return;
      }
      sftp.end();
      conn.end();
      resolve();
    });
  });
}
