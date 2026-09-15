// Thin client for a self-hosted Postiz instance (pinned in postiz/docker-compose.yml).
//
// Two kinds of authentication are used:
// - Instance-level provisioning and connection start go through /enterprise/*,
//   which accept a JWT signed with the instance JWT_SECRET. The ContentStation
//   API holds that secret, so it can create one organization per shop and start
//   an OAuth connection for that organization without any Postiz login.
// - Everything else uses the organization API key in the Authorization header
//   against /public/v1/*. Keys are organization-scoped; a key cannot read or
//   change another organization's channels, posts or media.
//
// Route shapes below were verified against the pinned source (v2.23.0).
import jwt from "jsonwebtoken";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

export type PostizConfig = {
  url: string;
  jwtSecret: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};
export type PostizIntegration = {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
};
export type PostizMedia = { id: string; path: string };
export type PostizPostSummary = {
  id: string;
  content: string;
  publishDate: string;
  releaseURL: string | null;
  releaseId: string | null;
  state: "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT";
  group: string;
  integration: { id: string; providerIdentifier: string; name: string };
};
export type PostizCreatePost = {
  type: "schedule" | "now" | "draft";
  date: string;
  shortLink: boolean;
  tags: { value: string; label: string }[];
  posts: {
    integration: { id: string };
    value: { content: string; image: PostizMedia[] }[];
    settings: Record<string, unknown>;
  }[];
};

