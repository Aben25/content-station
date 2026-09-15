// Owner-approved social publishing through self-hosted Postiz.
//
// Ownership model: one Postiz organization per shop, provisioned lazily and stored
// in cs2_publishing_orgs with the organization API key encrypted at rest. Every
// route derives the shop from the verified Firebase identity; client-supplied
// account, clip or publication IDs are checked against that shop's own records or
// the organization's own channel list before use.
//
// Publishing model: a publication is one owner decision (clip, accounts, time). Its
// document ID is derived from the shop and the owner's idempotency key, so a
// repeated tap returns the same record. The record is written before anything is
// sent. Postiz has no idempotency key of its own, so an unanswered send leaves the
// record "uncertain" and is reconciled by looking the posts up at their exact
// scheduled time before anything is sent again. Postiz is the source of truth for
// per-channel outcomes; it is polled, never trusted from unsigned callbacks.
import type { FastifyInstance } from "fastify";
import type { Server } from "node:http";
import type { Http2Server } from "node:http2";
import type { Firestore, DocumentData, Transaction } from "firebase-admin/firestore";
import type { Readable } from "node:stream";
import { KeyVault, PostizClient, PostizError, type PostizIntegration } from "../postiz.js";

type Row = Record<string, any>;
type Req = { headers: Row; body: unknown; params: unknown; query: unknown };

export type PublishingDeps = {
  db: Firestore;
  bucket: { file(path: string): { createReadStream(): Readable } };
  collection: (name: string) => FirebaseFirestore.CollectionReference<DocumentData>;
  get: (name: string, id: string) => Promise<Row | null>;
  ownerShop: (r: Req) => Promise<{ user: { uid: string }; shop: Row }>;
  ownedClip: (r: Req, includePending?: boolean) => Promise<Row>;
  now: () => number;
  iso: () => string;
  fail: (status: number, code: string, message: string) => never;
  str: (v: any, name: string, max?: number) => string;
  hash: (s: string) => string;
  base: string;
  ownerAppUrl: string;
  postiz: PostizClient | null;
  vault: KeyVault | null;
  providers: string[];
};

export const PROVIDERS: Record<string, { label: string; settings: () => Record<string, unknown> }> = {
  facebook: { label: "Facebook Page", settings: () => ({}) },
  instagram: { label: "Instagram", settings: () => ({ post_type: "post" }) },
};
const ACTIVE = new Set(["preparing", "sending", "queued", "uncertain"]);
const CHANNEL_FINAL = new Set(["published", "failed", "cancelled"]);
const MAX_ACCOUNTS = 5;
const SEND_LEASE_MS = 5 * 60000;
const LOOKUP_WINDOW_MS = 2 * 60000;
const LATE_AFTER_MS = 15 * 60000;
const STALE_AFTER_MS = 15000;

const aggregate = (channels: Row[]) => {
  const s = channels.map((c) => c.state as string);
  if (s.length && s.every((x) => x === "published")) return "published";
  if (s.some((x) => x === "published") && s.every((x) => CHANNEL_FINAL.has(x))) return "partial";
  if (s.length && s.every((x) => x === "failed")) return "failed";
  if (s.length && s.every((x) => CHANNEL_FINAL.has(x))) return "cancelled";
  if (s.some((x) => x === "uncertain")) return "uncertain";
  return "queued";
};
const mapState = (state: string) =>
  state === "PUBLISHED" ? "published" : state === "ERROR" ? "failed" : "queued";
const FAILED_MESSAGE = "The platform did not accept this post. Check the account connection and try again.";

