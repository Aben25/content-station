// In-process stand-in for the routes of self-hosted Postiz v2.23.0 that the API
// uses. It is a MOCK: it proves how the ContentStation API behaves around the
// documented contract (organization-scoped keys, no idempotency on post
// creation, unsigned status), not that any social platform accepted a post.
// The real instance is exercised separately by scripts/postiz-local.mjs verify.
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

type Org = { id: string; apiKey: string; email: string; integrations: Integration[]; media: any[]; posts: PostRow[] };
type Integration = { id: string; name: string; identifier: string; picture: string | null; disabled: boolean; profile: string | null };
type PostRow = { id: string; organizationId: string; content: string; publishDate: string; releaseURL: string | null; releaseId: string | null; state: string; group: string; integrationId: string; deleted: boolean };
export type Mode = "ok" | "hang-after-create" | "hang-without-create" | "fail-500" | "reject";

export class FakePostiz {
  orgs = new Map<string, Org>();
  connections: { state: string; apiKey: string; provider: string; redirectUrl: string; webhookUrl: string; refreshId?: string }[] = [];
  createCalls = 0;
  uploadBytes: number[] = [];
  mode: Mode = "ok";
  hangMs = 400;
  private server!: Server;
  url = "";
  constructor(private jwtSecret: string) {}

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    const a = this.server.address() as any;
    this.url = `http://127.0.0.1:${a.port}`;
  }
  async stop() {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
  orgByKey(key: string | undefined) {
    return [...this.orgs.values()].find((o) => o.apiKey === key) || null;
  }
  addIntegration(apiKey: string, i: Partial<Integration> & { identifier: string; name: string }) {
    const org = this.orgByKey(apiKey)!;
    const row: Integration = { id: `chan_${randomUUID().slice(0, 8)}`, picture: null, disabled: false, profile: null, ...i };
    org.integrations.push(row);
    return row;
  }
  posts() {
    return [...this.orgs.values()].flatMap((o) => o.posts).filter((p) => !p.deleted);
  }
  setPostState(id: string, state: "PUBLISHED" | "ERROR" | "QUEUE", releaseURL: string | null = null) {
    const p = this.posts().find((x) => x.id === id)!;
    p.state = state;
    p.releaseURL = releaseURL;
  }
  /** Simulates the user finishing the platform login: Postiz calls the recorded webhook. */
  async completeConnection(state: string, valid = true) {
    const c = this.connections.find((x) => x.state === state)!;
    const org = this.orgByKey(c.apiKey)!;
    this.addIntegration(org.apiKey, { identifier: c.provider, name: `${c.provider} page` });
    return fetch(c.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: jwt.sign({ apiKey: org.apiKey }, valid ? this.jwtSecret : "another-secret-that-is-long-enough-000") }),
    });
  }

  private async handle(req: any, res: any) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": typeof body === "string" ? "text/html" : "application/json" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const json = () => {
      try {
        return JSON.parse(raw.toString("utf8"));
      } catch {
        return {};
      }
    };
    const verify = (token: string) => {
      try {
        return jwt.verify(token, this.jwtSecret) as any;
      } catch {
        return null;
      }
    };
    if (url.pathname === "/enterprise/create-user" && req.method === "POST") {
      const p = verify(json().params);
      if (!p) return send(201, { success: false });
      if ([...this.orgs.values()].some((o) => o.email === p.email)) return send(201, { create: false });
      const org: Org = { id: randomUUID(), apiKey: `key_${randomUUID()}`, email: p.email, integrations: [], media: [], posts: [] };
      this.orgs.set(org.id, org);
      return send(201, { id: org.id, apiKey: org.apiKey });
    }
    if (url.pathname === "/enterprise/url" && req.method === "POST") {
      const p = verify(json().params);
      const org = p && this.orgByKey(p.apiKey);
      if (!org) return send(201, "");
      const state = randomUUID();
      this.connections.push({ state, apiKey: org.apiKey, provider: p.provider, redirectUrl: p.redirectUrl, webhookUrl: p.webhookUrl, refreshId: p.refreshId });
      return send(201, `https://platform.example/oauth?state=${state}`);
    }
    const org = this.orgByKey(req.headers.authorization);
    if (!org) return send(401, { msg: "Invalid API key" });
    if (url.pathname === "/public/v1/upload" && req.method === "POST") {
      const body = raw.toString("latin1");
      if (!/name="file"/.test(body) || !/Content-Type: video\/mp4/.test(body)) return send(400, { msg: "No file provided" });
      const start = body.indexOf("\r\n\r\n") + 4, end = body.lastIndexOf("\r\n--");
      this.uploadBytes.push(end - start);
      const media = { id: randomUUID(), name: "upload.mp4", path: `${this.url}/uploads/${randomUUID()}.mp4`, organizationId: org.id };
      org.media.push(media);
      return send(201, media);
    }
    if (url.pathname === "/public/v1/integrations" && req.method === "GET") return send(200, org.integrations);
    let m = url.pathname.match(/^\/public\/v1\/integrations\/([^/]+)$/);
    if (m && req.method === "DELETE") {
      const i = org.integrations.findIndex((x) => x.id === m![1]);
      if (i < 0) return send(500, { statusCode: 500, message: "Internal server error" });
      for (const p of org.posts) if (p.integrationId === m[1]) p.deleted = true;
      org.integrations.splice(i, 1);
      return send(200, { ok: true });
    }
    if (url.pathname === "/public/v1/posts" && req.method === "POST") {
      this.createCalls++;
      if (this.mode === "fail-500") return send(500, { statusCode: 500, message: "Internal server error" });
      if (this.mode === "hang-without-create") return void setTimeout(() => send(201, []), this.hangMs);
      if (this.mode === "reject") return send(400, { statusCode: 400, provider: "instagram", name: "Instagram", message: "post is too long, please fix it" });
      const b = json();
      const out: any[] = [];
      for (const post of b.posts || []) {
        const integ = org.integrations.find((x) => x.id === post.integration?.id);
        if (!integ) return send(400, { statusCode: 400, message: `Integration with id ${post.integration?.id} not found` });
        const row: PostRow = { id: `post_${randomUUID().slice(0, 8)}`, organizationId: org.id, content: post.value[0].content, publishDate: new Date(b.date).toISOString(), releaseURL: null, releaseId: null, state: b.type === "draft" ? "DRAFT" : "QUEUE", group: randomUUID(), integrationId: integ.id, deleted: false };
        org.posts.push(row);
        out.push({ postId: row.id, integration: integ.id });
      }
      if (this.mode === "hang-after-create") return void setTimeout(() => send(201, out), this.hangMs);
      return send(201, out);
    }
    if (url.pathname === "/public/v1/posts" && req.method === "GET") {
      const s = Date.parse(url.searchParams.get("startDate") || ""), e = Date.parse(url.searchParams.get("endDate") || "");
      const posts = org.posts
        .filter((p) => !p.deleted && Date.parse(p.publishDate) >= s && Date.parse(p.publishDate) <= e)
        .map(({ integrationId, deleted, organizationId, ...p }) => {
          const i = org.integrations.find((x) => x.id === integrationId);
          return { ...p, integration: i ? { id: i.id, providerIdentifier: i.identifier, name: i.name, picture: null } : null };
        })
        .filter((p) => p.integration);
      return send(200, { posts });
    }
    m = url.pathname.match(/^\/public\/v1\/posts\/([^/]+)$/);
    if (m && req.method === "DELETE") {
      const p = org.posts.find((x) => x.id === m![1] && !x.deleted);
      if (!p) return send(500, { statusCode: 500, message: "Internal server error" });
      for (const x of org.posts) if (x.group === p.group) x.deleted = true;
      return send(200, { ok: true });
    }
    send(404, { msg: "Not found" });
  }
}
