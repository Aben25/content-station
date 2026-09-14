import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildApp } from "../src/app.js";

const projectId = process.env.GCLOUD_PROJECT || "demo-contentstation-v2";
const key = "test-engine-key-at-least-32-characters";
let app: any, admin: any, db: any, bucket: any;
let clock = Date.now();
let failDelete = false;
let failSms = false;
let smsCount = 0;
const testShopIds: string[] = [];
const owner = async () => {
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `${crypto.randomUUID()}@example.test`,
        password: "emulator-password",
        returnSecureToken: true,
      }),
    },
  );
  const b: any = await r.json();
  assert.ok(b.idToken);
  return { authorization: `Bearer ${b.idToken}` };
};
const req = async (
  method: string,
  url: string,
  headers: any = {},
  payload?: any,
) => app.inject({ method, url, headers, payload });
const setup = async () => {
  const h = await owner();
  const shop = (
    await req("POST", "/shops", h, {
      name: "Test shop",
      type: "barber",
      timezone: "America/Los_Angeles",
    })
  ).json().shop;
  assert.ok(shop?.id);
  testShopIds.push(shop.id);
  const pair = (
    await req("POST", "/pair/token", h, { ssid: "Wifi", password: "secret" })
  ).json();
  const serial = crypto.randomUUID();
  const claim = (
    await req(
      "POST",
      "/pair/claim",
      {},
      { pair_token: pair.pair_token, serial, model: "test", app_version: "1" },
    )
  ).json();
  assert.ok(claim.device_jwt);
  return {
    h,
    shop,
    pair,
    claim,
    serial,
    dh: { authorization: `Bearer ${claim.device_jwt}` },
  };
};
const segment = async (s: any) => {
  const start_ts = new Date(clock - 10000).toISOString(),
    end_ts = new Date(clock).toISOString();
  const grant = (
    await req("POST", "/device/segment/upload-url", s.dh, { start_ts, end_ts })
  ).json();
  assert.ok(grant.upload_url);
  const uploaded = await req(
    "PUT",
    new URL(grant.upload_url).pathname + new URL(grant.upload_url).search,
    { "content-type": "video/mp4" },
    Buffer.from("test MP4"),
  );
  assert.equal(uploaded.statusCode, 204);
  const done = await req("POST", "/device/segment/complete", s.dh, {
    path: grant.path,
    start_ts,
    end_ts,
    bytes: 8,
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.equal(done.statusCode, 200, done.body);
  return done.json();
};
const claim = async () => {
  const r = await req(
    "POST",
    "/engine/jobs/claim",
    { "x-engine-key": key },
    { worker: "test", max: 1 },
  );
  assert.equal(r.statusCode, 200, r.body);
  return r.json().jobs[0];
};
const outputs = async (j: any) => {
  const r = await req(
    "POST",
    `/engine/jobs/${j.id}/upload-urls`,
    { "x-engine-key": key },
    { lease_token: j.lease_token, index: 0 },
  );
  assert.equal(r.statusCode, 200, r.body);
  const g = r.json();
  for (const [u, t] of [
    [g.video_upload_url, "video/mp4"],
    [g.thumb_upload_url, "image/jpeg"],
  ]) {
    const x = new URL(u);
    assert.equal(
      (
        await req(
          "PUT",
          x.pathname + x.search,
          { "content-type": t },
          Buffer.from("artifact"),
        )
      ).statusCode,
      204,
    );
  }
  return [
    {
      path: g.path,
      thumb_path: g.thumb_path,
      duration_s: 5,
      caption: "Test clip",
      source_start_s: 0,
      source_end_s: 5,
    },
  ];
};
before(async () => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    "Run against real Firebase emulators",
  );
  admin = initializeApp(
    { projectId, storageBucket: `${projectId}.appspot.com` },
    `test-${crypto.randomUUID()}`,
  );
  db = getFirestore(admin, "backend-tests");
  bucket = getStorage(admin).bucket();
  app = await buildApp({
    admin,
    databaseId: "backend-tests",
    now: () => clock,
    engineKey: key,
    cronSecret: key,
    deviceSecret: key,
    mediaSecret: key,
    apiBase: "http://127.0.0.1:4310",
    smsMode: "live",
    sendSms: async () => {
      smsCount++;
      if (failSms) throw Error("injected SMS failure");
    },
    deleteObject: async (path: string) => {
      if (failDelete) throw Error("injected delete failure");
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  });
});
after(async () => {
  for (const shopId of testShopIds) {
    const jobs = await db
      .collection("cs2_engine_jobs")
      .where("shop_id", "==", shopId)
      .get();
    for (const j of jobs.docs)
      if (["queued", "processing"].includes(j.data().status))
        await j.ref.update({ status: "cancelled" });
  }
  await app?.close();
  await deleteApp(admin);
});
test("owner identity isolation and atomic single-use pair token with same-device retry", async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(
    (await req("GET", `/pair/status?pair_token=${a.pair.pair_token}`, b.h))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await req(
        "POST",
        "/pair/claim",
        {},
        { pair_token: a.pair.pair_token, serial: crypto.randomUUID() },
      )
    ).statusCode,
    409,
  );
  const retry = await req(
    "POST",
    "/pair/claim",
    {},
    { pair_token: a.pair.pair_token, serial: a.serial },
  );
  assert.equal(retry.json().device_id, a.claim.device_id);
  await req("POST", "/camera/unpair", a.h, {});
  assert.equal(
    (await req("GET", "/device/config", a.dh)).json().unpaired,
    true,
  );
  assert.equal(
    (
      await req(
        "POST",
        "/pair/claim",
        {},
        { pair_token: a.pair.pair_token, serial: a.serial },
      )
    ).statusCode,
    409,
  );
});
test("verified media creates deterministic job; done retry is idempotent and shop media is isolated", async () => {
  const s = await setup();
  const item = await segment(s);
  const j = await claim();
  assert.equal(j.id, item.job_id);
  const clips = await outputs(j);
  const h = { "x-engine-key": key };
  const done = await req("POST", `/engine/jobs/${j.id}/done`, h, {
    lease_token: j.lease_token,
    clips,
  });
  assert.equal(done.statusCode, 200, done.body);
  const again = await req("POST", `/engine/jobs/${j.id}/done`, h, {
    lease_token: j.lease_token,
    clips,
  });
  assert.deepEqual(again.json(), done.json());
  const id = done.json().clip_ids[0];
  const other = await setup();
  assert.equal((await req("GET", `/clips/${id}`, other.h)).statusCode, 404);
  assert.equal((await req("GET", `/clips/${id}`, s.h)).statusCode, 200);
});
test("expired lease can be replaced and stale lease cannot complete or fail", async () => {
  const s = await setup();
  await segment(s);
  const j = await claim();
  clock += 121000;
  const next = await claim();
  assert.equal(next.id, j.id);
  assert.notEqual(next.lease_token, j.lease_token);
  for (const action of ["done", "failed", "heartbeat"])
    assert.equal(
      (
        await req(
          "POST",
          `/engine/jobs/${j.id}/${action}`,
          { "x-engine-key": key },
          { lease_token: j.lease_token, clips: [], error: "old" },
        )
      ).statusCode,
      409,
    );
  assert.equal(
    (
      await req(
        "POST",
        `/engine/jobs/${j.id}/failed`,
        { "x-engine-key": key },
        { lease_token: next.lease_token, error: "retry" },
      )
    ).statusCode,
    200,
  );
  const third = await claim();
  await req(
    "POST",
    `/engine/jobs/${j.id}/failed`,
    { "x-engine-key": key },
    { lease_token: third.lease_token, error: "exhausted" },
  );
  assert.equal(
    (await db.collection("cs2_engine_jobs").doc(j.id).get()).data().status,
    "failed",
  );
});
test("deletion failure hides clips and cancels source jobs before retrying storage deletion", async () => {
  const s = await setup();
  await segment(s);
  const j = await claim();
  const clips = await outputs(j);
  const done = await req(
    "POST",
    `/engine/jobs/${j.id}/done`,
    { "x-engine-key": key },
    { lease_token: j.lease_token, clips },
  );
  const id = done.json().clip_ids[0];
  failDelete = true;
  const del = await req("DELETE", `/clips/${id}`, s.h);
  assert.equal(del.statusCode, 503);
  assert.equal((await req("GET", `/clips/${id}`, s.h)).statusCode, 404);
  assert.equal(
    (
      await req(
        "POST",
        `/engine/jobs/${j.id}/done`,
        { "x-engine-key": key },
        { lease_token: j.lease_token, clips },
      )
    ).statusCode,
    409,
  );
  failDelete = false;
  assert.equal((await req("DELETE", `/clips/${id}`, s.h)).statusCode, 200);
});
test("SMS failure is not acknowledged and can retry", async () => {
  const s = await setup();
  await db
    .collection("cs2_shops")
    .doc(s.shop.id)
    .update({ phone: "+15555550123", delivery_hour: 0 });
  await segment(s);
  const j = await claim();
  const clips = await outputs(j);
  const id = (
    await req(
      "POST",
      `/engine/jobs/${j.id}/done`,
      { "x-engine-key": key },
      { lease_token: j.lease_token, clips },
    )
  ).json().clip_ids[0];
  failSms = true;
  const beforeCount = smsCount;
  await req("POST", "/internal/cron/tick", { "x-cron-secret": key }, {});
  assert.ok(smsCount > beforeCount);
  assert.equal(
    (await db.collection("cs2_clips").doc(id).get()).data().delivered_at,
    null,
  );
  failSms = false;
  await req("POST", "/internal/cron/tick", { "x-cron-secret": key }, {});
  assert.ok(
    (await db.collection("cs2_clips").doc(id).get()).data().delivered_at,
  );
});