export class PostizError extends Error {
  constructor(
    public kind: "timeout" | "network" | "http",
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
  /** True when the request may have been applied even though no answer arrived. */
  get ambiguous() {
    return this.kind !== "http" || this.status >= 500;
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export class PostizClient {
  private fetcher: typeof fetch;
  private timeoutMs: number;
  readonly url: string;
  constructor(private cfg: PostizConfig) {
    this.url = trimSlash(cfg.url);
    this.fetcher = cfg.fetcher || ((i, o) => fetch(i, o));
    this.timeoutMs = cfg.timeoutMs ?? 30000;
  }

  /** Signs a payload the way Postiz's AuthService.signJWT does (HS256, no expiry). */
  signParams(payload: object) {
    return jwt.sign(payload, this.cfg.jwtSecret, { algorithm: "HS256" });
  }
  /** Verifies a payload Postiz signed with the instance secret. Returns null when invalid. */
  verifyParams(token: unknown): Record<string, any> | null {
    if (typeof token !== "string" || token.length > 4096) return null;
    try {
      const v = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ["HS256"] });
      return v && typeof v === "object" ? (v as Record<string, any>) : null;
    } catch {
      return null;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      apiKey?: string;
      json?: unknown;
      body?: BodyInit;
      headers?: Record<string, string>;
      timeoutMs?: number;
      text?: boolean;
    } = {},
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (opts.apiKey) headers.authorization = opts.apiKey;
    let body = opts.body;
    if (opts.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.json);
    }
    let r: Response;
    try {
      r = await this.fetcher(`${this.url}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
        // Streaming request bodies need half-duplex mode in Node's fetch.
        ...(body && typeof (body as any).getReader === "function" ? { duplex: "half" } : {}),
      } as RequestInit);
    } catch (e: any) {
      const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      throw new PostizError(
        timeout ? "timeout" : "network",
        0,
        null,
        timeout ? "The publishing service did not answer in time." : "The publishing service could not be reached.",
      );
    }
    const text = await r.text();
    let data: any = text;
    if (!opts.text) {
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    }
    if (!r.ok)
      throw new PostizError(
        "http",
        r.status,
        data,
        typeof data?.message === "string"
          ? data.message
          : typeof data?.msg === "string"
            ? data.msg
            : `The publishing service returned ${r.status}.`,
      );
    return { status: r.status, data };
  }

  /**
   * Creates an organization with its own API key. Postiz derives the internal
   * user email from `email`; repeating a call with the same email does not create
   * a second organization and reports { create: false } instead.
   */
  async createOrganization(input: { id: string; name: string; email: string }) {
    const { data } = await this.request<any>("POST", "/enterprise/create-user", {
      json: { params: this.signParams({ ...input, saasName: "contentstation" }) },
    });
    if (data && typeof data.id === "string" && typeof data.apiKey === "string")
      return { id: data.id as string, apiKey: data.apiKey as string };
    if (data?.create === false) return { duplicate: true as const };
    throw new PostizError("http", 502, data, "The publishing service refused to create the organization.");
  }

  /** Returns the platform login URL for a channel connection tied to the organization. */
  async connectUrl(input: {
    apiKey: string;
    provider: string;
    redirectUrl: string;
    webhookUrl: string;
    refreshId?: string;
  }) {
    const { data } = await this.request<string>("POST", "/enterprise/url", {
      json: { params: this.signParams(input) },
      text: true,
    });
    const url = typeof data === "string" ? data.trim() : "";
    if (!/^https?:\/\//.test(url))
      throw new PostizError("http", 502, data, "The publishing service could not start the connection.");
    return url;
  }

  async listIntegrations(apiKey: string): Promise<PostizIntegration[]> {
    const { data } = await this.request<any[]>("GET", "/public/v1/integrations", { apiKey });
    return (Array.isArray(data) ? data : []).map((i) => ({
      id: String(i.id),
      name: String(i.name || ""),
      identifier: String(i.identifier || ""),
      picture: i.picture ? String(i.picture) : null,
      disabled: !!i.disabled,
      profile: i.profile ? String(i.profile) : null,
    }));
  }

  async deleteIntegration(apiKey: string, id: string) {
    await this.request("DELETE", `/public/v1/integrations/${encodeURIComponent(id)}`, { apiKey });
  }

  /** Uploads one file as multipart/form-data without buffering it in memory. */
  async uploadMedia(
    apiKey: string,
    file: { stream: Readable; filename: string; contentType: string },
  ): Promise<PostizMedia> {
    const boundary = `----contentstation${randomBytes(12).toString("hex")}`;
    const safeName = file.filename.replace(/[^\w.-]/g, "_").slice(0, 100) || "upload";
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    async function* parts() {
      yield head;
      for await (const chunk of file.stream) yield chunk as Buffer;
      yield tail;
    }
    const { data } = await this.request<any>("POST", "/public/v1/upload", {
      apiKey,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Readable.toWeb(Readable.from(parts())) as unknown as BodyInit,
      timeoutMs: 10 * 60000,
    });
    if (!data || typeof data.id !== "string" || typeof data.path !== "string")
      throw new PostizError("http", 502, data, "The publishing service did not store the media.");
    return { id: data.id, path: data.path };
  }

  /**
   * Creates one post per channel. Postiz offers no idempotency key, so callers
   * must record the attempt before sending and reconcile with listPosts when the
   * outcome is unknown.
   */
  async createPosts(apiKey: string, body: PostizCreatePost) {
    const { data } = await this.request<any[]>("POST", "/public/v1/posts", { apiKey, json: body });
    if (!Array.isArray(data)) throw new PostizError("http", 502, data, "The publishing service returned an unexpected answer.");
    return data.map((p) => ({ postId: String(p.postId), integration: String(p.integration) }));
  }

  async listPosts(apiKey: string, startIso: string, endIso: string): Promise<PostizPostSummary[]> {
    const q = `startDate=${encodeURIComponent(startIso)}&endDate=${encodeURIComponent(endIso)}`;
    const { data } = await this.request<any>("GET", `/public/v1/posts?${q}`, { apiKey });
    const list = Array.isArray(data?.posts) ? data.posts : [];
    return list
      .filter((p: any) => p && p.integration)
      .map((p: any) => ({
        id: String(p.id),
        content: String(p.content ?? ""),
        publishDate: new Date(p.publishDate).toISOString(),
        releaseURL: p.releaseURL ? String(p.releaseURL) : null,
        releaseId: p.releaseId ? String(p.releaseId) : null,
        state: p.state,
        group: String(p.group ?? ""),
        integration: {
          id: String(p.integration.id),
          providerIdentifier: String(p.integration.providerIdentifier ?? ""),
          name: String(p.integration.name ?? ""),
        },
      }));
  }

  async deletePost(apiKey: string, id: string) {
    await this.request("DELETE", `/public/v1/posts/${encodeURIComponent(id)}`, { apiKey });
  }
}

/** Organization API keys rest encrypted in Firestore under a key derived from PUBLISHING_SECRET. */
export class KeyVault {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }
  seal(plain: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
  }
  open(sealed: string) {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
  static fingerprint(plain: string) {
    return createHash("sha256").update(plain).digest("hex");
  }
}
