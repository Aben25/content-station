// Everything a route module needs: the Fastify instance, Firebase clients,
// secrets, and the shared authorization/presentation helpers. Route modules in
// ./routes take this object and register their handlers on ctx.app.
import Fastify, { type FastifyInstance } from "fastify";
import type { Server } from "node:http";
import type { Http2Server } from "node:http2";
import cors from "@fastify/cors";
import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { ApiError, fail } from "./lib/errors.js";
import { product } from "./lib/product.js";
import { DEFAULT_HOURS } from "./lib/time.js";
import type { FastifyRequest, Row } from "./lib/types.js";
import { equal } from "./lib/validate.js";
import { KeyVault, PostizClient } from "./postiz.js";

export type Options = {
  admin?: App;
  databaseId?: string;
  now?: () => number;
  deviceSecret?: string;
  mediaSecret?: string;
  engineKey?: string;
  cronSecret?: string;
  apiBase?: string;
  smsMode?: string;
  sendSms?: (phone: string, text: string) => Promise<void>;
  deleteObject?: (path: string) => Promise<void>;
  postiz?: { url: string; jwtSecret: string; fetcher?: typeof fetch; timeoutMs?: number } | null;
  publishingSecret?: string;
  publishingProviders?: string[];
  ownerAppUrl?: string;
};

