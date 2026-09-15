// Publishing routes against the Firebase emulators and an in-process fake Postiz
// (test/fake-postiz.ts). The fake is a mock of the Postiz contract; platform
// acceptance is not covered here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildApp } from "../src/app.js";
import { FakePostiz } from "./fake-postiz.js";

const projectId = process.env.GCLOUD_PROJECT || "demo-contentstation-v2";
const key = "test-publishing-secret-at-least-32-characters";
const jwtSecret = "postiz-instance-secret-for-tests-0123456789";
let app: any, admin: any, db: any, bucket: any, fake: FakePostiz;
let clock = Date.now();
const owner = async () => {
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${crypto.randomUUID()}@example.test`, password: "emulator-password", returnSecureToken: true }) },
  );
  const b: any = await r.json();
  return { authorization: `Bearer ${b.idToken}` };
};
const req = async (method: string, url: string, headers: any = {}, payload?: any) => app.inject({ method, url, headers, payload });
const shop = async () => {
  const h = await owner();
  const s = (await req("POST", "/shops", h, { name: "Publishing shop", type: "detailing", timezone: "America/Los_Angeles" })).json().shop;
  return { h, shop: s };
};
// Clip records are written directly: the render pipeline is covered by api.test.ts.
const clip = async (shopId: string, caption = "Full detail, start to finish.") => {
  const id = crypto.randomUUID().replace(/-/g, "");
  const path = `v2/clips/${shopId}/${id}/0.mp4`, thumb_path = `v2/thumbs/${shopId}/clips/${id}/0.jpg`;
  await bucket.file(path).save(Buffer.from("test MP4 bytes"), { resumable: false, contentType: "video/mp4" });
  await db.collection("cs2_clips").doc(id).set({ id, shop_id: shopId, segment_id: `seg-${id}`, job_id: `job-${id}`, path, thumb_path, caption, duration_s: 12, source_start_s: 0, source_end_s: 12, status: "new", created_at: new Date(clock).toISOString(), delivered_at: null, deletion_state: null });
  return id;
};
const connect = async (h: any, provider = "facebook") => {
  const r = await req("POST", "/publishing/accounts/connect", h, { provider });
  assert.equal(r.statusCode, 200, r.body);
  const state = new URL(r.json().url).searchParams.get("state")!;
  await fake.completeConnection(state);
  const accounts = (await req("GET", "/publishing/accounts", h)).json().accounts;
  return accounts[accounts.length - 1];
};
const publish = (h: any, clipId: string, body: any) => req("POST", `/clips/${clipId}/publish`, h, { idempotency_key: crypto.randomUUID(), ...body });

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Run against real Firebase emulators");
  admin = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, `publishing-${crypto.randomUUID()}`);
  db = getFirestore(admin, "publishing-tests");
  bucket = getStorage(admin).bucket();
  fake = new FakePostiz(jwtSecret);
  await fake.start();
  app = await buildApp({
    admin, databaseId: "publishing-tests", now: () => clock,
    engineKey: key, cronSecret: key, deviceSecret: key, mediaSecret: key,
    apiBase: "http://127.0.0.1:4310", ownerAppUrl: "http://127.0.0.1:4311",
    postiz: { url: fake.url, jwtSecret, timeoutMs: 150 }, publishingSecret: key,
  });
  // Webhooks from the fake target the real listener rather than app.inject.
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  (app as any).__base = `http://127.0.0.1:${address.port}`;
  await app.close();
  app = await buildApp({
    admin, databaseId: "publishing-tests", now: () => clock,
    engineKey: key, cronSecret: key, deviceSecret: key, mediaSecret: key,
    apiBase: (app as any).__base, ownerAppUrl: "http://127.0.0.1:4311",
    postiz: { url: fake.url, jwtSecret, timeoutMs: 150 }, publishingSecret: key,
  });
  await app.listen({ port: address.port, host: "127.0.0.1" });
});
after(async () => {
  await app?.close();
  await fake?.stop();
  await deleteApp(admin);
});

