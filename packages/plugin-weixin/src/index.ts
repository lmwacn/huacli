import { definePlugin, type HuaCommand } from "@hua/plugin-sdk";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { WeixinApiClient } from "./api";
import { qrLogin, loadState, saveState } from "./auth";
import { downloadMedia, uploadAndSendMedia } from "./media";
import {
  ITEM_TEXT, ITEM_IMAGE, ITEM_VOICE, ITEM_FILE, ITEM_VIDEO,
  MESSAGE_TYPE_BOT, ERRCODE_SESSION_EXPIRED, BASE_INFO,
  DEFAULT_LONG_POLL_TIMEOUT_S, MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_S, RETRY_DELAY_S,
  type WeixinAccountState, type WeixinMessage, type WeixinMessageItem,
} from "./types";

function createClientFromState(state: WeixinAccountState): WeixinApiClient {
  return new WeixinApiClient({
    baseUrl: state.base_url,
    token: state.token,
  });
}

function ensureAuth(): { api: WeixinApiClient; state: WeixinAccountState } {
  const state = loadState();
  if (!state || !state.token) {
    console.error("Not logged in. Run 'hua weixin login' first.");
    process.exit(1);
  }
  return { api: createClientFromState(state), state };
}

// --- Commands ---

const loginCommand: HuaCommand = {
  name: "login",
  description: "Login to WeChat via QR code scan",
  options: [
    { flags: "--force", description: "Force re-login even if token exists" },
  ],
  async action(ctx) {
    const state = loadState();
    if (state?.token && !ctx.options.force) {
      console.log("Already logged in. Use --force to re-login.");
      return;
    }

    const api = new WeixinApiClient({ baseUrl: state?.base_url });
    const result = await qrLogin(api);
    if (!result) {
      ctx.error("Login failed.");
      process.exit(1);
    }
  },
};

const statusCommand: HuaCommand = {
  name: "status",
  description: "Check WeChat login status",
  async action() {
    const state = loadState();
    if (!state || !state.token) {
      console.log("Status: Not logged in");
      console.log("Run 'hua weixin login' to authenticate.");
      return;
    }
    console.log("Status: Logged in");
    console.log(`  Base URL: ${state.base_url}`);
    console.log(`  Token: ${state.token.slice(0, 12)}...`);
    const ctxCount = Object.keys(state.context_tokens).length;
    if (ctxCount > 0) {
      console.log(`  Cached contacts: ${ctxCount}`);
    }
  },
};

const sendCommand: HuaCommand = {
  name: "send",
  description: "Send a message to a WeChat contact",
  arguments: ["<to>", "[text]"],
  options: [
    { flags: "--file <path>", description: "Send a file/image/video" },
  ],
  async action(ctx) {
    const [to, text] = ctx.args;
    const filePath = ctx.options.file as string | undefined;

    if (!to) {
      ctx.error("Usage: hua weixin send <wxid> [text] [--file <path>]");
      return;
    }
    if (!text && !filePath) {
      ctx.error("Provide text content or --file <path>.");
      return;
    }

    const { api, state } = ensureAuth();

    // We need context_token to send messages.
    // If we don't have one cached, we can still try (some APIs allow it).
    const contextToken = state.context_tokens[to] || "";

    try {
      // Send media first if provided
      if (filePath) {
        const absPath = path.resolve(filePath);
        if (!fs.existsSync(absPath)) {
          ctx.error(`File not found: ${absPath}`);
          return;
        }
        console.log(`Sending file: ${path.basename(absPath)}...`);
        await uploadAndSendMedia(api, to, absPath, contextToken);
        console.log("File sent.");
      }

      // Send text
      if (text) {
        console.log(`Sending message to ${to}...`);
        await sendText(api, to, text, contextToken);
        console.log("Message sent.");
      }
    } catch (e: any) {
      ctx.error(`Send failed: ${e.message}`);
      process.exit(1);
    }
  },
};

