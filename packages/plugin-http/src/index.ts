import fs from "node:fs";
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
} from "./profile-store";
import { HttpProfile, HttpRequestOptions, HttpResponse } from "./types";
import { executeRequest } from "./request";
import { formatRequest, formatResponse } from "./formatter";

function readStringOption(options: Record<string, unknown>, key: string): string {
  // Try original key first, then camelCase version (commander converts --base-url to baseUrl)
  const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const value = options[key] ?? options[camelKey];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readStringArrayOption(options: Record<string, unknown>, key: string): string[] {
  const value = options[key];
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

function collectOption(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function parseHeaders(headerArgs: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of headerArgs) {
    const colonIdx = h.indexOf(":");
    if (colonIdx > 0) {
      const key = h.substring(0, colonIdx).trim();
      const value = h.substring(colonIdx + 1).trim();
      if (key) {
        headers[key] = value;
      }
    }
  }
  return headers;
}

function parseBody(data: string | undefined): string | undefined {
  if (!data) return undefined;

  // File reference: @./path or @/path
  if (data.startsWith("@")) {
    const filePath = data.substring(1);
    const resolved = filePath.startsWith("/") || filePath.match(/^[A-Za-z]:/)
      ? filePath
      : require("node:path").resolve(process.cwd(), filePath);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, "utf8");
  }

  return data;
}

function buildUrl(baseUrl: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (!baseUrl) {
    // No profile baseUrl, path must be a full URL
    throw new Error(`URL must start with http:// or https://. Got: ${path}`);
  }

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const urlPath = path.startsWith("/") ? path.substring(1) : path;
  return base + urlPath;
}

function buildHeaders(
  profile: HttpProfile | null,
  headerArgs: string[],
  authOption?: string,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Default content type
  headers["Content-Type"] = "application/json";

  // Profile headers
  if (profile?.headers) {
    Object.assign(headers, profile.headers);
  }

  // CLI headers override profile
  const cliHeaders = parseHeaders(headerArgs);
  Object.assign(headers, cliHeaders);

  // Auth option
  if (authOption) {
    const colonIdx = authOption.indexOf(":");
    if (colonIdx > 0) {
      const type = authOption.substring(0, colonIdx).trim().toLowerCase();
      const value = authOption.substring(colonIdx + 1).trim();

      if (type === "bearer") {
        headers["Authorization"] = `Bearer ${value}`;
      } else if (type === "basic") {
        const encoded = Buffer.from(value).toString("base64");
        headers["Authorization"] = `Basic ${encoded}`;
      }
    }
  } else if (profile?.auth) {
    if (profile.auth.type === "bearer") {
      headers["Authorization"] = `Bearer ${profile.auth.value}`;
    } else if (profile.auth.type === "basic") {
      const encoded = Buffer.from(profile.auth.value).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }
  }

  return headers;
}

async function makeRequest(
  context: { args: string[]; options: Record<string, unknown>; log: (msg: string) => void; error: (msg: string) => void },
  method: string,
): Promise<void> {
  const urlPath = context.args[0] ?? "";
  if (!urlPath) {
    throw new Error("URL is required.");
  }

  const profileName = readStringOption(context.options, "profile");
  const resolved = resolveProfile(profileName);
  const profile = resolved?.profile ?? null;

  const baseUrl = profile?.baseUrl ?? "";
  const fullUrl = buildUrl(baseUrl, urlPath);

  const headerArgs = readStringArrayOption(context.options, "header");
  const authOption = readStringOption(context.options, "auth");
  const dataOption = readStringOption(context.options, "data");
  const timeout = Number.parseInt(readStringOption(context.options, "timeout") || "10000", 10);
  const verbose = context.options.verbose === true;
  const useColor = context.options.color !== false;

  const headers = buildHeaders(profile, headerArgs, authOption);
  const body = parseBody(dataOption);

  const reqOptions: HttpRequestOptions = {
    method: method.toUpperCase(),
    url: fullUrl,
    headers,
    body,
    timeout,
    verbose,
  };

  if (verbose) {
    context.log(formatRequest(method.toUpperCase(), fullUrl, headers, body, verbose, useColor));
  }

  const response: HttpResponse = await executeRequest(reqOptions);
  context.log(formatResponse(response, verbose, useColor));
}

function formatProfile(name: string, profile: HttpProfile, isDefault: boolean): string {
  const defaultTag = isDefault ? " (default)" : "";
  let authInfo = "";
  if (profile.auth) {
    authInfo = ` auth=${profile.auth.type}`;
  }
  return `${name}${defaultTag} -> ${profile.baseUrl}${authInfo}`;
}

export const httpPlugin = definePlugin({
  name: "http",
  description: "HTTP request testing and API tools",
  commands: [
    {
      name: "get",
      description: "Send a GET request",
      arguments: ["<url>"],
      options: [
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        await makeRequest(context, "GET");
      },
    },
    {
      name: "post",
      description: "Send a POST request",
      arguments: ["<url>"],
      options: [
        { flags: "-d, --data <data>", description: 'Request body (JSON string or @file)' },
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--form <key=value>", description: "Form data (repeatable)" },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        await makeRequest(context, "POST");
      },
    },
    {
      name: "put",
      description: "Send a PUT request",
      arguments: ["<url>"],
      options: [
        { flags: "-d, --data <data>", description: 'Request body (JSON string or @file)' },
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--form <key=value>", description: "Form data (repeatable)" },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        await makeRequest(context, "PUT");
      },
    },
    {
      name: "delete",
      description: "Send a DELETE request",
      arguments: ["<url>"],
      options: [
        { flags: "-d, --data <data>", description: 'Request body (JSON string or @file)' },
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        await makeRequest(context, "DELETE");
      },
    },
    {
      name: "patch",
      description: "Send a PATCH request",
      arguments: ["<url>"],
      options: [
        { flags: "-d, --data <data>", description: 'Request body (JSON string or @file)' },
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--form <key=value>", description: "Form data (repeatable)" },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        await makeRequest(context, "PATCH");
      },
    },
    {
      name: "request",
      aliases: ["req"],
      description: "Send a custom HTTP request",
      arguments: ["<url>"],
      options: [
        { flags: "-X, --method <method>", description: "HTTP method", defaultValue: "GET" },
        { flags: "-d, --data <data>", description: 'Request body (JSON string or @file)' },
        { flags: "-H, --header <key:value>", description: "Custom header (repeatable)", processor: collectOption },
        { flags: "--form <key=value>", description: "Form data (repeatable)" },
        { flags: "--profile <name>", description: "Use profile config" },
        { flags: "--timeout <ms>", description: "Request timeout in ms", defaultValue: 10000 },
        { flags: "-v, --verbose", description: "Show request/response details" },
        { flags: "--auth <type:value>", description: "Auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        const method = readStringOption(context.options, "method") || "GET";
        await makeRequest(context, method);
      },
    },
    // Profile commands
    {
      name: "list",
      parentPath: ["profile"],
      aliases: ["ls"],
      description: "List configured HTTP profiles",
      async action(context) {
        const profiles = listProfiles();
        if (profiles.length === 0) {
          context.log(`No profiles configured. Config: ${getConfigPath()}`);
          return;
        }

        context.log(`Config: ${getConfigPath()}`);
        for (const item of profiles) {
          context.log(formatProfile(item.name, item.profile, item.isDefault));
        }
      },
    },
    {
      name: "add",
      parentPath: ["profile"],
      description: "Create or update an HTTP profile",
      arguments: ["<name>"],
      options: [
        { flags: "--base-url <url>", description: "Base URL for requests" },
        { flags: "--header <key:value>", description: "Default header (repeatable)" },
        { flags: "--timeout <ms>", description: "Default timeout in ms", defaultValue: 10000 },
        { flags: "--auth <type:value>", description: "Default auth: bearer:token or basic:user:pass" },
      ],
      async action(context) {
        const name = (context.args[0] ?? "").trim();
        if (!name) {
          throw new Error("Profile name is required.");
        }

        const baseUrl = readStringOption(context.options, "base-url");
        if (!baseUrl) {
          throw new Error("Missing required option: --base-url");
        }

        const timeoutStr = readStringOption(context.options, "timeout");
        const timeout = timeoutStr ? Number.parseInt(timeoutStr, 10) : undefined;

        const headerArgs = readStringArrayOption(context.options, "header");
        const headers = headerArgs.length > 0 ? parseHeaders(headerArgs) : undefined;

        const authOption = readStringOption(context.options, "auth");
        let auth: HttpProfile["auth"] | undefined;
        if (authOption) {
          const colonIdx = authOption.indexOf(":");
          if (colonIdx > 0) {
            const type = authOption.substring(0, colonIdx).trim().toLowerCase();
            const value = authOption.substring(colonIdx + 1).trim();
            if (type === "bearer" || type === "basic") {
              auth = { type, value };
            }
          }
        }

        const profile: HttpProfile = {
          baseUrl,
          headers,
          timeout,
          auth,
        };

        addOrUpdateProfile(name, profile);
        context.log(`Saved profile: ${name}`);
        context.log(formatProfile(name, profile, getDefaultProfileName() === name));
      },
    },
    {
      name: "use",
      parentPath: ["profile"],
      description: "Set default HTTP profile",
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

        context.log(`Default HTTP profile set to: ${name}`);
      },
    },
    {
      name: "show",
      parentPath: ["profile"],
      description: "Show profile detail by name or current default",
      arguments: ["[name]"],
      async action(context) {
        const inputName = (context.args[0] ?? "").trim();
        const targetName = inputName || getDefaultProfileName() || "";
        if (!targetName) {
          throw new Error("No default profile set. Use `hua http profile add <name> --base-url ...` first.");
        }

        const profile = getProfile(targetName);
        if (!profile) {
          throw new Error(`Profile not found: ${targetName}`);
        }

        const isDefault = getDefaultProfileName() === targetName;
        context.log(formatProfile(targetName, profile, isDefault));
        if (profile.headers) {
          context.log(`headers=${JSON.stringify(profile.headers)}`);
        }
        if (profile.auth) {
          context.log(`auth=${profile.auth.type}:***`);
        }
        if (profile.timeout) {
          context.log(`timeout=${profile.timeout}ms`);
        }
      },
    },
    {
      name: "remove",
      parentPath: ["profile"],
      aliases: ["rm"],
      description: "Remove an HTTP profile",
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
        context.log(`Current default: ${currentDefault ?? "(none)"}`);
      },
    },
  ],
});