test("camera reference revision stays stable across config polls and changes only on save", async () => {
  const s = await setup();
  assert.equal((await req("GET", "/me", s.h)).json().onboarding_step, "frame");
  const image = Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]);
  assert.equal(
    (
      await req(
        "POST",
        "/device/preview",
        { ...s.dh, "content-type": "image/jpeg" },
        image,
      )
    ).statusCode,
    204,
  );
  const saved = await req("POST", "/camera/reference-frame", s.h, {});
  assert.equal(saved.statusCode, 200, saved.body);
  const revision = saved.json().reference_frame_revision;
  const a = (await req("GET", "/device/config", s.dh)).json();
  clock += 1000;
  const b = (await req("GET", "/device/config", s.dh)).json();
  assert.equal(a.reference_frame_revision, revision);
  assert.equal(b.reference_frame_revision, revision);
  assert.notEqual(a.reference_frame_url, b.reference_frame_url);
  assert.equal(
    (await req("GET", new URL(b.reference_frame_url).pathname)).statusCode,
    200,
  );
  await req("POST", "/camera/pause", s.h, { until: "indefinite" });
  assert.equal(
    (await req("GET", "/device/config", s.dh)).json().pause_mode,
    "indefinite",
  );
  await req("POST", "/camera/resume", s.h, {});
  assert.equal(
    (await req("GET", "/device/config", s.dh)).json().pause_mode,
    "none",
  );
  await req("POST", "/camera/framing/start", s.h, {});
  await req(
    "POST",
    "/device/preview",
    { ...s.dh, "content-type": "image/jpeg" },
    image,
  );
  const next = (await req("POST", "/camera/reference-frame", s.h, {})).json();
  assert.notEqual(next.reference_frame_revision, revision);
  assert.equal(
    (await req("GET", new URL(b.reference_frame_url).pathname)).statusCode,
    404,
  );
});