export function registerPublishing(app: FastifyInstance<Server | Http2Server>, d: PublishingDeps) {
  const { db, collection, get, fail, str, hash, now, iso } = d;
  const enabled = !!(d.postiz && d.vault);
  const providers = d.providers.filter((p) => p in PROVIDERS);
  const postiz = () => (d.postiz && d.vault ? d.postiz : fail(503, "publishing_unconfigured", "Publishing is not set up on this server."));
  const unavailable = (e: unknown): never => {
    if (e instanceof PostizError)
      fail(503, "publishing_unavailable", "Publishing is temporarily unavailable. Try again shortly.");
    throw e;
  };
  const orgs = () => collection("publishing_orgs"),
    pubs = () => collection("publications");

  const readyOrg = async (shopId: string) => {
    const row = await get("publishing_orgs", shopId);
    return row && row.state === "ready" && row.api_key_enc ? { id: row.postiz_org_id as string, apiKey: d.vault!.open(row.api_key_enc), row } : null;
  };

  // One organization per shop. The attempt counter makes the synthetic email unique
  // per try, so a crash after Postiz created an organization but before its key was
  // stored leaves an empty organization behind rather than blocking the shop.
  const ensureOrg = async (shop: Row) => {
    const client = postiz();
    const ref = orgs().doc(shop.id);
    type Claim = { ready: Row } | { busy: true } | { attempt: number };
    const claim = await db.runTransaction(async (tx: Transaction): Promise<Claim> => {
      const s = await tx.get(ref),
        row = s.data();
      if (row?.state === "ready" && row.api_key_enc) return { ready: row };
      if (row?.state === "provisioning" && Date.parse(row.lease_until || 0) > now()) return { busy: true };
      const attempt = (row?.attempt || 0) + 1;
      tx.set(
        ref,
        {
          shop_id: shop.id,
          state: "provisioning",
          attempt,
          lease_until: new Date(now() + 60000).toISOString(),
          created_at: row?.created_at || iso(),
          updated_at: iso(),
        },
        { merge: true },
      );
      return { attempt };
    });
    if ("ready" in claim) return { id: claim.ready.postiz_org_id as string, apiKey: d.vault!.open(claim.ready.api_key_enc) };
    if ("busy" in claim) fail(409, "publishing_busy", "Publishing is being set up. Try again in a moment.");
    const attempt = (claim as { attempt: number }).attempt;
    let created: Awaited<ReturnType<PostizClient["createOrganization"]>>;
    try {
      created = await client.createOrganization({
        id: `${shop.id}-${attempt}`,
        name: String(shop.name || "Shop").slice(0, 80),
        email: `shop-${shop.id}-${attempt}@shops.contentstation.invalid`,
      });
    } catch (e) {
      await ref.update({ state: "failed", lease_until: null, updated_at: iso() });
      return unavailable(e);
    }
    if ("duplicate" in created) {
      await ref.update({ state: "failed", lease_until: null, updated_at: iso() });
      fail(503, "publishing_setup_failed", "Publishing could not be set up. Try again.");
    }
    const org = created as { id: string; apiKey: string };
    await ref.update({
      state: "ready",
      postiz_org_id: org.id,
      api_key_enc: d.vault!.seal(org.apiKey),
      api_key_hash: KeyVault.fingerprint(org.apiKey),
      lease_until: null,
      updated_at: iso(),
    });
    return { id: org.id, apiKey: org.apiKey };
  };

  const presentAccount = (i: PostizIntegration) => ({
    id: i.id,
    provider: i.identifier,
    provider_label: PROVIDERS[i.identifier]?.label || i.identifier,
    name: i.name,
    profile: i.profile,
    picture: i.picture,
    disabled: i.disabled,
  });
  const accountsFor = async (apiKey: string) => {
    try {
      return (await postiz().listIntegrations(apiKey)).filter((i) => providers.includes(i.identifier));
    } catch (e) {
      return unavailable(e);
    }
  };

  const present = (p: Row) => ({
    id: p.id,
    clip_id: p.clip_id,
    kind: p.kind,
    scheduled_at: p.scheduled_at,
    requested_at: p.requested_at,
    timezone: p.timezone,
    caption: p.caption,
    state: p.state,
    late: ACTIVE.has(p.state) && Date.parse(p.scheduled_at) + LATE_AFTER_MS < now(),
    cancel_requested: !!p.cancel_requested,
    channels: (p.channels as Row[]).map((c) => ({
      account_id: c.account_id,
      provider: c.provider,
      provider_label: PROVIDERS[c.provider]?.label || c.provider,
      name: c.name,
      state: c.state,
      live_url: c.live_url,
      error: c.error,
      updated_at: c.updated_at,
    })),
    last_error: p.last_error,
    created_at: p.created_at,
    updated_at: p.updated_at,
  });

  const save = async (p: Row, patch: Row) => {
    const next: Row = { ...p, ...patch, updated_at: iso() };
    next.active = ACTIVE.has(next.state) || !!next.cancel_requested;
    await pubs().doc(p.id).set(next);
    return next;
  };

  // Sends the channels that have never been sent. Everything else is left alone.
  const perform = async (p: Row): Promise<Row> => {
    const client = postiz();
    const org = await readyOrg(p.shop_id);
    if (!org) return save(p, { state: "failed", last_error: "Connect an account first.", channels: p.channels.map((c: Row) => ({ ...c, state: "failed", error: "Connect an account first.", updated_at: iso() })) });
    const clip = await get("clips", p.clip_id);
    if (!clip || clip.deletion_state)
      return save(p, { state: "cancelled", last_error: "The clip was deleted before it was published.", channels: p.channels.map((c: Row) => (CHANNEL_FINAL.has(c.state) ? c : { ...c, state: "cancelled", error: "The clip was deleted.", updated_at: iso() })) });
    let current = p;
    if (!current.media) {
      try {
        const media = await client.uploadMedia(org.apiKey, {
          stream: d.bucket.file(clip.path).createReadStream(),
          filename: `${p.clip_id.slice(0, 16)}.mp4`,
          contentType: "video/mp4",
        });
        current = await save(current, { media });
      } catch (e) {
        if (e instanceof PostizError) return save(current, { state: e.ambiguous ? "preparing" : "failed", next_check_at: new Date(now() + 60000).toISOString(), lease_until: null, last_error: e.message });
        throw e;
      }
    }
    const pending = (current.channels as Row[]).filter((c) => c.state === "pending");
    if (!pending.length) return save(current, { state: aggregate(current.channels), lease_until: null });
    current = await save(current, { state: "sending", sent_at: iso(), lease_until: new Date(now() + SEND_LEASE_MS).toISOString() });
    try {
      const result = await client.createPosts(org.apiKey, {
        type: "schedule",
        date: current.scheduled_at,
        shortLink: false,
        tags: [],
        posts: pending.map((c) => ({
          integration: { id: c.account_id },
          value: [{ content: current.caption, image: [current.media] }],
          settings: PROVIDERS[c.provider].settings(),
        })),
      });
      const channels = (current.channels as Row[]).map((c) => {
        if (c.state !== "pending") return c;
        const hit = result.find((r) => r.integration === c.account_id);
        return hit ? { ...c, postiz_post_id: hit.postId, state: "queued", updated_at: iso() } : { ...c, state: "uncertain", updated_at: iso() };
      });
      return save(current, {
        channels,
        postiz_post_ids: channels.map((c) => c.postiz_post_id).filter(Boolean),
        state: aggregate(channels),
        lease_until: null,
        last_error: null,
        next_check_at: new Date(Math.max(now() + 60000, Date.parse(current.scheduled_at) + 30000)).toISOString(),
        checks: 0,
      });
    } catch (e) {
      if (!(e instanceof PostizError)) throw e;
      if (e.ambiguous)
        return save(current, {
          channels: (current.channels as Row[]).map((c) => (c.state === "pending" ? { ...c, state: "uncertain", updated_at: iso() } : c)),
          state: "uncertain",
          lease_until: null,
          last_error: e.message,
          next_check_at: new Date(now() + 30000).toISOString(),
        });
      const body: any = e.body;
      const message = typeof body?.message === "string" ? `${body.name ? `${body.name}: ` : ""}${body.message}` : e.message;
      return save(current, {
        channels: (current.channels as Row[]).map((c) => (c.state === "pending" ? { ...c, state: "failed", error: message, updated_at: iso() } : c)),
        state: aggregate(current.channels.map((c: Row) => (c.state === "pending" ? { ...c, state: "failed" } : c))),
        lease_until: null,
        last_error: message,
        next_check_at: null,
      });
    }
  };

  // Brings a record in line with Postiz. Safe to call repeatedly.
  const reconcile = async (p: Row): Promise<Row> => {
    if (!enabled) return p;
    let current = p;
    const leaseExpired = !current.lease_until || Date.parse(current.lease_until) <= now();
    if (current.state === "preparing" && leaseExpired) current = await perform(await save(current, { lease_until: new Date(now() + SEND_LEASE_MS).toISOString() }));
    else if (current.state === "sending" && leaseExpired) current = await save(current, { state: "uncertain", channels: current.channels.map((c: Row) => (c.state === "pending" ? { ...c, state: "uncertain", updated_at: iso() } : c)), lease_until: null });
    if (!ACTIVE.has(current.state) && !current.cancel_requested) return current;
    const org = await readyOrg(current.shop_id);
    if (!org) return current;
    const client = postiz();
    const at = Date.parse(current.scheduled_at);
    let posts;
    try {
      posts = await client.listPosts(org.apiKey, new Date(at - LOOKUP_WINDOW_MS).toISOString(), new Date(at + LOOKUP_WINDOW_MS).toISOString());
    } catch (e) {
      if (e instanceof PostizError) return save(current, { next_check_at: new Date(now() + 60000).toISOString(), checked_at: iso() });
      throw e;
    }
    let resend = false;
    const channels = (current.channels as Row[]).map((c) => {
      if (CHANNEL_FINAL.has(c.state) || c.state === "pending") return c;
      const match = posts.find((x) => (c.postiz_post_id ? x.id === c.postiz_post_id : x.integration.id === c.account_id && x.publishDate === current.scheduled_at));
      if (match)
        return { ...c, postiz_post_id: match.id, state: mapState(match.state), live_url: match.releaseURL, error: match.state === "ERROR" ? FAILED_MESSAGE : null, updated_at: iso() };
      if (c.postiz_post_id) return { ...c, state: "cancelled", error: "This post was removed from the publishing service.", updated_at: iso() };
      resend = true;
      return { ...c, state: "pending", updated_at: iso() };
    });
    current = await save(current, {
      channels,
      postiz_post_ids: channels.map((c) => c.postiz_post_id).filter(Boolean),
      state: resend ? "preparing" : aggregate(channels),
      checked_at: iso(),
      checks: (current.checks || 0) + 1,
    });
    if (current.cancel_requested) current = await cancel(current);
    else if (resend) current = await perform(await save(current, { lease_until: new Date(now() + SEND_LEASE_MS).toISOString() }));
    if (ACTIVE.has(current.state)) {
      const backoff = Math.min(30 * 60000, 60000 * Math.pow(2, Math.min(5, current.checks || 0)));
      current = await save(current, { next_check_at: new Date(Math.max(now() + backoff, at + 30000)).toISOString() });
    } else current = await save(current, { next_check_at: null });
    return current;
  };

  const cancel = async (p: Row): Promise<Row> => {
    const org = await readyOrg(p.shop_id);
    const client = postiz();
    let failed = false;
    const channels: Row[] = [];
    for (const c of p.channels as Row[]) {
      if (CHANNEL_FINAL.has(c.state)) {
        channels.push(c);
        continue;
      }
      if (c.postiz_post_id && org) {
        try {
          await client.deletePost(org.apiKey, c.postiz_post_id);
        } catch (e) {
          if (!(e instanceof PostizError) || e.status !== 404) {
            failed = true;
            channels.push(c);
            continue;
          }
        }
      }
      channels.push({ ...c, state: "cancelled", error: null, updated_at: iso() });
    }
    return save(p, { channels, cancel_requested: failed, state: failed ? p.state : aggregate(channels), next_check_at: failed ? new Date(now() + 60000).toISOString() : null });
  };

  const fresh = async (p: Row) =>
    (ACTIVE.has(p.state) || p.cancel_requested) && (!p.checked_at || Date.parse(p.checked_at) + STALE_AFTER_MS < now()) ? reconcile(p) : p;

  const ownedPublication = async (r: Req) => {
    const { shop } = await d.ownerShop(r);
    const p = await get("publications", str((r.params as Row).id, "publication", 128));
    if (!p || p.shop_id !== shop.id) fail(404, "publication_missing", "This publication was not found.");
    return { shop, publication: p! };
  };

  app.get("/publishing/accounts", async (r) => {
    const { shop } = await d.ownerShop(r);
    if (!enabled) return { configured: false, providers: [], accounts: [] };
    const org = await readyOrg(shop.id);
    return {
      configured: true,
      providers: providers.map((id) => ({ id, label: PROVIDERS[id].label })),
      accounts: org ? (await accountsFor(org.apiKey)).map(presentAccount) : [],
      connect_completed_at: org?.row.connect_completed_at || null,
    };
  });

  const startConnection = async (r: Req, refreshId?: string) => {
    const { shop } = await d.ownerShop(r);
    const b = (r.body && typeof r.body === "object" ? r.body : {}) as Row;
    const provider = str(b.provider, "provider", 40);
    if (!providers.includes(provider)) fail(400, "provider_unavailable", "That platform is not available yet.");
    const org = await ensureOrg(shop);
    if (refreshId) {
      const accounts = await accountsFor(org.apiKey);
      if (!accounts.some((a) => a.id === refreshId)) fail(404, "account_missing", "That account is not connected to your shop.");
    }
    try {
      const url = await postiz().connectUrl({
        apiKey: org.apiKey,
        provider,
        redirectUrl: `${d.ownerAppUrl}/#/accounts`,
        webhookUrl: `${d.base}/publishing/webhooks/connected`,
        ...(refreshId ? { refreshId } : {}),
      });
      await orgs().doc(shop.id).update({ connect_started_at: iso(), connect_provider: provider, updated_at: iso() });
      return { url, provider };
    } catch (e) {
      return unavailable(e);
    }
  };
  app.post("/publishing/accounts/connect", async (r) => startConnection(r));
  app.post("/publishing/accounts/:id/reconnect", async (r) => startConnection(r, str((r.params as Row).id, "account", 128)));

  app.delete("/publishing/accounts/:id", async (r) => {
    const { shop } = await d.ownerShop(r);
    const id = str((r.params as Row).id, "account", 128);
    const org = await readyOrg(shop.id);
    if (!org || !(await accountsFor(org.apiKey)).some((a) => a.id === id))
      fail(404, "account_missing", "That account is not connected to your shop.");
    try {
      await postiz().deleteIntegration(org!.apiKey, id);
    } catch (e) {
      return unavailable(e);
    }
    // Postiz removes the channel's queued posts with the channel.
    const active = await pubs().where("shop_id", "==", shop.id).where("active", "==", true).get();
    for (const s of active.docs) {
      const p = { ...s.data(), id: s.id } as Row;
      const channels = (p.channels as Row[]).map((c) => (c.account_id === id && !CHANNEL_FINAL.has(c.state) ? { ...c, state: "cancelled", error: "The account was disconnected.", updated_at: iso() } : c));
      await save(p, { channels, state: ACTIVE.has(p.state) ? aggregate(channels) : p.state });
    }
    return { ok: true };
  });

  // Postiz calls this after a connection completes. The body carries a JWT signed with
  // the instance secret and only identifies the organization; the channel list is
  // read from Postiz afterwards, never taken from this payload.
  app.post("/publishing/webhooks/connected", async (r) => {
    const b = (r.body && typeof r.body === "object" ? r.body : {}) as Row;
    const payload = d.postiz ? d.postiz.verifyParams(b.params) : null;
    if (!payload || typeof payload.apiKey !== "string") fail(401, "invalid_signature", "Webhook authentication failed.");
    const match = await orgs().where("api_key_hash", "==", KeyVault.fingerprint(payload!.apiKey)).limit(1).get();
    if (!match.empty) await match.docs[0].ref.update({ connect_completed_at: iso(), updated_at: iso() });
    return { ok: true };
  });

  app.post("/clips/:id/publish", async (r, reply) => {
    const clip = await d.ownedClip(r);
    const { shop } = await d.ownerShop(r);
    postiz();
    const b = (r.body && typeof r.body === "object" ? r.body : {}) as Row;
    const key = str(b.idempotency_key, "request key", 128);
    if (key.length < 8) fail(400, "invalid_input", "Provide a valid request key.");
    if (!Array.isArray(b.account_ids) || !b.account_ids.length || b.account_ids.length > MAX_ACCOUNTS)
      fail(400, "invalid_accounts", `Choose between one and ${MAX_ACCOUNTS} accounts.`);
    const ids: string[] = Array.from(new Set(b.account_ids.map((v: any) => str(v, "account", 128))));
    let requestedAt: string | null = null;
    if (b.schedule_at !== undefined && b.schedule_at !== null) {
      const t = Date.parse(str(b.schedule_at, "schedule time", 40));
      if (!Number.isFinite(t)) fail(400, "invalid_schedule", "Choose a valid time.");
      if (t < now() + 2 * 60000) fail(400, "invalid_schedule", "Choose a time at least two minutes from now.");
      if (t > now() + 90 * 86400000) fail(400, "invalid_schedule", "Choose a time within the next 90 days.");
      requestedAt = new Date(t).toISOString();
    }
    const org = await readyOrg(shop.id);
    if (!org) fail(409, "accounts_missing", "Connect an account before publishing.");
    const accounts = await accountsFor(org!.apiKey);
    const chosen = ids.map((id) => {
      const a = accounts.find((x) => x.id === id);
      if (!a) fail(404, "account_missing", "One of the chosen accounts is not connected to your shop.");
      if (a!.disabled) fail(409, "account_disabled", `${a!.name} needs to be reconnected first.`);
      return a!;
    });
    const id = hash(`${shop.id}:${key}`);
    // Exact scheduled second is unique per publication so the record can be matched
    // back to Postiz posts by time when a send goes unanswered.
    const jitter = parseInt(id.slice(0, 8), 16) % 60;
    const when = requestedAt
      ? new Date(new Date(requestedAt).setUTCSeconds(jitter, 0)).toISOString()
      : new Date(Math.floor(now() / 1000) * 1000 + 30000).toISOString();
    const created = await db.runTransaction(async (tx: Transaction) => {
      const ref = pubs().doc(id),
        s = await tx.get(ref);
      if (s.exists) return null;
      const doc: Row = {
        id,
        shop_id: shop.id,
        clip_id: clip.id,
        idempotency_key: key,
        caption: clip.caption,
        kind: requestedAt ? "schedule" : "now",
        scheduled_at: when,
        requested_at: requestedAt,
        timezone: shop.timezone,
        state: "preparing",
        active: true,
        media: null,
        channels: chosen.map((a) => ({ account_id: a.id, provider: a.identifier, name: a.name, postiz_post_id: null, state: "pending", live_url: null, error: null, updated_at: iso() })),
        postiz_post_ids: [],
        cancel_requested: false,
        lease_until: new Date(now() + SEND_LEASE_MS).toISOString(),
        next_check_at: null,
        checked_at: null,
        checks: 0,
        last_error: null,
        created_at: iso(),
        updated_at: iso(),
      };
      tx.create(ref, doc);
      return doc;
    });
    if (!created) return present(await fresh((await get("publications", id))!));
    reply.code(201);
    return present(await perform(created));
  });

  app.get("/clips/:id/publications", async (r) => {
    const clip = await d.ownedClip(r, true);
    const rows = (await pubs().where("shop_id", "==", clip.shop_id).where("clip_id", "==", clip.id).get()).docs
      .map((s) => ({ ...s.data(), id: s.id }) as Row)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const out: Row[] = [];
    for (const p of rows) out.push(present(await fresh(p)));
    return { publications: out };
  });

  app.get("/publications/:id", async (r) => present(await fresh((await ownedPublication(r)).publication)));

  app.post("/publications/:id/cancel", async (r) => {
    let { publication: p } = await ownedPublication(r);
    p = await fresh(p);
    if (!(p.channels as Row[]).some((c) => !CHANNEL_FINAL.has(c.state)))
      fail(409, "nothing_to_cancel", p.state === "published" ? "This clip was already published." : "There is nothing left to cancel.");
    return present(await cancel(await save(p, { cancel_requested: true })));
  });

  return {
    // Deleting a clip cancels its queued posts. Already published posts and the media
    // copy inside Postiz stay; the owner is told this in the app.
    cancelForClip: async (shopId: string, clipId: string) => {
      if (!enabled) return;
      const rows = await pubs().where("shop_id", "==", shopId).where("clip_id", "==", clipId).where("active", "==", true).get();
      for (const s of rows.docs) {
        const p = await save({ ...s.data(), id: s.id }, { cancel_requested: true });
        try {
          await cancel(p);
        } catch {
          /* cancel_requested stays set; the maintenance tick retries. */
        }
      }
    },
    reconcileDue: async (limit = 25) => {
      if (!enabled) return 0;
      const rows = (await pubs().where("active", "==", true).get()).docs
        .map((s) => ({ ...s.data(), id: s.id }) as Row)
        .filter((p) => (p.next_check_at && Date.parse(p.next_check_at) <= now()) || (p.lease_until && Date.parse(p.lease_until) <= now()) || (p.cancel_requested && (!p.checked_at || Date.parse(p.checked_at) + 60000 < now())))
        .slice(0, limit);
      let done = 0;
      for (const p of rows) {
        try {
          await reconcile(p);
          done++;
        } catch {
          /* next tick retries */
        }
      }
      return done;
    },
  };
}
