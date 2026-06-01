import http from "node:http";
import https from "node:https";
import { HttpRequestOptions, HttpResponse } from "./types";

function parseResponse(res: http.IncomingMessage, body: string, time: number): HttpResponse {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    headers[key] = value;
  }

  return {
    statusCode: res.statusCode ?? 0,
    statusMessage: res.statusMessage ?? "",
    headers,
    body,
    time,
  };
}

export function executeRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const parsedUrl = new URL(options.url);

    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: options.headers,
      timeout: options.timeout,
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const time = Date.now() - startTime;
        resolve(parseResponse(res, body, time));
      });

      res.on("error", (err) => {
        reject(err);
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${options.timeout}ms`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}