test("publishing stays hidden and refuses actions when Postiz is not configured", async () => {
  const plain = await buildApp({ admin, databaseId: "publishing-tests", engineKey: key, cronSecret: key, deviceSecret: key, mediaSecret: key, postiz: null });
  const { h } = await shop();
  const r = await plain.inject({ method: "GET", url: "/publishing/accounts", headers: h });
  assert.deepEqual(r.json(), { configured: false, providers: [], accounts: [] });
  assert.equal((await plain.inject({ method: "POST", url: "/publishing/accounts/connect", headers: h, payload: { provider: "facebook" } })).json().error.code, "publishing_unconfigured");
  await plain.close();
});

test("connecting provisions one organization per shop, keys rest encrypted, and the completion webhook is signature-checked", async () => {
  const { h, shop: s } = await shop();
  const before = fake.orgs.size;
  const first = await req("POST", "/publishing/accounts/connect", h, { provider: "facebook" });
  assert.equal(first.statusCode, 200, first.body);
  assert.match(first.json().url, /^https:\/\/platform\.example\/oauth\?state=/);
  await req("POST", "/publishing/accounts/connect", h, { provider: "instagram" });
  assert.equal(fake.orgs.size, before + 1, "a second connect reuses the shop's organization");
  const org = (await db.collection("cs2_publishing_orgs").doc(s.id).get()).data();
  const live = fake.orgByKey([...fake.orgs.values()].find((o) => o.email.includes(s.id))!.apiKey)!;
  assert.equal(org.state, "ready");
  assert.equal(org.postiz_org_id, live.id);
  assert.ok(!JSON.stringify(org).includes(live.apiKey), "the organization key is not stored in clear text");
  assert.equal((await req("POST", "/publishing/accounts/connect", h, { provider: "tiktok" })).json().error.code, "provider_unavailable");
  const conn = fake.connections.find((c) => c.apiKey === live.apiKey)!;
  assert.equal(conn.redirectUrl, "http://127.0.0.1:4311/#/accounts");
  assert.equal((await fake.completeConnection(conn.state, false)).status, 401, "a webhook signed with another secret is rejected");
  assert.equal((await fake.completeConnection(conn.state)).status, 200);
  const accounts = (await req("GET", "/publishing/accounts", h)).json();
  assert.equal(accounts.configured, true);
  assert.deepEqual(accounts.providers.map((p: any) => p.id), ["facebook", "instagram"]);
  assert.equal(accounts.accounts.length, 2);
  assert.ok(accounts.connect_completed_at);
  assert.ok(!JSON.stringify(accounts).includes(live.apiKey));
});

test("accounts, clips and publications are isolated between shops", async () => {
  const a = await shop(), b = await shop();
  const account = await connect(a.h);
  assert.deepEqual((await req("GET", "/publishing/accounts", b.h)).json().accounts, []);
  const clipA = await clip(a.shop.id);
  const foreignClip = await publish(b.h, clipA, { account_ids: [account.id] });
  assert.equal(foreignClip.json().error.code, "clip_missing");
  const clipB = await clip(b.shop.id);
  await connect(b.h);
  const foreignAccount = await publish(b.h, clipB, { account_ids: [account.id] });
  assert.equal(foreignAccount.json().error.code, "account_missing");
  const own = await publish(a.h, clipA, { account_ids: [account.id] });
  assert.equal(own.statusCode, 201, own.body);
  assert.equal((await req("GET", `/publications/${own.json().id}`, b.h)).statusCode, 404);
  assert.equal((await req("POST", `/publications/${own.json().id}/cancel`, b.h, {})).statusCode, 404);
  assert.equal((await req("GET", `/clips/${clipA}/publications`, b.h)).statusCode, 404);
  assert.equal((await req("DELETE", `/publishing/accounts/${account.id}`, b.h)).json().error.code, "account_missing");
  assert.equal((await req("GET", "/publishing/accounts", a.h)).json().accounts.length, 1, "B's attempt did not remove A's account");
});

