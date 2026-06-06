import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WeixinApiClient, DEFAULT_BASE_URL } from "./api";
import { MAX_QR_REFRESH_COUNT, type WeixinAccountState } from "./types";

const STATE_DIR = path.join(os.homedir(), ".hua", "weixin");
const STATE_FILE = path.join(STATE_DIR, "account.json");

export function getStateDir(): string {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  return STATE_DIR;
}

export function loadState(): WeixinAccountState | null {
  getStateDir();
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      token: data.token || "",
      get_updates_buf: data.get_updates_buf || "",
      context_tokens: data.context_tokens || {},
      typing_tickets: data.typing_tickets || {},
      base_url: data.base_url || DEFAULT_BASE_URL,
    };
  } catch {
    return null;
  }
}

export function saveState(state: WeixinAccountState): void {
  getStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** Display QR code in terminal. Tries qrcode-terminal, falls back to printing URL. */
async function printQrCode(url: string): Promise<void> {
  try {
    const qrcode = require("qrcode-terminal");
    qrcode.generate(url, { small: true });
  } catch {
    // Fallback: just print the URL
    console.log(`\nScan this QR code URL in WeChat:\n${url}\n`);
  }
}

/**
 * Perform QR code login.
 * Returns the updated account state on success, null on failure.
 */
export async function qrLogin(api: WeixinApiClient): Promise<WeixinAccountState | null> {
  let refreshCount = 0;

  // Step 1: Fetch QR code
  let qrData: any;
  try {
    qrData = await api.apiGet("ilink/bot/get_bot_qrcode", { bot_type: "3" }, false);
  } catch (e) {
    console.error("Failed to get QR code:", e);
    return null;
  }

  let qrcodeId: string = qrData.qrcode || "";
  const scanUrl: string = qrData.qrcode_img_content || qrcodeId;
  if (!qrcodeId) {
    console.error("Failed to get QR code from API:", qrData);
    return null;
  }

  console.log("Please scan the QR code with WeChat:");
  await printQrCode(scanUrl);

  let currentPollBaseUrl = api.baseUrl;

  // Step 2: Poll for scan status
  while (true) {
    let statusData: any;
    try {
      statusData = await api.apiGet(
        "ilink/bot/get_qrcode_status",
        { qrcode: qrcodeId },
        false,
        currentPollBaseUrl,
      );
    } catch (e: any) {
      // Retry on network/timeout errors
      if (e.message?.includes("ECONNRESET") || e.message?.includes("ETIMEDOUT") || e.message?.includes("timeout")) {
        await sleep(1000);
        continue;
      }
      console.error("QR status poll error:", e);
      return null;
    }

    if (!statusData || typeof statusData !== "object") {
      await sleep(1000);
      continue;
    }

    const status = statusData.status || "";

    if (status === "confirmed") {
      const token = statusData.bot_token || "";
      const botId = statusData.ilink_bot_id || "";
      const baseUrl = statusData.baseurl || "";
      const userId = statusData.ilink_user_id || "";

      if (!token) {
        console.error("Login confirmed but no bot_token in response");
        return null;
      }

      api.token = token;
      if (baseUrl) api.baseUrl = baseUrl;

      const state: WeixinAccountState = {
        token,
        get_updates_buf: "",
        context_tokens: {},
        typing_tickets: {},
        base_url: baseUrl || api.baseUrl,
      };
      saveState(state);

      console.log(`\nWeChat login successful!`);
      console.log(`  bot_id: ${botId}`);
      console.log(`  user_id: ${userId}`);
      return state;
    }

    if (status === "scaned_but_redirect") {
      const redirectHost = (statusData.redirect_host || "").trim();
      if (redirectHost) {
        currentPollBaseUrl = redirectHost.startsWith("http")
          ? redirectHost
          : `https://${redirectHost}`;
        console.log("Scanned, redirecting...");
      }
    } else if (status === "expired") {
      refreshCount++;
      if (refreshCount > MAX_QR_REFRESH_COUNT) {
        console.error(`QR code expired too many times (${refreshCount}/${MAX_QR_REFRESH_COUNT}), giving up.`);
        return null;
      }
      console.log("QR code expired, refreshing...");
      try {
        qrData = await api.apiGet("ilink/bot/get_bot_qrcode", { bot_type: "3" }, false);
        qrcodeId = qrData.qrcode || "";
        const newScanUrl = qrData.qrcode_img_content || qrcodeId;
        currentPollBaseUrl = api.baseUrl;
        await printQrCode(newScanUrl);
      } catch (e) {
        console.error("Failed to refresh QR code:", e);
        return null;
      }
    }
    // status === "wait" → keep polling

    await sleep(1500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