export async function createContext(options: Options = {}) {
  const now = options.now || Date.now,
    iso = () => new Date(now()).toISOString();
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "demo-contentstation-v2";
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && projectId.startsWith("demo-") && !options.admin)
    fail(
      500,
      "configuration",
      "Configure Firebase emulators or a Google Cloud project.",
    );
  const admin =
    options.admin ||
    getApps()[0] ||
    initializeApp({
      projectId,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    });
  const db = getFirestore(admin, options.databaseId || process.env.FIRESTORE_DATABASE_ID || "(default)"),
    bucket = getStorage(admin).bucket(),
    auth = getAuth(admin);
  const secret = (value: string | undefined, name: string) =>
    value && value.length >= 32
      ? value
      : fail(500, "configuration", `Set ${name} to at least 32 characters.`);
  const deviceSecret = secret(
      options.deviceSecret || process.env.DEVICE_JWT_SECRET,
      "DEVICE_JWT_SECRET",
    ),
    mediaSecret = secret(
      options.mediaSecret || process.env.MEDIA_SECRET,
      "MEDIA_SECRET",
    );
  const engineKey = secret(
      options.engineKey || process.env.ENGINE_API_KEY,
      "ENGINE_API_KEY",
    ),
    cronSecret = secret(
      options.cronSecret || process.env.CRON_SECRET,
      "CRON_SECRET",
    );
  const base = (
    options.apiBase ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:4310"
  ).replace(/\/$/, "");
  // Self-hosted Postiz publishing is optional. Both POSTIZ_URL and
  // POSTIZ_JWT_SECRET must be set to enable it; PUBLISHING_SECRET protects the
  // per-shop organization keys stored in Firestore.
  const postizConfig =
    options.postiz === null
      ? null
      : options.postiz ||
        (process.env.POSTIZ_URL && process.env.POSTIZ_JWT_SECRET
          ? { url: process.env.POSTIZ_URL, jwtSecret: process.env.POSTIZ_JWT_SECRET }
          : null);
  if (postizConfig && postizConfig.jwtSecret.length < 32)
    fail(500, "configuration", "Set POSTIZ_JWT_SECRET to at least 32 characters.");
  const postiz = postizConfig ? new PostizClient(postizConfig) : null;
  const vault = postiz
    ? new KeyVault(secret(options.publishingSecret || process.env.PUBLISHING_SECRET, "PUBLISHING_SECRET"))
    : null;
  const publishingProviders = options.publishingProviders ||
    (process.env.POSTIZ_PROVIDERS || "facebook,instagram").split(",").map((s) => s.trim()).filter(Boolean);
  const ownerAppUrl = (options.ownerAppUrl || process.env.OWNER_APP_URL || product.ownerAppUrl).replace(/\/$/, "");
  const serverOptions = {
    logger: false,
    bodyLimit: 1048576,
    requestTimeout: 300000,
    routerOptions: { maxParamLength: 4096 },
  };
  // Cloud Run needs an HTTP/2 backend for camera uploads larger than 32 MiB.
  // TLS terminates at Cloud Run; local development keeps its HTTP/1 listener.
  // Widen Fastify's protocol-specific overloads at the construction boundary;
  // all routes below use request/response members shared by both protocols.
  const app = (process.env.API_HTTP2 === "true"
    ? Fastify({ ...serverOptions, http2: true })
    : Fastify(serverOptions)) as FastifyInstance<Server | Http2Server>;
  await app.register(cors, {
    origin: process.env.OWNER_ORIGIN?.split(",") || [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-upsert"],
    exposedHeaders: ["content-range", "accept-ranges", "content-length"],
  });
  app.addContentTypeParser(
    ["video/mp4", "image/jpeg", "application/octet-stream"],
    (_request, payload, done) => done(null, payload),
  );
  app.setErrorHandler((e: any, _request, reply) => {
    const status = e.statusCode || 500;
    if (status >= 500) app.log.error({ err: e }, "Request failed");
    reply.code(status).send({
      error: {
        code:
          e.code && e instanceof ApiError
            ? e.code
            : status >= 500
              ? "internal_error"
              : "invalid_request",
        message:
          e instanceof ApiError
            ? e.message
            : status >= 500
              ? "Something went wrong. Please try again."
              : "Check the request and try again.",
      },
    });
  });
  const collection = (name: string) => db.collection(`cs2_${name}`);
  const get = async (name: string, id: string) => {
    const s = await collection(name).doc(id).get();
    return s.exists ? ({ ...s.data(), id: s.id } as Row) : null;
  };
  const owner = async (r: FastifyRequest) => {
    const token = r.headers.authorization?.replace(/^Bearer /, "");
    if (!token) fail(401, "unauthorized", "Sign in to continue.");
    try {
      return await auth.verifyIdToken(token!, true);
    } catch {
      return fail(401, "unauthorized", "Sign in again to continue.");
    }
  };
  const ownerShop = async (r: FastifyRequest) => {
    const user = await owner(r),
      member = await get("memberships", user.uid);
    if (!member) fail(404, "shop_missing", "Create your shop first.");
    const shop = await get("shops", member!.shop_id);
    if (!shop) fail(404, "shop_missing", "Your shop could not be found.");
    return { user, shop: shop! };
  };
  const currentDevice = async (shop: Row, required = true) => {
    const d = shop.device_id ? await get("devices", shop.device_id) : null;
    if (required && (!d || d.unpaired_at))
      fail(404, "device_missing", "Pair your camera first.");
    return d;
  };
  const device = async (r: FastifyRequest, allowUnpaired = false) => {
    try {
      const c = jwt.verify(
        r.headers.authorization?.replace(/^Bearer /, "") || "",
        deviceSecret,
        { algorithms: ["HS256"] },
      ) as Row;
      if (c.role !== "device") throw Error();
      const d = await get("devices", c.sub);
      if (!d || d.shop_id !== c.shop_id || d.token_version !== c.token_version)
        throw Error();
      if (d.unpaired_at && !allowUnpaired) throw Error();
      return d;
    } catch {
      return fail(401, "device_unpaired", "Pair this camera again.");
    }
  };
  const engine = (r: FastifyRequest) => {
    if (!equal(r.headers["x-engine-key"], engineKey))
      fail(401, "unauthorized", "Engine authentication failed.");
  };
  const body = (r: FastifyRequest): Row =>
    r.body && typeof r.body === "object" ? (r.body as Row) : {};
  const capability = (data: Row, seconds = 3600) => {
    const payload = Buffer.from(
      JSON.stringify({ ...data, exp: now() + seconds * 1000 }),
    ).toString("base64url");
    return `${base}/media/${payload}.${createHmac("sha256", mediaSecret).update(payload).digest("base64url")}`;
  };
  const readUrl = (
    path: string | null | undefined,
    kind: string,
    id: string,
  ) => (path ? capability({ action: "read", path, kind, id }) : null);
  const config = async (d: Row) => {
    const shop = await get("shops", d.shop_id);
    return {
      server_time: iso(),
      updated_at: d.config_updated_at,
      hours: shop?.hours || DEFAULT_HOURS,
      hours_confirmed: !!shop?.hours,
      timezone: shop?.timezone || "America/Los_Angeles",
      paused_until: d.paused_until || null,
      pause_mode: d.pause_mode || "none",
      framing_until: d.framing_until || null,
      reference_frame_url: readUrl(d.reference_frame_path, "devices", d.id),
      reference_frame_revision: d.reference_frame_revision || null,
      unpaired: !!d.unpaired_at,
      workstation: shop?.workstation || "chair 1",
    };
  };
  const cameraStatus = async (shop: Row) => {
    const d = await currentDevice(shop, false);
    return {
      device_id: d?.id || null,
      status: d
        ? now() - Date.parse(d.last_seen_at || d.created_at) >
          product.heartbeatAlertMinutes * 60000
          ? "offline"
          : d.status
        : "waiting",
      status_code: d?.status_code || null,
      status_since: d?.status_since || null,
      paused_until: d?.paused_until || null,
      pause_mode: d?.pause_mode || "none",
      last_seen_at: d?.last_seen_at || null,
      wifi: d?.wifi || "none",
      thermal: d?.thermal || "nominal",
      battery: d?.battery ?? null,
      storage_free_mb: d?.storage_free_mb ?? null,
      last_thumb_url: readUrl(d?.last_thumb_path, "devices", d?.id || ""),
      hours: shop.hours || DEFAULT_HOURS,
      timezone: shop.timezone,
      workstation: shop.workstation,
      recording_seconds_today: d?.recording_seconds_today ?? 0,
      next_delivery_at: null,
    };
  };
  const presentClip = (c: Row) => ({
    id: c.id,
    caption: c.caption,
    duration_s: c.duration_s,
    status: c.status,
    created_at: c.created_at,
    delivered_at: c.delivered_at || null,
    video_url: readUrl(c.path, "clips", c.id),
    thumb_url: readUrl(c.thumb_path, "clips", c.id),
    source_seconds: c.source_end_s - c.source_start_s,
  });
  const ownedClip = async (r: FastifyRequest, includePending = false) => {
    const { shop } = await ownerShop(r);
    const c = await get("clips", (r.params as Row).id);
    if (!c || c.shop_id !== shop.id || (!includePending && c.deletion_state))
      fail(404, "clip_missing", "This clip is no longer available.");
    return c!;
  };
  const requireLease = (j: Row | null, token: any) => {
    if (
      !j ||
      j.status !== "processing" ||
      !equal(token, j.lease_token) ||
      Date.parse(j.lease_expires_at) <= now()
    )
      fail(409, "lease_lost", "This job lease is no longer active.");
    return j!;
  };
  const deleteObject =
    options.deleteObject ||
    (async (path: string) => {
      await bucket.file(path).delete({ ignoreNotFound: true });
    });
  const cleanupDeletion = async (segmentId: string) => {
    const s = await get("segments", segmentId);
    if (!s || !s.deletion_state) return;
    const clips = await collection("clips")
      .where("segment_id", "==", segmentId)
      .get();
    for (const c of clips.docs) {
      const row = c.data();
      if (row.deletion_state === "pending") {
        await deleteObject(row.path);
        if (row.thumb_path) await deleteObject(row.thumb_path);
        await c.ref.update({ deletion_state: "deleted", deleted_at: iso() });
      }
    }
    await deleteObject(s.path);
    await collection("segments")
      .doc(segmentId)
      .update({ deletion_state: "deleted", deleted_at: iso() });
  };
  const revokeSource = async (segmentId: string, clipId?: string) => {
    await db.runTransaction(async (tx) => {
      const sr = collection("segments").doc(segmentId),
        jr = collection("engine_jobs").doc(segmentId);
      const [s, j, c] = await Promise.all([
        tx.get(sr),
        tx.get(jr),
        clipId
          ? tx.get(collection("clips").doc(clipId))
          : Promise.resolve(null),
      ]);
      if (!s.exists) return;
      if (c) tx.update(c.ref, { deletion_state: "pending" });
      tx.update(sr, { deletion_state: "pending" });
      if (j.exists) tx.update(jr, { status: "cancelled", cancelled_at: iso() });
    });
  };
  return {
    app,
    options,
    now,
    iso,
    projectId,
    emulator,
    admin,
    db,
    bucket,
    auth,
    deviceSecret,
    mediaSecret,
    engineKey,
    cronSecret,
    base,
    postiz,
    vault,
    publishingProviders,
    ownerAppUrl,
    collection,
    get,
    owner,
    ownerShop,
    currentDevice,
    device,
    engine,
    body,
    capability,
    readUrl,
    config,
    cameraStatus,
    presentClip,
    ownedClip,
    requireLease,
    deleteObject,
    cleanupDeletion,
    revokeSource,
  };
}

export type Ctx = Awaited<ReturnType<typeof createContext>>;
