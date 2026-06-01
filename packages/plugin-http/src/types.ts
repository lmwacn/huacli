export interface HttpProfile {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  auth?: {
    type: "bearer" | "basic";
    value: string;
  };
}

export interface HttpRequestOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  timeout: number;
  verbose: boolean;
}

export interface HttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  time: number;
}
