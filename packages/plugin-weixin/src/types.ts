// Protocol constants from @tencent-weixin/openclaw-weixin v1.0.3

// MessageItemType
export const ITEM_TEXT = 1;
export const ITEM_IMAGE = 2;
export const ITEM_VOICE = 3;
export const ITEM_FILE = 4;
export const ITEM_VIDEO = 5;

// MessageType (1 = inbound from user, 2 = outbound from bot)
export const MESSAGE_TYPE_USER = 1;
export const MESSAGE_TYPE_BOT = 2;

// MessageState
export const MESSAGE_STATE_FINISH = 2;

export const WEIXIN_MAX_MESSAGE_LEN = 4000;
export const WEIXIN_CHANNEL_VERSION = "2.1.1";
export const ILINK_APP_ID = "bot";

// Media upload types (1=image, 2=video, 3=file, 4=voice)
export const UPLOAD_MEDIA_IMAGE = 1;
export const UPLOAD_MEDIA_VIDEO = 2;
export const UPLOAD_MEDIA_FILE = 3;
export const UPLOAD_MEDIA_VOICE = 4;

// Session-expired error code
export const ERRCODE_SESSION_EXPIRED = -14;
export const SESSION_PAUSE_DURATION_S = 60 * 60;

// Retry constants
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_S = 30;
export const RETRY_DELAY_S = 2;
export const MAX_QR_REFRESH_COUNT = 3;

// Typing
export const TYPING_STATUS_TYPING = 1;
export const TYPING_STATUS_CANCEL = 2;
export const TYPING_TICKET_TTL_S = 24 * 60 * 60;
export const TYPING_KEEPALIVE_INTERVAL_S = 5;

// Default long-poll timeout
export const DEFAULT_LONG_POLL_TIMEOUT_S = 35;

// File extensions for media type detection
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".ico", ".svg"]);
export const VIDEO_EXTS = new Set([".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv"]);
export const VOICE_EXTS = new Set([".mp3", ".wav", ".amr", ".silk", ".ogg", ".m4a", ".aac", ".flac"]);

// Base info attached to every POST body
export const BASE_INFO: Record<string, string> = { channel_version: WEIXIN_CHANNEL_VERSION };

// Encode semver as 0x00MMNNPP
export function buildClientVersion(version: string): number {
  const parts = version.split(".").map((p) => parseInt(p, 10) || 0);
  return ((parts[0] & 0xff) << 16) | ((parts[1] & 0xff) << 8) | (parts[2] & 0xff);
}

export const ILINK_APP_CLIENT_VERSION = buildClientVersion(WEIXIN_CHANNEL_VERSION);

export interface WeixinAccountState {
  token: string;
  get_updates_buf: string;
  context_tokens: Record<string, string>;
  typing_tickets: Record<string, TypingTicketEntry>;
  base_url: string;
}

export interface TypingTicketEntry {
  ticket: string;
  ever_succeeded: boolean;
  next_fetch_at: number;
  retry_delay_s: number;
}

export interface WeixinMessage {
  message_id?: string;
  seq?: string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  message_type?: number;
  message_state?: number;
  context_token?: string;
  create_time_ms?: number;
  item_list?: WeixinMessageItem[];
}

export interface WeixinMessageItem {
  type: number;
  text_item?: { text: string };
  image_item?: MediaItem;
  voice_item?: MediaItem & { text?: string };
  file_item?: MediaItem & { file_name?: string; len?: string };
  video_item?: MediaItem;
  ref_msg?: {
    title?: string;
    message_item?: WeixinMessageItem;
  };
}

export interface MediaItem {
  media?: {
    encrypt_query_param?: string;
    full_url?: string;
    aes_key?: string;
    encrypt_type?: number;
  };
  aeskey?: string;
  mid_size?: number;
  video_size?: number;
}