const listenCommand: HuaCommand = {
  name: "listen",
  description: "Listen for incoming WeChat messages (long-poll)",
  async action() {
    const { api, state } = ensureAuth();

    console.log("Listening for WeChat messages... (Ctrl+C to stop)\n");

    let getUpdatesBuf = state.get_updates_buf;
    let consecutiveFailures = 0;
    let pollTimeout = DEFAULT_LONG_POLL_TIMEOUT_S;
    const processedIds = new Set<string>();

    while (true) {
      try {
        const body: Record<string, any> = {
          get_updates_buf: getUpdatesBuf,
          base_info: BASE_INFO,
        };

        const data = await api.apiPost("ilink/bot/getupdates", body);

        // Check errors
        const ret = data.ret ?? 0;
        const errcode = data.errcode ?? 0;
        if (ret !== 0 || errcode !== 0) {
          if (errcode === ERRCODE_SESSION_EXPIRED || ret === ERRCODE_SESSION_EXPIRED) {
            console.error("\nSession expired. Please run 'hua weixin login' again.");
            process.exit(1);
          }
          throw new Error(`getUpdates failed: ret=${ret} errcode=${errcode} errmsg=${data.errmsg || ""}`);
        }

        // Update poll timeout from server
        if (data.longpolling_timeout_ms > 0) {
          pollTimeout = Math.max(Math.floor(data.longpolling_timeout_ms / 1000), 5);
        }

        // Update cursor
        if (data.get_updates_buf) {
          getUpdatesBuf = data.get_updates_buf;
          state.get_updates_buf = getUpdatesBuf;
          saveState(state);
        }

        consecutiveFailures = 0;

        // Process messages
        const msgs: WeixinMessage[] = data.msgs || [];
        for (const msg of msgs) {
          await processInboundMessage(msg, state, api, processedIds);
        }
      } catch (e: any) {
        if (e.message?.includes("ECONNRESET") || e.message?.includes("ETIMEDOUT")) {
          // Normal for long-poll timeout
          continue;
        }
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          console.error(`Multiple failures, backing off ${BACKOFF_DELAY_S}s...`);
          await sleep(BACKOFF_DELAY_S * 1000);
        } else {
          await sleep(RETRY_DELAY_S * 1000);
        }
      }
    }
  },
};

const logoutCommand: HuaCommand = {
  name: "logout",
  description: "Clear saved WeChat login state",
  async action() {
    const stateDir = path.join(require("os").homedir(), ".hua", "weixin");
    const stateFile = path.join(stateDir, "account.json");
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      console.log("Logged out. Token cleared.");
    } else {
      console.log("No saved login state found.");
    }
  },
};

// --- Helpers ---

async function sendText(
  api: WeixinApiClient,
  toUserId: string,
  text: string,
  contextToken: string,
): Promise<void> {
  const clientId = `hua-${crypto.randomBytes(6).toString("hex")}`;
  const msg: Record<string, any> = {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    item_list: [{ type: ITEM_TEXT, text_item: { text } }],
  };
  if (contextToken) msg.context_token = contextToken;

  const data = await api.apiPost("ilink/bot/sendmessage", { msg });
  const errcode = data.errcode || 0;
  if (errcode !== 0) {
    throw new Error(`Send error (code ${errcode}): ${data.errmsg || ""}`);
  }
}