test("missing uploads and arbitrary other-shop paths cannot complete a segment", async () => {
  const s = await setup();
  const other = await setup();
  const start_ts = new Date(clock - 10000).toISOString(),
    end_ts = new Date(clock).toISOString();
  const grant = (
    await req("POST", "/device/segment/upload-url", s.dh, { start_ts, end_ts })
  ).json();
  const completion = {
    path: grant.path,
    start_ts,
    end_ts,
    bytes: 8,
    width: 1080,
    height: 1920,
    fps: 30,
  };
  assert.equal(
    (await req("POST", "/device/segment/complete", s.dh, completion))
      .statusCode,
    409,
  );
  assert.equal(
    (await req("POST", "/device/segment/complete", other.dh, completion))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await req(
        "PUT",
        new URL(grant.upload_url).pathname,
        { "content-type": "image/jpeg" },
        Buffer.from("bad"),
      )
    ).statusCode,
    415,
  );
  assert.equal(
    (await req("GET", new URL(grant.upload_url).pathname)).statusCode,
    403,
  );
  const token = new URL(grant.upload_url).pathname;
  assert.equal(
    (
      await req(
        "PUT",
        token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"),
        { "content-type": "video/mp4" },
        Buffer.from("bad"),
      )
    ).statusCode,
    403,
  );
});

