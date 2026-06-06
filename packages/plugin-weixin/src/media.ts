import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { IMAGE_EXTS, VIDEO_EXTS, VOICE_EXTS, UPLOAD_MEDIA_IMAGE, UPLOAD_MEDIA_VIDEO, UPLOAD_MEDIA_FILE, UPLOAD_MEDIA_VOICE } from "./types";
import { WeixinApiClient } from "./api";

/** Parse a base64-encoded AES key. Handles both raw 16-byte and hex-encoded 32-byte keys. */
function parseAesKey(aesKeyB64: string): Buffer {
  const decoded = Buffer.from(aesKeyB64, "base64");
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString())) {
    return Buffer.from(decoded.toString(), "hex");
  }
  throw new Error(`aes_key must decode to 16 raw bytes or 32-char hex string, got ${decoded.length} bytes`);
}

/** AES-128-ECB encrypt with PKCS7 padding */
export function encryptAesEcb(data: Buffer, aesKeyB64: string): Buffer {
  const key = parseAesKey(aesKeyB64);
  const padLen = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

/** AES-128-ECB decrypt with PKCS7 unpadding */
export function decryptAesEcb(data: Buffer, aesKeyB64: string): Buffer {
  const key = parseAesKey(aesKeyB64);
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return pkcs7Unpad(decrypted);
}

function pkcs7Unpad(data: Buffer, blockSize = 16): Buffer {
  if (!data.length || data.length % blockSize !== 0) return data;
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > blockSize) return data;
  const padding = data.slice(data.length - padLen);
  if (!padding.every((b) => b === padLen)) return data;
  return data.slice(0, data.length - padLen);
}

/** Detect upload media type from file extension */
export function detectMediaType(filePath: string): { uploadType: number; itemType: number; itemKey: string } {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return { uploadType: UPLOAD_MEDIA_IMAGE, itemType: 2, itemKey: "image_item" };
  if (VIDEO_EXTS.has(ext)) return { uploadType: UPLOAD_MEDIA_VIDEO, itemType: 5, itemKey: "video_item" };
  if (VOICE_EXTS.has(ext)) return { uploadType: UPLOAD_MEDIA_VOICE, itemType: 3, itemKey: "voice_item" };
  return { uploadType: UPLOAD_MEDIA_FILE, itemType: 4, itemKey: "file_item" };
}

/** Download media from CDN, optionally decrypting with AES key */
export async function downloadMedia(
  api: WeixinApiClient,
  encryptQueryParam?: string,
  fullUrl?: string,
  aesKeyB64?: string,
  mediaType = "image",
): Promise<Buffer | null> {
  if (!encryptQueryParam && !fullUrl) return null;
  // voice/file/video require aes_key; only image may be plain
  if (mediaType !== "image" && !aesKeyB64) return null;

  const candidates: string[] = [];
  if (fullUrl) candidates.push(fullUrl);
  if (encryptQueryParam) {
    candidates.push(`${api.cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`);
  }

  let data: Buffer | null = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      data = Buffer.from(await resp.arrayBuffer());
      break;
    } catch {
      continue;
    }
  }
  if (!data || !data.length) return null;
  if (aesKeyB64 && data) {
    data = decryptAesEcb(data, aesKeyB64);
  }
  return data;
}

/**
 * Upload a local file to WeChat CDN and send it as a media message.
 * Follows the 3-step protocol: getuploadurl → CDN upload → sendmessage.
 */
export async function uploadAndSendMedia(
  api: WeixinApiClient,
  toUserId: string,
  mediaPath: string,
  contextToken: string,
): Promise<void> {
  const rawData = fs.readFileSync(mediaPath);
  const rawSize = rawData.length;
  const rawMd5 = crypto.createHash("md5").update(rawData).digest("hex");
  const { uploadType, itemType, itemKey } = detectMediaType(mediaPath);

  // Generate client-side AES-128 key
  const aesKeyRaw = crypto.randomBytes(16);
  const aesKeyHex = aesKeyRaw.toString("hex");

  // Padded size: PKCS7 padding to 16-byte boundary
  const paddedSize = Math.ceil((rawSize + 1) / 16) * 16;

  // Step 1: Get upload URL
  const fileKey = crypto.randomBytes(16).toString("hex");
  const uploadResp = await api.apiPost("ilink/bot/getuploadurl", {
    filekey: fileKey,
    media_type: uploadType,
    to_user_id: toUserId,
    rawsize: rawSize,
    rawfilemd5: rawMd5,
    filesize: paddedSize,
    no_need_thumb: true,
    aeskey: aesKeyHex,
  });

  const uploadFullUrl: string = (uploadResp.upload_full_url || "").trim();
  const uploadParam: string = uploadResp.upload_param || "";
  if (!uploadFullUrl && !uploadParam) {
    throw new Error(`getuploadurl returned no upload URL: ${JSON.stringify(uploadResp)}`);
  }

  // Step 2: AES-128-ECB encrypt and POST to CDN
  const aesKeyB64 = aesKeyRaw.toString("base64");
  const encryptedData = encryptAesEcb(rawData, aesKeyB64);

  const cdnUploadUrl = uploadFullUrl
    ? uploadFullUrl
    : `${api.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(fileKey)}`;

  const cdnResp = await fetch(cdnUploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(encryptedData),
  });
  if (!cdnResp.ok) {
    throw new Error(`CDN upload failed: ${cdnResp.status} ${cdnResp.statusText}`);
  }

  const downloadParam = cdnResp.headers.get("x-encrypted-param");
  if (!downloadParam) {
    throw new Error("CDN upload response missing x-encrypted-param header");
  }

  // Step 3: Send message with media reference
  const cdnAesKeyB64 = Buffer.from(aesKeyHex).toString("base64");
  const mediaItem: Record<string, any> = {
    media: {
      encrypt_query_param: downloadParam,
      aes_key: cdnAesKeyB64,
      encrypt_type: 1,
    },
  };

  const ext = path.extname(mediaPath).toLowerCase();
  if (itemType === 2) mediaItem.mid_size = paddedSize;
  else if (itemType === 5) mediaItem.video_size = paddedSize;
  else if (itemType === 4) {
    mediaItem.file_name = path.basename(mediaPath);
    mediaItem.len = String(rawSize);
  }

  const clientId = `hua-${crypto.randomBytes(6).toString("hex")}`;
  const msg: Record<string, any> = {
    from_user_id: "",
    to_user_id: toUserId,
    client_id: clientId,
    message_type: 2,
    message_state: 2,
    item_list: [{ type: itemType, [itemKey]: mediaItem }],
  };
  if (contextToken) msg.context_token = contextToken;

  const sendResp = await api.apiPost("ilink/bot/sendmessage", { msg });
  const errcode = sendResp.errcode || 0;
  if (errcode !== 0) {
    throw new Error(`WeChat send media error (code ${errcode}): ${sendResp.errmsg || ""}`);
  }
}