test("repeated taps reuse one publication, outcomes are tracked per channel, and nothing final can be cancelled", async () => {
  const { h, shop: s } = await shop();
  const fb = await connect(h, "facebook"), ig = await connect(h, "instagram");
  const id = await clip(s.id, "Ceramic coat on a black truck.");
  const key = crypto.randomUUID();
  const calls = fake.createCalls;
  const first = await req("POST", `/clips/${id}/publish`, h, { idempotency_key: key, account_ids: [fb.id, ig.id] });
  assert.equal(first.statusCode, 201, first.body);
  const p = first.json();
  assert.equal(p.state, "queued");
  assert.equal(p.kind, "now");
  assert.equal(p.caption, "Ceramic coat on a black truck.");
  assert.deepEqual(p.channels.map((c: any) => c.state), ["queued", "queued"]);
  assert.equal(fake.uploadBytes.at(-1), "test MP4 bytes".length, "the clip bytes were streamed to the upload route");
  const again = await req("POST", `/clips/${id}/publish`, h, { idempotency_key: key, account_ids: [fb.id, ig.id] });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().id, p.id);
  assert.equal(fake.createCalls, calls + 1, "the second tap sent nothing");
  const posts = fake.posts().filter((x) => x.content === "Ceramic coat on a black truck.");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].publishDate, p.scheduled_at);
  fake.setPostState(posts[0].id, "PUBLISHED", "https://www.facebook.com/reel/1");
  fake.setPostState(posts[1].id, "ERROR");
  clock += 20000;
  const list = (await req("GET", `/clips/${id}/publications`, h)).json().publications;
  assert.equal(list.length, 1);
  assert.equal(list[0].state, "partial");
  const byAccount = Object.fromEntries(list[0].channels.map((c: any) => [c.account_id, c]));
  assert.equal(byAccount[fb.id].state, "published");
  assert.equal(byAccount[fb.id].live_url, "https://www.facebook.com/reel/1");
  assert.equal(byAccount[ig.id].state, "failed");
  assert.match(byAccount[ig.id].error, /did not accept/);
  assert.equal((await req("POST", `/publications/${p.id}/cancel`, h, {})).json().error.code, "nothing_to_cancel");
  assert.ok(!JSON.stringify(list).includes("key_"), "responses never carry organization keys");
});

test("an unanswered send is reconciled before anything is sent again", async () => {
  const { h, shop: s } = await shop();
  const fb = await connect(h);
  const id = await clip(s.id, "Timeout clip.");
  fake.mode = "hang-after-create";
  const calls = fake.createCalls;
  const r = await publish(h, id, { account_ids: [fb.id] });
  fake.mode = "ok";
  assert.equal(r.json().state, "uncertain", r.body);
  assert.equal(fake.posts().filter((x) => x.content === "Timeout clip.").length, 1, "Postiz did create the post before the answer was lost");
  clock += 20000;
  const after = (await req("GET", `/publications/${r.json().id}`, h)).json();
  assert.equal(after.state, "queued");
  assert.equal(after.channels[0].state, "queued");
  assert.equal(fake.createCalls, calls + 1, "reconciliation adopted the existing post instead of sending twice");
  assert.equal(fake.posts().filter((x) => x.content === "Timeout clip.").length, 1);

  const id2 = await clip(s.id, "Lost clip.");
  fake.mode = "hang-without-create";
  const r2 = await publish(h, id2, { account_ids: [fb.id] });
  fake.mode = "ok";
  assert.equal(r2.json().state, "uncertain");
  assert.equal(fake.posts().filter((x) => x.content === "Lost clip.").length, 0);
  clock += 20000;
  const after2 = (await req("GET", `/publications/${r2.json().id}`, h)).json();
  assert.equal(after2.state, "queued", JSON.stringify(after2));
  assert.equal(fake.posts().filter((x) => x.content === "Lost clip.").length, 1, "the send was repeated exactly once after the lookup found nothing");
});

test("service-side rejection and outages become truthful states", async () => {
  const { h, shop: s } = await shop();
  const fb = await connect(h);
  const id = await clip(s.id, "Rejected clip.");
  fake.mode = "reject";
  const rejected = await publish(h, id, { account_ids: [fb.id] });
  fake.mode = "ok";
  assert.equal(rejected.statusCode, 201);
  assert.equal(rejected.json().state, "failed");
  assert.equal(rejected.json().channels[0].error, "Instagram: post is too long, please fix it");
  fake.mode = "fail-500";
  const outage = await publish(h, id, { account_ids: [fb.id] });
  fake.mode = "ok";
  assert.equal(outage.json().state, "uncertain");
  clock += 20000;
  assert.equal((await req("GET", `/publications/${outage.json().id}`, h)).json().state, "queued");
});

