import Fastify, { type FastifyRequest as Request, type FastifyInstance } from "fastify";
import type { Server } from "node:http";
import type { Http2Server } from "node:http2";
import cors from "@fastify/cors";
import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import jwt from "jsonwebtoken";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFileSync } from "node:fs";
const product = JSON.parse(
  readFileSync(new URL("../../product.json", import.meta.url), "utf8"),
);
const DEFAULT_HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    d === "sun" ? null : { open: "09:00", close: "19:00" },
  ]),
);
type Row = Record<string, any>;
type FastifyRequest = Pick<Request, "headers" | "body" | "params" | "query">;
type Options = {
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
};
class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const equal = (a: unknown, b: string) =>
  typeof a === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const str = (v: any, name: string, max = 256) =>
  typeof v === "string" && v.trim() && v.length <= max
    ? v.trim()
    : fail(400, "invalid_input", `Provide a valid ${name}.`);
const finite = (v: any, name: string, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(400, "invalid_input", `Provide a valid ${name}.`);
const timestamp = (v: any) => {
  const s = str(v, "timestamp", 40);
  return Number.isFinite(Date.parse(s))
    ? new Date(s).toISOString()
    : fail(400, "invalid_input", "Provide a valid timestamp.");
};
function validateHours(v: any) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail(400, "invalid_hours", "Provide weekly opening hours.");
  for (const d of Object.keys(DEFAULT_HOURS)) {
    if (!(d in v)) fail(400, "invalid_hours", "Provide all seven days.");
    const h = v[d];
    if (
      h !== null &&
      (!h ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.open) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.close))
    )
      fail(400, "invalid_hours", "Use valid opening and closing times.");
  }
  return Object.fromEntries(
    Object.keys(DEFAULT_HOURS).map((d) => [
      d,
      v[d] === null ? null : { open: v[d].open, close: v[d].close },
    ]),
  );
}
function localParts(ms: number, timezone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(ms)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
function localDate(ms: number, timezone: string) {
  const p = localParts(ms, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
function nextOpening(ms: number, shop: Row) {
  const today = localDate(ms, shop.timezone);
  for (let i = 1; i <= 8 * 24 * 60; i++) {
    const at = Math.floor(ms / 60000) * 60000 + i * 60000;
    const p = localParts(at, shop.timezone);
    if (`${p.year}-${p.month}-${p.day}` === today) continue;
    const h = (shop.hours || DEFAULT_HOURS)[p.weekday.toLowerCase()];
    if (h && `${p.hour}:${p.minute}` === h.open) return at;
  }
  return ms + 24 * 3600000;
}
export async function buildApp(options: Options = {}) {
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
    (r, p, done) => done(null, p),
  );
  app.setErrorHandler((e: any, r, reply) => {
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
  app.get("/health", async () => ({
    ok: true,
    at: iso(),
    backend: "firebase",
    emulator,
    project_id: projectId,
  }));
  for (const p of ["/auth/otp/send", "/auth/otp/verify"])
    app.post(p, async () =>
      fail(
        410,
        "firebase_auth_required",
        "Use Firebase phone authentication to sign in.",
      ),
    );
  app.get("/me", async (r) => {
    const user = await owner(r);
    const m = await get("memberships", user.uid),
      shop = m ? await get("shops", m.shop_id) : null;
    const d = shop ? await currentDevice(shop, false) : null;
    return {
      user: { id: user.uid, phone: user.phone_number || null },
      shop,
      device: d
        ? {
            id: d.id,
            status: d.status,
            reference_frame_path: d.reference_frame_path || null,
          }
        : null,
      onboarding_step: !shop
        ? "shop"
        : !d
          ? "wifi"
          : !d.reference_frame_path
            ? "frame"
            : !shop.hours
              ? "hours"
              : "done",
      replacement_context: shop?.replacement_context || null,
    };
  });
  app.post("/shops", async (r) => {
    const user = await owner(r),
      b = body(r);
    const shop = {
      id: randomUUID(),
      name: str(b.name, "shop name", 120),
      type: str(b.type, "shop type", 80),
      instagram: b.instagram ? str(b.instagram, "Instagram", 100) : null,
      timezone: b.timezone || "America/Los_Angeles",
      hours: null,
      workstation: "chair 1",
      owner_id: user.uid,
      phone: user.phone_number || null,
      device_id: null,
      delivery_hour: product.deliveryHourLocal,
      created_at: iso(),
    };
    try {
      new Intl.DateTimeFormat("en", { timeZone: shop.timezone });
    } catch {
      fail(400, "invalid_timezone", "Choose a valid timezone.");
    }
    return db.runTransaction(async (tx) => {
      const mr = collection("memberships").doc(user.uid),
        m = await tx.get(mr);
      if (m.exists) {
        const existing = await tx.get(
          collection("shops").doc(m.data()!.shop_id),
        );
        return { shop: { ...existing.data(), id: existing.id } };
      }
      tx.create(collection("shops").doc(shop.id), shop);
      tx.create(mr, { shop_id: shop.id, role: "owner", created_at: iso() });
      return { shop };
    });
  });
  app.patch("/shops/current", async (r) => {
    const { shop } = await ownerShop(r),
      b = body(r),
      patch: Row = {};
    for (const k of ["name", "type", "instagram", "timezone"])
      if (k in b) patch[k] = str(b[k], k, 120);
    if (patch.timezone)
      try {
        new Intl.DateTimeFormat("en", { timeZone: patch.timezone });
      } catch {
        fail(400, "invalid_timezone", "Choose a valid timezone.");
      }
    if ("hours" in b) patch.hours = validateHours(b.hours);
    const batch = db.batch();
    batch.update(collection("shops").doc(shop.id), patch);
    if (shop.device_id)
      batch.update(collection("devices").doc(shop.device_id), {
        config_updated_at: iso(),
      });
    await batch.commit();
    return { shop: { ...shop, ...patch } };
  });
  app.get("/shop/hours/suggest", async (r) => {
    await owner(r);
    return { hours: DEFAULT_HOURS, source: "default" };
  });
  app.post("/pair/token", async (r) => {
    const { shop } = await ownerShop(r),
      b = body(r);
    const ssid = str(b.ssid, "Wi-Fi name", 64),
      password =
        typeof b.password === "string" && b.password.length <= 256
          ? b.password
          : fail(400, "invalid_input", "Provide the Wi-Fi password.");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const token = Array.from(randomBytes(12), (n) => alphabet[n % 32]).join("");
    const expires_at = new Date(
      now() + product.pairTokenMinutes * 60000,
    ).toISOString();
    await db.runTransaction(async (tx) => {
      const sr = collection("shops").doc(shop.id),
        fresh = await tx.get(sr);
      const prior = fresh.data()?.pair_token_hash;
      if (prior) tx.delete(collection("pair_tokens").doc(prior));
      tx.create(collection("pair_tokens").doc(hash(token)), {
        shop_id: shop.id,
        state: "waiting",
        expires_at,
        created_at: iso(),
        device_id: null,
        serial: null,
      });
      tx.update(sr, { pair_token_hash: hash(token) });
    });
    return {
      pair_token: token,
      expires_at,
      qr_payload: Buffer.from(
        JSON.stringify({ v: 1, ssid, password, pair_token: token }),
      ).toString("base64"),
    };
  });
  app.get("/pair/status", async (r) => {
    const { shop } = await ownerShop(r),
      t = str((r.query as Row).pair_token, "pair token", 40),
      p = await get("pair_tokens", hash(t));
    if (!p || p.shop_id !== shop.id)
      fail(404, "pair_missing", "Create a new pairing code.");
    return {
      state: p!.device_id
        ? "connected"
        : Date.parse(p!.expires_at) <= now()
          ? "expired"
          : p!.state,
      ...(p!.device_id ? { device_id: p!.device_id } : {}),
    };
  });
  app.post("/pair/reading", async (r) => {
    const id = hash(str(body(r).pair_token, "pair token", 40));
    await db.runTransaction(async (tx) => {
      const ref = collection("pair_tokens").doc(id),
        p = await tx.get(ref);
      if (!p.exists || Date.parse(p.data()!.expires_at) <= now())
        fail(410, "pair_expired", "Create a new pairing code.");
      if (!p.data()!.device_id) tx.update(ref, { state: "reading" });
    });
    return { ok: true };
  });
  app.post("/pair/claim", async (r) => {
    const b = body(r),
      token = str(b.pair_token, "pair token", 40),
      serial = str(b.serial, "device serial", 128),
      newId = randomUUID();
    const d = await db.runTransaction(async (tx) => {
      const pr = collection("pair_tokens").doc(hash(token)),
        p = await tx.get(pr);
      if (!p.exists) fail(410, "pair_expired", "Create a new pairing code.");
      const row = p.data()!;
      const sr = collection("shops").doc(row.shop_id),
        shopSnap = await tx.get(sr);
      if (row.device_id) {
        const existing = await tx.get(collection("devices").doc(row.device_id));
        if (
          row.serial === serial &&
          existing.exists &&
          !existing.data()!.unpaired_at &&
          shopSnap.data()?.device_id === row.device_id
        )
          return { ...existing.data(), id: existing.id } as Row;
        fail(409, "pair_used", "This pairing code has already been used.");
      }
      if (Date.parse(row.expires_at) <= now())
        fail(410, "pair_expired", "Create a new pairing code.");
      const oldId = shopSnap.data()?.device_id || shopSnap.data()?.replacement_context?.previous_device_id;
      const old = oldId ? await tx.get(collection("devices").doc(oldId)) : null;
      const prior = old?.exists && old.data()!.shop_id === row.shop_id ? old.data()! : null;
      const d: Row = {
        id: newId,
        shop_id: row.shop_id,
        serial,
        model: typeof b.model === "string" ? b.model.slice(0, 100) : null,
        app_version:
          typeof b.app_version === "string" ? b.app_version.slice(0, 40) : null,
        status: "framing",
        status_since: iso(),
        created_at: iso(),
        last_seen_at: iso(),
        config_updated_at: iso(),
        pause_mode: "none",
        paused_until: null,
        framing_until: new Date(now() + 10 * 60000).toISOString(),
        reference_frame_path: prior?.reference_frame_path || null,
        reference_frame_revision: prior?.reference_frame_revision || null,
        unpaired_at: null,
        token_version: randomUUID(),
      };
      if (prior && old)
        tx.update(old.ref, { unpaired_at: iso(), config_updated_at: iso() });
      tx.create(collection("devices").doc(newId), d);
      tx.update(sr, { device_id: newId, replacement_context: null });
      tx.update(pr, {
        device_id: newId,
        serial,
        state: "connected",
        claimed_at: iso(),
      });
      return d;
    });
    const shop = (await get("shops", d.shop_id))!;
    const device_jwt = jwt.sign(
      {
        sub: d.id,
        shop_id: d.shop_id,
        role: "device",
        token_version: d.token_version,
      },
      deviceSecret,
      { algorithm: "HS256", expiresIn: "365d" },
    );
    return {
      device_jwt,
      device_id: d.id,
      shop: {
        id: shop.id,
        name: shop.name,
        type: shop.type,
        workstation: shop.workstation,
      },
      config: await config(d),
    };
  });
  app.get("/camera/status", async (r) =>
    cameraStatus((await ownerShop(r)).shop),
  );
  for (const action of ["pause", "resume", "framing/start"])
    app.post(`/camera/${action}`, async (r) => {
      const { shop } = await ownerShop(r),
        d = (await currentDevice(shop))!,
        b = body(r),
        patch: Row = { config_updated_at: iso() };
      if (action === "pause") {
        if (!["1h", "today", "indefinite"].includes(b.until))
          fail(400, "invalid_pause", "Choose when recording should resume.");
        Object.assign(patch, {
          pause_mode: b.until,
          paused_until:
            b.until === "indefinite"
              ? null
              : new Date(
                  b.until === "1h" ? now() + 3600000 : nextOpening(now(), shop),
                ).toISOString(),
          status: "paused",
          status_since: iso(),
        });
      } else if (action === "resume")
        Object.assign(patch, {
          pause_mode: "none",
          paused_until: null,
          status: "recording",
          status_since: iso(),
        });
      else patch.framing_until = new Date(now() + 10 * 60000).toISOString();
      await collection("devices").doc(d.id).update(patch);
      return action === "framing/start"
        ? { framing_until: patch.framing_until }
        : cameraStatus(shop);
    });
  app.get("/camera/preview", async (r, reply) => {
    const { shop } = await ownerShop(r),
      d = (await currentDevice(shop))!;
    if (!d.preview_path) return reply.code(204).send();
    return {
      url: readUrl(d.preview_path, "devices", d.id),
      captured_at: d.preview_at,
    };
  });
  app.post("/camera/reference-frame", async (r) => {
    const { shop } = await ownerShop(r),
      d = (await currentDevice(shop))!;
    if (!d.preview_path)
      fail(
        409,
        "preview_missing",
        "Wait for a camera preview, then try again.",
      );
    const revision = randomUUID(),
      path = `v2/thumbs/${shop.id}/device/${d.id}/reference-${revision}.jpg`;
    await bucket.file(d.preview_path).copy(bucket.file(path));
    await db.runTransaction(async (tx) => {
      const ref = collection("devices").doc(d.id),
        fresh = await tx.get(ref);
      if (fresh.data()?.unpaired_at)
        fail(409, "device_changed", "Pair your camera again.");
      tx.update(ref, {
        reference_frame_path: path,
        reference_frame_revision: revision,
        framing_until: null,
        config_updated_at: iso(),
      });
    });
    return { reference_frame_path: path, reference_frame_revision: revision };
  });
  app.post("/camera/unpair", async (r) => {
    const { shop } = await ownerShop(r);
    await db.runTransaction(async (tx) => {
      const sr = collection("shops").doc(shop.id),
        s = await tx.get(sr);
      const id = s.data()?.device_id;
      if (!id) return;
      const dr = collection("devices").doc(id);
      await tx.get(dr);
      tx.update(dr, { unpaired_at: iso(), config_updated_at: iso() });
      tx.update(sr, {
        device_id: null,
        replacement_context: {
          previous_device_id: id,
          replacing_since: iso(),
          return_to: "camera",
        },
      });
    });
    return { ok: true };
  });
  app.get("/device/config", async (r) => {
    let d = await device(r, true);
    const q = r.query as Row,
      wait = Math.min(25, Math.max(0, Number(q.wait) || 0)),
      until = Date.now() + wait * 1000;
    while (
      q.since === d.config_updated_at &&
      !d.unpaired_at &&
      Date.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      d = (await get("devices", d.id))!;
    }
    return config(d);
  });
  const statuses = [
    "waiting",
    "reading",
    "connecting",
    "framing",
    "recording",
    "paused",
    "nointernet",
    "reframe",
    "hot",
    "fault",
    "idle",
  ];
  app.post("/device/heartbeat", async (r) => {
    const d = await device(r),
      b = body(r),
      patch: Row = { last_seen_at: iso() };
    for (const k of ["battery", "storage_free_mb", "recording_seconds_today"])
      if (k in b) patch[k] = finite(b[k], k, 0, k === "battery" ? 100 : 1e12);
    if (
      b.thermal &&
      ["nominal", "fair", "serious", "critical"].includes(b.thermal)
    )
      patch.thermal = b.thermal;
    if (b.wifi && ["strong", "good", "weak", "none"].includes(b.wifi))
      patch.wifi = b.wifi;
    if (b.state && statuses.includes(b.state)) {
      patch.status = b.state;
      if (b.state !== d.status) patch.status_since = iso();
    }
    patch.status_code = typeof b.code === "string" ? b.code.slice(0, 60) : null;
    await collection("devices").doc(d.id).update(patch);
    return config({ ...d, ...patch });
  });
  app.post("/device/status", async (r) => {
    const d = await device(r),
      b = body(r);
    if (!statuses.includes(b.status))
      fail(400, "invalid_status", "Provide a valid camera status.");
    await collection("devices")
      .doc(d.id)
      .update({
        status: b.status,
        status_code: typeof b.code === "string" ? b.code.slice(0, 60) : null,
        status_since: iso(),
      });
    return { ok: true };
  });
  const parseSegment = (b: Row) => {
    const start_ts = timestamp(b.start_ts),
      end_ts = timestamp(b.end_ts),
      duration = Date.parse(end_ts) - Date.parse(start_ts);
    if (
      duration < 1 ||
      duration > product.segmentMinutes * 60000 + 10000 ||
      Date.parse(start_ts) > now() + 300000 ||
      Date.parse(end_ts) < now() - product.rawRetentionHours * 3600000
    )
      fail(
        400,
        "invalid_segment",
        "Provide a recent camera segment within the recording limit.",
      );
    return { start_ts, end_ts };
  };
  app.post("/device/segment/upload-url", async (r) => {
    const d = await device(r),
      times = parseSegment(body(r)),
      path = `v2/segments/${d.shop_id}/${d.id}/${Date.parse(times.start_ts)}.mp4`,
      id = hash(path);
    await db.runTransaction(async (tx) => {
      const ref = collection("uploads").doc(id),
        s = await tx.get(ref);
      if (s.exists) {
        if (s.data()!.end_ts !== times.end_ts)
          fail(
            409,
            "segment_conflict",
            "This segment already has different timing.",
          );
        return;
      }
      tx.create(ref, {
        id,
        path,
        shop_id: d.shop_id,
        device_id: d.id,
        ...times,
        created_at: iso(),
        state: "pending",
      });
    });
    return {
      path,
      upload_url: capability(
        {
          action: "upload",
          path,
          kind: "uploads",
          id,
          content_type: "video/mp4",
          max_bytes: 512 * 1024 * 1024,
        },
        3600,
      ),
      expires_at: new Date(now() + 3600000).toISOString(),
    };
  });
  app.post("/device/segment/complete", async (r) => {
    const d = await device(r),
      b = body(r),
      times = parseSegment(b),
      path = str(b.path, "segment path", 512),
      id = hash(path);
    const upload = await get("uploads", id);
    if (
      !upload ||
      upload.path !== path ||
      upload.device_id !== d.id ||
      upload.start_ts !== times.start_ts ||
      upload.end_ts !== times.end_ts
    )
      fail(
        403,
        "segment_scope",
        "Upload this segment using its camera upload URL.",
      );
    const bytes = finite(b.bytes, "file size", 1, 512 * 1024 * 1024),
      width = finite(b.width, "width", 1, 4096),
      height = finite(b.height, "height", 1, 4096),
      fps = finite(b.fps, "frame rate", 1, 120);
    let meta: any;
    try {
      [meta] = await bucket.file(path).getMetadata();
    } catch {
      fail(
        409,
        "upload_missing",
        "Finish uploading the segment, then try again.",
      );
    }
    if (Number(meta.size) !== bytes || meta.contentType !== "video/mp4")
      fail(
        409,
        "upload_mismatch",
        "The uploaded segment does not match its file information.",
      );
    await db.runTransaction(async (tx) => {
      const sr = collection("segments").doc(id),
        s = await tx.get(sr),
        dr = await tx.get(collection("devices").doc(d.id)),
        grant = await tx.get(collection("uploads").doc(id));
      if (grant.data()?.deletion_state)
        fail(409, "upload_expired", "This upload has expired.");
      if (dr.data()?.unpaired_at)
        fail(401, "device_unpaired", "Pair this camera again.");
      if (s.exists) {
        if (s.data()?.deletion_state)
          fail(409, "segment_deleted", "This footage has been deleted.");
        return;
      }
      tx.create(sr, {
        id,
        shop_id: d.shop_id,
        device_id: d.id,
        path,
        ...times,
        bytes,
        width,
        height,
        fps,
        created_at: iso(),
        deletion_state: null,
      });
      tx.create(collection("engine_jobs").doc(id), {
        id,
        segment_id: id,
        shop_id: d.shop_id,
        status: "queued",
        attempts: 0,
        created_at: iso(),
        lease_token: null,
        lease_expires_at: null,
      });
      tx.update(collection("uploads").doc(id), { state: "completed" });
    });
    return { segment_id: id, job_id: id };
  });
  const saveImage = async (r: FastifyRequest, kind: string) => {
    const d = await device(r);
    if (!r.headers["content-type"]?.startsWith("image/jpeg"))
      fail(415, "invalid_media", "Send a JPEG image.");
    if (
      kind === "preview" &&
      (!d.framing_until || Date.parse(d.framing_until) <= now())
    )
      fail(409, "framing_inactive", "Start camera framing first.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of r.body as any) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024)
        fail(413, "image_large", "Send a smaller preview image.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (
      bytes.length < 3 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255
    )
      fail(400, "invalid_jpeg", "Send a valid JPEG image.");
    const path = `v2/thumbs/${d.shop_id}/device/${d.id}/${kind}.jpg`;
    await bucket
      .file(path)
      .save(bytes, { resumable: false, contentType: "image/jpeg" });
    await collection("devices")
      .doc(d.id)
      .update(
        kind === "preview"
          ? { preview_path: path, preview_at: iso() }
          : { last_thumb_path: path, last_thumb_at: iso() },
      );
  };
  for (const kind of ["preview", "thumb"])
    app.post(`/device/${kind}`, async (r, reply) => {
      await saveImage(r, kind);
      return reply.code(204).send();
    });
  app.get("/clips", async (r) => {
    const { shop } = await ownerShop(r),
      date = (r.query as Row).date || localDate(now(), shop.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      fail(400, "invalid_date", "Choose a valid date.");
    const rows = (
      await collection("clips").where("shop_id", "==", shop.id).get()
    ).docs
      .map((s) => ({ ...s.data(), id: s.id }) as Row)
      .filter((c) => !c.deletion_state);
    const groups: Record<string, number> = {};
    for (const c of rows) {
      const d = localDate(Date.parse(c.created_at), shop.timezone);
      if (d < date) groups[d] = (groups[d] || 0) + 1;
    }
    return {
      date,
      clips: rows
        .filter(
          (c) => localDate(Date.parse(c.created_at), shop.timezone) === date,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(presentClip),
      older: Object.entries(groups)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, count]) => ({ date, count })),
    };
  });
  app.get("/clips/:id", async (r) => presentClip(await ownedClip(r)));
  app.patch("/clips/:id", async (r) => {
    const c = await ownedClip(r),
      caption = str(body(r).caption, "caption", 2200);
    await collection("clips").doc(c.id).update({ caption });
    return presentClip({ ...c, caption });
  });
  app.post("/clips/:id/event", async (r) => {
    const c = await ownedClip(r),
      b = body(r);
    if (!["open", "share", "skip", "report"].includes(b.type))
      fail(400, "invalid_event", "Provide a valid clip action.");
    const status = (
      {
        open: "viewed",
        share: "shared",
        skip: "skipped",
        report: "reported",
      } as Row
    )[b.type];
    const batch = db.batch();
    batch.create(collection("clip_events").doc(), {
      clip_id: c.id,
      shop_id: c.shop_id,
      type: b.type,
      reason: typeof b.reason === "string" ? b.reason.slice(0, 1000) : null,
      created_at: iso(),
    });
    batch.update(collection("clips").doc(c.id), { status });
    await batch.commit();
    return presentClip({ ...c, status });
  });
  app.delete("/clips/:id", async (r) => {
    const c = await ownedClip(r, true);
    if (c.deletion_state === "deleted") return { ok: true };
    await revokeSource(c.segment_id, c.id);
    try {
      await cleanupDeletion(c.segment_id);
    } catch {
      fail(
        503,
        "deletion_pending",
        "Your clip is hidden. File deletion will retry shortly.",
      );
    }
    return { ok: true };
  });
  app.post("/engine/jobs/claim", async (r) => {
    engine(r);
    const b = body(r),
      worker = str(b.worker, "worker name", 100),
      max = Math.min(4, Math.max(1, Number(b.max) || 1));
    const candidates = (
      await collection("engine_jobs")
        .where("status", "in", ["queued", "processing"])
        .get()
    ).docs.sort((a, b) =>
      a.data().created_at.localeCompare(b.data().created_at),
    );
    const jobs: Row[] = [];
    for (const candidate of candidates) {
      if (jobs.length >= max) break;
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(candidate.ref),
          j = snap.data()!;
        if (
          j.status !== "queued" &&
          !(
            j.status === "processing" && Date.parse(j.lease_expires_at) <= now()
          )
        )
          return null;
        const sr = collection("segments").doc(j.segment_id),
          s = await tx.get(sr);
        if (!s.exists || s.data()!.deletion_state) {
          tx.update(candidate.ref, { status: "cancelled" });
          return null;
        }
        if (j.attempts >= 3) {
          tx.update(candidate.ref, {
            status: "failed",
            error: "Worker lease expired after three attempts.",
          });
          return null;
        }
        const lease_token = randomBytes(32).toString("base64url"),
          lease_expires_at = new Date(now() + 120000).toISOString(),
          attempts = j.attempts + 1;
        tx.update(candidate.ref, {
          status: "processing",
          lease_token,
          lease_expires_at,
          attempts,
          worker,
          started_at: iso(),
        });
        return {
          id: snap.id,
          lease_token,
          lease_expires_at,
          attempts,
          segment: {
            ...s.data(),
            id: s.id,
            download_url: capability(
              {
                action: "read",
                path: s.data()!.path,
                kind: "segments",
                id: s.id,
              },
              3600,
            ),
          },
        };
      });
      if (result) jobs.push(result);
    }
    return { jobs };
  });
  app.post("/engine/jobs/:id/heartbeat", async (r) => {
    engine(r);
    const id = (r.params as Row).id;
    return db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref);
      requireLease(s.exists ? s.data()! : null, body(r).lease_token);
      const lease_expires_at = new Date(now() + 120000).toISOString();
      tx.update(ref, { lease_expires_at });
      return { ok: true, lease_expires_at };
    });
  });
  const outputPaths = (j: Row, index: number) => ({
    path: `v2/clips/${j.shop_id}/${j.id}/${index}.mp4`,
    thumb_path: `v2/thumbs/${j.shop_id}/clips/${j.id}/${index}.jpg`,
  });
  app.post("/engine/jobs/:id/upload-urls", async (r) => {
    engine(r);
    const j = requireLease(
        await get("engine_jobs", (r.params as Row).id),
        body(r).lease_token,
      ),
      index = finite(body(r).index, "clip index", 0, 19);
    if (!Number.isInteger(index))
      fail(400, "invalid_index", "Provide a whole clip index.");
    const paths = outputPaths(j, index);
    return {
      ...paths,
      video_upload_url: capability(
        {
          action: "upload",
          path: paths.path,
          kind: "engine_jobs",
          id: j.id,
          lease_token: j.lease_token,
          content_type: "video/mp4",
          max_bytes: 128 * 1024 * 1024,
        },
        120,
      ),
      thumb_upload_url: capability(
        {
          action: "upload",
          path: paths.thumb_path,
          kind: "engine_jobs",
          id: j.id,
          lease_token: j.lease_token,
          content_type: "image/jpeg",
          max_bytes: 5 * 1024 * 1024,
        },
        120,
      ),
    };
  });
  app.post("/engine/jobs/:id/done", async (r) => {
    engine(r);
    const id = (r.params as Row).id,
      b = body(r),
      original = await get("engine_jobs", id);
    if (!original) fail(404, "job_missing", "This job was not found.");
    if (!Array.isArray(b.clips) || b.clips.length > 20)
      fail(400, "invalid_clips", "Provide up to twenty clips.");
    const seen = new Set<string>();
    const clips: Row[] = b.clips.map((c: Row) => {
      const index = Array.from({ length: 20 }, (_, i) => i).find(
        (i) => outputPaths(original!, i).path === c.path,
      );
      if (
        index === undefined ||
        c.thumb_path !== outputPaths(original!, index).thumb_path ||
        seen.has(c.path)
      )
        fail(400, "clip_scope", "Use the output paths provided for this job.");
      seen.add(c.path);
      const source_start_s = finite(c.source_start_s, "source start", 0, 3600),
        source_end_s = finite(
          c.source_end_s,
          "source end",
          source_start_s,
          3600,
        );
      return {
        path: c.path,
        thumb_path: c.thumb_path,
        duration_s: finite(c.duration_s, "clip duration", 0.01, 300),
        caption: str(c.caption, "caption", 2200),
        source_start_s,
        source_end_s,
      };
    });
    const fingerprint = hash(JSON.stringify(clips));
    if (original!.status !== "done") {
      requireLease(original, b.lease_token);
      for (const c of clips) {
        for (const [path, contentType] of [
          [c.path, "video/mp4"],
          [c.thumb_path, "image/jpeg"],
        ]) {
          let meta: any;
          try {
            [meta] = await bucket.file(path).getMetadata();
          } catch {
            fail(
              409,
              "output_missing",
              "Finish uploading all clip files first.",
            );
          }
          if (Number(meta.size) <= 0 || meta.contentType !== contentType)
            fail(409, "output_invalid", "Upload valid clip files first.");
        }
      }
    }
    return db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref),
        j = s.data()!;
      const segmentSnap = await tx.get(
        collection("segments").doc(j.segment_id),
      );
      if (!segmentSnap.exists || segmentSnap.data()!.deletion_state)
        fail(
          409,
          "segment_deleted",
          "This source footage is no longer available.",
        );
      if (j.status === "done") {
        if (
          !equal(b.lease_token, j.completed_lease_token) ||
          j.fingerprint !== fingerprint
        )
          fail(
            409,
            "completion_conflict",
            "This job has already completed with different output.",
          );
        return { clip_ids: j.clip_ids };
      }
      requireLease(j, b.lease_token);
      const sourceDuration =
        (Date.parse(segmentSnap.data()!.end_ts) -
          Date.parse(segmentSnap.data()!.start_ts)) /
        1000;
      const clip_ids = clips.map((c) => hash(c.path));
      clips.forEach((c, i) => {
        if (c.source_end_s > sourceDuration + 0.1)
          fail(
            400,
            "source_range",
            "Clip timing must stay within the source segment.",
          );
        tx.create(collection("clips").doc(clip_ids[i]), {
          ...c,
          id: clip_ids[i],
          shop_id: j.shop_id,
          segment_id: j.segment_id,
          job_id: id,
          status: "new",
          created_at: iso(),
          delivered_at: null,
          deletion_state: null,
        });
      });
      tx.update(ref, {
        status: "done",
        completed_at: iso(),
        completed_lease_token: j.lease_token,
        fingerprint,
        clip_ids,
      });
      return { clip_ids };
    });
  });
  app.post("/engine/jobs/:id/failed", async (r) => {
    engine(r);
    const id = (r.params as Row).id,
      b = body(r);
    await db.runTransaction(async (tx) => {
      const ref = collection("engine_jobs").doc(id),
        s = await tx.get(ref),
        j = requireLease(s.exists ? s.data()! : null, b.lease_token);
      tx.update(ref, {
        status: j.attempts >= 3 ? "failed" : "queued",
        error: str(b.error, "error", 2000),
        lease_expires_at: null,
        lease_token: null,
      });
    });
    return { ok: true };
  });
  const verifyCapability = async (r: FastifyRequest, action: string) => {
    const raw = (r.params as Row).token as string;
    if (raw.length > 4096)
      fail(403, "invalid_media_token", "This media link is invalid.");
    const [payload, signature, ...extra] = raw.split(".");
    if (
      extra.length ||
      !equal(
        signature,
        createHmac("sha256", mediaSecret).update(payload).digest("base64url"),
      )
    )
      fail(403, "invalid_media_token", "This media link is invalid.");
    let c: Row;
    try {
      c = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      return fail(403, "invalid_media_token", "This media link is invalid.");
    }
    if (
      c.action !== action ||
      typeof c.exp !== "number" ||
      c.exp <= now() ||
      !c.path?.startsWith("v2/")
    )
      fail(403, "media_expired", "Refresh this media link and try again.");
    const row = (await get(c.kind, c.id))!;
    if (!row || row.deletion_state)
      fail(404, "media_missing", "This media is no longer available.");
    if (c.kind === "engine_jobs") {
      requireLease(row, c.lease_token);
      if (
        action !== "upload" ||
        !Array.from({ length: 20 }, (_, i) =>
          Object.values(outputPaths(row, i)),
        )
          .flat()
          .includes(c.path)
      )
        fail(403, "media_scope", "This media link is invalid.");
    } else if (c.kind === "uploads") {
      if (row.path !== c.path)
        fail(403, "media_scope", "This media link is invalid.");
      const d = await get("devices", row.device_id);
      if (!d || d.unpaired_at)
        fail(401, "device_unpaired", "Pair this camera again.");
      if (row.state !== "pending" && action === "upload")
        fail(409, "upload_finalized", "This upload is already complete.");
    } else if (c.kind === "devices") {
      if (
        row.unpaired_at ||
        ![
          row.preview_path,
          row.last_thumb_path,
          row.reference_frame_path,
        ].includes(c.path)
      )
        fail(404, "media_missing", "This image is no longer available.");
    } else if (![row.path, row.thumb_path].includes(c.path))
      fail(403, "media_scope", "This media link is invalid.");
    return c;
  };
  app.put("/media/:token", async (r, reply) => {
    const c = await verifyCapability(r, "upload");
    if (r.headers["content-type"]?.split(";")[0] !== c.content_type)
      fail(415, "invalid_media", "Use the expected media content type.");
    let size = 0;
    const limiter = new Transform({
      transform(chunk, enc, cb) {
        size += chunk.length;
        cb(
          size > c.max_bytes
            ? new ApiError(413, "media_large", "This media file is too large.")
            : null,
          chunk,
        );
      },
    });
    const file = bucket.file(c.path);
    const [exists] = await file.exists();
    if (exists) {
      for await (const chunk of r.body as any) {
        size += chunk.length;
        if (size > c.max_bytes)
          fail(413, "media_large", "This media file is too large.");
      }
      return reply.code(204).send();
    }
    // Delete only the generation this request created. A failed concurrent PUT
    // must never remove a different request's successfully uploaded object.
    const deleteOwnGeneration = async () => {
      const generation = file.metadata.generation;
      if (generation)
        await bucket
          .file(c.path, { generation })
          .delete({ ignoreNotFound: true });
    };
    try {
      await pipeline(
        r.body as any,
        limiter,
        file.createWriteStream({
          resumable: false,
          metadata: { contentType: c.content_type },
          preconditionOpts: { ifGenerationMatch: 0 },
        }),
      );
    } catch (e: any) {
      if (e.code !== 412) {
        await deleteOwnGeneration().catch(() => {});
        throw e;
      }
    }
    if (!size) {
      await deleteOwnGeneration();
      fail(400, "media_empty", "Upload a nonempty media file.");
    }
    try {
      await verifyCapability(r, "upload");
    } catch (e) {
      await deleteOwnGeneration();
      throw e;
    }
    return reply.code(204).send();
  });
  app.get("/media/:token", async (r, reply) => {
    const c = await verifyCapability(r, "read"),
      file = bucket.file(c.path);
    let metadata: any;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      fail(404, "media_missing", "This media is no longer available.");
    }
    const size = Number(metadata.size);
    reply
      .header("accept-ranges", "bytes")
      .header("cache-control", "private, no-store")
      .header(
        "content-type",
        metadata.contentType || "application/octet-stream",
      );
    const range = r.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return reply
          .code(416)
          .header("content-range", `bytes */${size}`)
          .send();
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])),
        end = m[1]
          ? m[2]
            ? Math.min(Number(m[2]), size - 1)
            : size - 1
          : size - 1;
      if (start >= size || start > end)
        return reply
          .code(416)
          .header("content-range", `bytes */${size}`)
          .send();
      return reply
        .code(206)
        .header("content-range", `bytes ${start}-${end}/${size}`)
        .header("content-length", end - start + 1)
        .send(file.createReadStream({ start, end }));
    }
    return reply.header("content-length", size).send(file.createReadStream());
  });
  const smsMode = options.smsMode || process.env.SMS_MODE || "disabled";
  const sendSms =
    options.sendSms ||
    (async (phone: string, text: string) => {
      if (
        !process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_FROM_PHONE
      )
        throw Error("SMS provider is not configured");
      const result = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: phone,
            From: process.env.TWILIO_FROM_PHONE,
            Body: text,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!result.ok) throw Error(`SMS provider returned ${result.status}`);
    });
  app.post("/internal/cron/tick", async (r) => {
    if (!equal(r.headers["x-cron-secret"], cronSecret))
      fail(401, "unauthorized", "Cron authentication failed.");
    let deleted = 0,
      delivered = 0,
      sms_failed = 0;
    const uploads = await collection("uploads").get();
    for (const upload of uploads.docs) {
      const expired = await db.runTransaction(async (tx) => {
        const snap = await tx.get(upload.ref),
          row = snap.data()!;
        if (
          row.state === "completed" ||
          row.deletion_state === "deleted" ||
          Date.parse(row.created_at) >=
            now() - product.rawRetentionHours * 3600000
        )
          return false;
        tx.update(upload.ref, { state: "expired", deletion_state: "pending" });
        return true;
      });
      if (expired) {
        try {
          await deleteObject(upload.data().path);
          await upload.ref.update({
            deletion_state: "deleted",
            deleted_at: iso(),
          });
          deleted++;
        } catch {
          /* Preserve the tombstone and retry the storage deletion. */
        }
      }
    }
    const processing = await collection("engine_jobs")
      .where("status", "==", "processing")
      .get();
    for (const candidate of processing.docs) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(candidate.ref),
          j = snap.data()!;
        if (
          j.status === "processing" &&
          Date.parse(j.lease_expires_at) <= now()
        ) {
          tx.update(candidate.ref, {
            status: j.attempts >= 3 ? "failed" : "queued",
            lease_token: null,
            lease_expires_at: null,
            error: "Worker lease expired.",
          });
        }
      });
    }
    const segments = await collection("segments").get();
    for (const s of segments.docs) {
      const row = s.data();
      if (row.deletion_state === "deleted") continue;
      if (
        row.deletion_state === "pending" ||
        Date.parse(row.end_ts) < now() - product.rawRetentionHours * 3600000
      ) {
        await revokeSource(s.id);
        try {
          await cleanupDeletion(s.id);
          deleted++;
        } catch {
          /* Pending state remains retryable. */
        }
      }
    }
    const shops = await collection("shops").get();
    for (const s of shops.docs) {
      const shop = { ...s.data(), id: s.id } as Row;
      if (smsMode === "disabled" || !shop.phone) continue;
      const p = localParts(now(), shop.timezone);
      if (Number(p.hour) < shop.delivery_hour) continue;
      const date = localDate(now(), shop.timezone),
        noticeId = `${s.id}_${date}`,
        noticeRef = collection("notifications").doc(noticeId);
      const clips = (
        await collection("clips").where("shop_id", "==", s.id).get()
      ).docs.filter((c) => !c.data().delivered_at && !c.data().deletion_state);
      if (!clips.length) continue;
      const attempt = randomUUID();
      const acquired = await db.runTransaction(async (tx) => {
        const existing = await tx.get(noticeRef),
          n = existing.data();
        if (
          n &&
          (n.state === "sent" ||
            n.state === "dry_run" ||
            (n.state === "sending" && Date.parse(n.lease_expires_at) > now()))
        )
          return false;
        tx.set(noticeRef, {
          shop_id: s.id,
          state: "sending",
          attempt,
          lease_expires_at: new Date(now() + 60000).toISOString(),
          clip_ids: clips.map((c) => c.id),
          created_at: iso(),
        });
        return true;
      });
      if (!acquired) continue;
      try {
        if (smsMode !== "dry-run")
          await sendSms(
            shop.phone,
            `${product.name}: Your clips are ready. ${product.ownerAppUrl}/#/home`,
          );
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(noticeRef);
          if (snap.data()?.attempt !== attempt) return;
          const rows = await Promise.all(clips.map((c) => tx.get(c.ref)));
          tx.update(noticeRef, {
            state: smsMode === "dry-run" ? "dry_run" : "sent",
            sent_at: smsMode === "dry-run" ? null : iso(),
          });
          if (smsMode !== "dry-run")
            for (const c of rows)
              if (!c.data()?.deletion_state)
                tx.update(c.ref, { delivered_at: iso() });
        });
        if (smsMode !== "dry-run") delivered++;
      } catch (e) {
        sms_failed++;
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(noticeRef);
          if (snap.data()?.attempt === attempt)
            tx.update(noticeRef, {
              state: "failed",
              error: "SMS provider did not acknowledge delivery.",
              failed_at: iso(),
            });
        });
      }
    }
    const pairs = await collection("pair_tokens").get();
    const expired = pairs.docs.filter(
      (p) => !p.data().device_id && Date.parse(p.data().expires_at) <= now(),
    );
    for (const p of expired) await p.ref.delete();
    return { ok: true, deleted, delivered, sms_failed, sms_mode: smsMode };
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (r, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );
  app.post("/sms/inbound", async (r, reply) => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!token) fail(503, "sms_unconfigured", "SMS is not configured.");
    const b = body(r),
      url = process.env.TWILIO_INBOUND_URL || `${base}/sms/inbound`;
    let input = url;
    for (const k of Object.keys(b).sort()) input += k + b[k];
    if (
      !equal(
        r.headers["x-twilio-signature"],
        createHmac("sha1", token!).update(input).digest("base64"),
      )
    )
      fail(403, "invalid_signature", "Webhook authentication failed.");
    return reply
      .type("text/xml")
      .send(
        `<Response><Message>${product.name}: ${product.startUrl}</Message></Response>`,
      );
  });
  return app;
}
