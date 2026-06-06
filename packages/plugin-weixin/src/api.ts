import * as crypto from "crypto";
import {
  ILINK_APP_ID,
  ILINK_APP_CLIENT_VERSION,
  BASE_INFO,
  type WeixinAccountState,
} from "./types";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const DEFAULT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

export interface WeixinApiClientOptions {
  baseUrl?: string;
  cdnBaseUrl?: string;
  token?: string;
}

export class WeixinApiClient {
  baseUrl: string;
  cdnBaseUrl: string;
  token: string;

  constructor(opts: WeixinApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
    this.cdnBaseUrl = opts.cdnBaseUrl || DEFAULT_CDN_BASE_URL;
    this.token = opts.token || "";
  }

  /** X-WECHAT-UIN: random uint32 → decimal string → base64 */
  private randomWechatUin(): string {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32)).toString("base64");
  }

  private makeHeaders(auth = true): Record<string, string> {
    const headers: Record<string, string> = {
      "X-WECHAT-UIN": this.randomWechatUin(),
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "iLink-App-Id": ILINK_APP_ID,
      "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
    };
    if (auth && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async apiGet(
    endpoint: string,
    params?: Record<string, string>,
    auth = true,
    overrideBaseUrl?: string,
  ): Promise<any> {
    const base = overrideBaseUrl || this.baseUrl;
    const url = new URL(`${base}/${endpoint}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.makeHeaders(auth),
    });
    if (!resp.ok) {
      throw new Error(`GET ${endpoint} failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }

  async apiPost(endpoint: string, body?: Record<string, any>, auth = true): Promise<any> {
    const payload = body || {};
    if (!payload.base_info) {
      payload.base_info = BASE_INFO;
    }
    const resp = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: "POST",
      headers: this.makeHeaders(auth),
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      throw new Error(`POST ${endpoint} failed: ${resp.status} ${resp.statusText}`);
    }
    return resp.json();
  }
}