test("scheduled publications keep the owner's minute and can be cancelled while queued", async () => {
  const { h, shop: s } = await shop();
  const fb = await connect(h);
  const id = await clip(s.id, "Scheduled clip.");
  assert.equal((await publish(h, id, { account_ids: [fb.id], schedule_at: new Date(clock + 60000).toISOString() })).json().error.code, "invalid_schedule");
  assert.equal((await publish(h, id, { account_ids: [fb.id], schedule_at: "tomorrow" })).json().error.code, "invalid_schedule");
  assert.equal((await publish(h, id, { account_ids: [] })).json().error.code, "invalid_accounts");
  const at = new Date(clock + 3600000);
  at.setUTCSeconds(0, 0);
  const r = await publish(h, id, { account_ids: [fb.id], schedule_at: at.toISOString() });
  assert.equal(r.statusCode, 201, r.body);
  const p = r.json();
  assert.equal(p.kind, "schedule");
  assert.equal(p.requested_at, at.toISOString());
  assert.equal(p.scheduled_at.slice(0, 16), at.toISOString().slice(0, 16), "the minute the owner chose is kept");
  assert.equal(p.timezone, "America/Los_Angeles");
  const cancelled = (await req("POST", `/publications/${p.id}/cancel`, h, {})).json();
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.channels[0].state, "cancelled");
  assert.equal(fake.posts().filter((x) => x.content === "Scheduled clip.").length, 0, "the queued post was removed from Postiz");
  assert.equal((await req("POST", `/publications/${p.id}/cancel`, h, {})).json().error.code, "nothing_to_cancel");
});

test("disconnecting an account and deleting a clip cancel their queued posts; the maintenance tick reconciles due records", async () => {
  const { h, shop: s } = await shop();
  const fb = await connect(h, "facebook"), ig = await connect(h, "instagram");
  const id = await clip(s.id, "Disconnect clip.");
  const p = (await publish(h, id, { account_ids: [fb.id, ig.id] })).json();
  assert.equal((await req("DELETE", `/publishing/accounts/${fb.id}`, h)).statusCode, 200);
  const accounts = (await req("GET", "/publishing/accounts", h)).json().accounts;
  assert.deepEqual(accounts.map((a: any) => a.id), [ig.id]);
  clock += 20000;
  const after = (await req("GET", `/publications/${p.id}`, h)).json();
  assert.equal(after.channels.find((c: any) => c.account_id === fb.id).state, "cancelled");
  assert.equal(after.channels.find((c: any) => c.account_id === ig.id).state, "queued");
  assert.equal(after.state, "queued");

  const id2 = await clip(s.id, "Deleted clip.");
  const p2 = (await publish(h, id2, { account_ids: [ig.id] })).json();
  assert.equal(p2.state, "queued");
  assert.equal((await req("DELETE", `/clips/${id2}`, h)).statusCode, 200);
  assert.equal(fake.posts().filter((x) => x.content === "Deleted clip.").length, 0);
  assert.equal((await db.collection("cs2_publications").doc(p2.id).get()).data().state, "cancelled");

  const igPost = fake.posts().find((x) => x.content === "Disconnect clip.")!;
  fake.setPostState(igPost.id, "PUBLISHED", "https://www.instagram.com/reel/abc");
  clock += 10 * 60000;
  const tick = await req("POST", "/internal/cron/tick", { "x-cron-secret": key }, {});
  assert.equal(tick.statusCode, 200, tick.body);
  assert.ok(tick.json().publications_checked >= 1, JSON.stringify(tick.json()));
  const done = (await db.collection("cs2_publications").doc(p.id).get()).data();
  assert.equal(done.state, "partial");
  assert.equal(done.channels.find((c: any) => c.account_id === ig.id).live_url, "https://www.instagram.com/reel/abc");
  assert.equal(done.active, false);
});
