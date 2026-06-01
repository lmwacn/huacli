import { HttpResponse } from "./types";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function colorize(text: string, color: string): string {
  return `${color}${text}${COLORS.reset}`;
}

function getStatusColor(code: number): string {
  if (code >= 200 && code < 300) return COLORS.green;
  if (code >= 300 && code < 400) return COLORS.cyan;
  if (code >= 400 && code < 500) return COLORS.yellow;
  if (code >= 500) return COLORS.red;
  return COLORS.reset;
}

function tryFormatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function maskSensitiveHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const sensitiveKeys = new Set(["authorization", "cookie", "set-cookie"]);
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      const strValue = Array.isArray(value) ? value[0] : (value ?? "");
      result[key] = strValue.substring(0, 12) + "***";
    } else {
      result[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
    }
  }

  return result;
}

export function formatResponse(response: HttpResponse, verbose: boolean, useColor: boolean): string {
  const lines: string[] = [];

  const statusColor = useColor ? getStatusColor(response.statusCode) : "";
  const reset = useColor ? COLORS.reset : "";
  const bold = useColor ? COLORS.bold : "";
  const dim = useColor ? COLORS.dim : "";
  const gray = useColor ? COLORS.gray : "";

  // Status line
  lines.push(`${bold}${response.statusCode}${reset} ${response.statusMessage}`);

  if (verbose) {
    lines.push("");

    // Response headers
    const displayHeaders = maskSensitiveHeaders(response.headers);
    for (const [key, value] of Object.entries(displayHeaders)) {
      const headerKey = useColor ? colorize(key, COLORS.cyan) : key;
      lines.push(`${dim}<${reset} ${headerKey}: ${value}`);
    }

    lines.push("");
  }

  // Body
  const formattedBody = tryFormatJson(response.body);
  lines.push(formattedBody);

  // Timing
  lines.push("");
  lines.push(`${dim}${response.time}ms${reset}`);

  return lines.join("\n");
}

export function formatRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  verbose?: boolean,
  useColor?: boolean,
): string {
  const lines: string[] = [];
  const bold = useColor ? COLORS.bold : "";
  const dim = useColor ? COLORS.dim : "";
  const reset = useColor ? COLORS.reset : "";

  const parsedUrl = new URL(url);
  lines.push(`${bold}${method}${reset} ${parsedUrl.pathname}${parsedUrl.search}`);

  if (verbose) {
    lines.push(`${dim}>${reset} Host: ${parsedUrl.host}`);

    const displayHeaders = maskSensitiveHeaders(headers);
    for (const [key, value] of Object.entries(displayHeaders)) {
      const headerKey = useColor ? colorize(key, COLORS.cyan) : key;
      lines.push(`${dim}>${reset} ${headerKey}: ${value}`);
    }

    if (body) {
      lines.push("");
      lines.push(tryFormatJson(body));
    }

    lines.push("");
  }

  return lines.join("\n");
}