async function processInboundMessage(
  msg: WeixinMessage,
  state: WeixinAccountState,
  api: WeixinApiClient,
  processedIds: Set<string>,
): Promise<void> {
  // Skip bot's own messages
  if (msg.message_type === MESSAGE_TYPE_BOT) return;

  // Dedup
  const msgId = msg.message_id || msg.seq || `${msg.from_user_id}_${msg.create_time_ms}`;
  if (processedIds.has(msgId)) return;
  processedIds.add(msgId);
  // Keep set bounded
  if (processedIds.size > 2000) {
    const first = processedIds.values().next().value;
    if (first) processedIds.delete(first);
  }

  const fromUserId = msg.from_user_id || "";
  if (!fromUserId) return;

  // Cache context_token
  if (msg.context_token) {
    state.context_tokens[fromUserId] = msg.context_token;
    saveState(state);
  }

  // Parse items
  const parts: string[] = [];
  for (const item of msg.item_list || []) {
    const itemType = item.type;

    if (itemType === ITEM_TEXT) {
      const text = item.text_item?.text || "";
      if (text) {
        // Handle quoted messages
        if (item.ref_msg) {
          const refParts: string[] = [];
          if (item.ref_msg.title) refParts.push(item.ref_msg.title);
          const refText = item.ref_msg.message_item?.text_item?.text;
          if (refText) refParts.push(refText);
          if (refParts.length) {
            parts.push(`[引用: ${refParts.join(" | ")}]\n${text}`);
          } else {
            parts.push(text);
          }
        } else {
          parts.push(text);
        }
      }
    } else if (itemType === ITEM_IMAGE) {
      const filePath = await tryDownloadMedia(api, item.image_item, "image");
      parts.push(filePath ? `[图片] ${filePath}` : "[图片]");
    } else if (itemType === ITEM_VOICE) {
      const voiceText = item.voice_item?.text;
      if (voiceText) {
        parts.push(`[语音] ${voiceText}`);
      } else {
        const filePath = await tryDownloadMedia(api, item.voice_item, "voice");
        parts.push(filePath ? `[语音] ${filePath}` : "[语音]");
      }
    } else if (itemType === ITEM_FILE) {
      const fileName = item.file_item?.file_name || "unknown";
      const filePath = await tryDownloadMedia(api, item.file_item, "file", fileName);
      parts.push(filePath ? `[文件: ${fileName}] ${filePath}` : `[文件: ${fileName}]`);
    } else if (itemType === ITEM_VIDEO) {
      const filePath = await tryDownloadMedia(api, item.video_item, "video");
      parts.push(filePath ? `[视频] ${filePath}` : "[视频]");
    }
  }

  if (!parts.length) return;

  const content = parts.join("\n");
  const ts = new Date().toLocaleTimeString();
  console.log(`\n[${ts}] ${fromUserId}:`);
  console.log(content);
}

async function tryDownloadMedia(
  api: WeixinApiClient,
  item: { media?: { encrypt_query_param?: string; full_url?: string; aes_key?: string }; aeskey?: string } | undefined,
  mediaType: string,
  filename?: string,
): Promise<string | null> {
  if (!item?.media) return null;
  const { encrypt_query_param, full_url, aes_key } = item.media;
  if (!encrypt_query_param && !full_url) return null;

  // Resolve AES key
  let aesKeyB64 = "";
  if (item.aeskey) {
    aesKeyB64 = Buffer.from(item.aeskey, "hex").toString("base64");
  } else if (aes_key) {
    aesKeyB64 = aes_key;
  }

  try {
    const data = await downloadMedia(api, encrypt_query_param, full_url, aesKeyB64, mediaType);
    if (!data) return null;

    // Save to ~/.hua/weixin/media/
    const mediaDir = path.join(require("os").homedir(), ".hua", "weixin", "media");
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

    const ext = getExtForType(mediaType);
    const safeName = filename
      ? path.basename(filename)
      : `${mediaType}_${Date.now()}_${Math.floor(Math.random() * 100000)}${ext}`;
    const filePath = path.join(mediaDir, safeName);
    fs.writeFileSync(filePath, data);
    return filePath;
  } catch (e) {
    return null;
  }
}

function getExtForType(mediaType: string): string {
  const map: Record<string, string> = { image: ".jpg", voice: ".silk", video: ".mp4", file: "" };
  return map[mediaType] || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Plugin Export ---

export const weixinPlugin = definePlugin({
  name: "weixin",
  description: "WeChat (微信) personal messaging - login, send, listen",
  commands: [loginCommand, statusCommand, sendCommand, listenCommand, logoutCommand],
});
