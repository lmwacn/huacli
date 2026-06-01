export interface SshProfile {
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}