test("private video supports range playback and deleted clip capabilities stop working", async () => {
  const s = await setup();
  await segment(s);
  const j = await claim();
  const clips = await outputs(j);
  const done = await req(
    "POST",
    `/engine/jobs/${j.id}/done`,
    { "x-engine-key": key },
    { lease_token: j.lease_token, clips },
  );
  const c = (await req("GET", `/clips/${done.json().clip_ids[0]}`, s.h)).json();
  const path = new URL(c.video_url).pathname;
  const range = await req("GET", path, { range: "bytes=1-3" });
  assert.equal(range.statusCode, 206);
  assert.equal(range.body, "rti");
  assert.equal(range.headers["content-range"], "bytes 1-3/8");
  assert.equal(
    (await req("GET", path, { range: "bytes=100-200" })).statusCode,
    416,
  );
  await req("DELETE", `/clips/${c.id}`, s.h);
  assert.equal((await req("GET", path)).statusCode, 404);
});

test("cron moves expired processing jobs to a retryable queue and stops exhausted leases", async () => {
  const s = await setup();
  await segment(s);
  const j = await claim();
  clock += 121000;
  await req("POST", "/internal/cron/tick", { "x-cron-secret": key }, {});
  assert.equal(
    (await db.collection("cs2_engine_jobs").doc(j.id).get()).data().status,
    "queued",
  );
  await db
    .collection("cs2_engine_jobs")
    .doc(j.id)
    .update({
      status: "processing",
      attempts: 3,
      lease_expires_at: new Date(clock - 1).toISOString(),
    });
  await req("POST", "/internal/cron/tick", { "x-cron-secret": key }, {});
  assert.equal(
    (await db.collection("cs2_engine_jobs").doc(j.id).get()).data().status,
    "failed",
  );
});

for (const replacement of [false, true]) {
  test(`saved framing survives ${replacement ? 'replacement' : 'Wi-Fi rescan'} with a new device capability`, async () => {
    const s = await setup();
    const image = Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]);
    await req('POST', '/device/preview', { ...s.dh, 'content-type': 'image/jpeg' }, image);
    const saved = (await req('POST', '/camera/reference-frame', s.h, {})).json();
    if (replacement) assert.equal((await req('POST', '/camera/unpair', s.h, {})).statusCode, 200);
    const token = (await req('POST', '/pair/token', s.h, { ssid: 'Wifi', password: 'secret' })).json().pair_token;
    const paired = (await req('POST', '/pair/claim', {}, { pair_token: token, serial: crypto.randomUUID() })).json();
    assert.notEqual(paired.device_id, s.claim.device_id);
    const config = (await req('GET', '/device/config', { authorization: `Bearer ${paired.device_jwt}` })).json();
    assert.equal(config.reference_frame_revision, saved.reference_frame_revision);
    const media = await req('GET', new URL(config.reference_frame_url).pathname);
    assert.equal(media.statusCode, 200, media.body);
    assert.deepEqual(media.rawPayload, image);
    assert.equal((await db.collection('cs2_shops').doc(s.shop.id).get()).data().replacement_context, null);
  });
}

test('replacement context cannot inherit or revoke another shop device', async () => {
  const a = await setup(), b = await setup();
  const image = Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]);
  await req('POST', '/device/preview', { ...b.dh, 'content-type': 'image/jpeg' }, image);
  await req('POST', '/camera/reference-frame', b.h, {});
  await req('POST', '/camera/unpair', a.h, {});
  await db.collection('cs2_shops').doc(a.shop.id).update({ replacement_context: { previous_device_id: b.claim.device_id } });
  const token = (await req('POST', '/pair/token', a.h, { ssid: 'Wifi', password: 'secret' })).json().pair_token;
  const paired = (await req('POST', '/pair/claim', {}, { pair_token: token, serial: crypto.randomUUID() })).json();
  const config = (await req('GET', '/device/config', { authorization: `Bearer ${paired.device_jwt}` })).json();
  assert.equal(config.reference_frame_url, null);
  assert.equal(config.reference_frame_revision, null);
  assert.equal((await db.collection('cs2_devices').doc(b.claim.device_id).get()).data().unpaired_at, null);
});
