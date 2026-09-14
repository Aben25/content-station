import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:http2";
import { once } from "node:events";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash } from "node:crypto";
import { buildApp } from "../src/app.js";

test("HTTP/2 listener accepts a camera upload larger than Cloud Run's HTTP/1 limit", async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "requires local emulators");
  const projectId = "demo-contentstation-v2";
  const admin = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, "http2-upload-test");
  const old = process.env.API_HTTP2;
  process.env.API_HTTP2 = "true";
  const key = "http2-test-secret-at-least-32-characters";
  const app = await buildApp({ admin, databaseId: "http2-tests", deviceSecret: key, mediaSecret: key, engineKey: key, cronSecret: key });
  const db = getFirestore(admin, "http2-tests");
  const bucket = getStorage(admin).bucket();
  let path: string | undefined;
  let ownerId: string | undefined;
  let shopId: string | undefined;
  let deviceId: string | undefined;
  let pairId: string | undefined;
  let client: ReturnType<typeof connect> | undefined;
  try {
    const signup = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
    });
    const identity: any = await signup.json();
    assert.ok(identity.idToken);
    ownerId = identity.localId;
    const headers = { authorization: `Bearer ${identity.idToken}` };
    const shop = (await app.inject({ method: "POST", url: "/shops", headers, payload: { name: "HTTP2 fixture", type: "other" } })).json().shop;
    shopId = shop.id;
    const pair = (await app.inject({ method: "POST", url: "/pair/token", headers, payload: { ssid: "Fixture WiFi", password: "fixture-password" } })).json();
    pairId = createHash("sha256").update(pair.pair_token).digest("hex");
    const device = (await app.inject({ method: "POST", url: "/pair/claim", payload: { pair_token: pair.pair_token, serial: crypto.randomUUID(), model: "fixture", app_version: "test" } })).json();
    deviceId = device.device_id;
    const grant = (await app.inject({ method: "POST", url: "/device/segment/upload-url", headers: { authorization: `Bearer ${device.device_jwt}` }, payload: {
      start_ts: new Date(Date.now() - 5000).toISOString(), end_ts: new Date().toISOString(),
    } })).json();
    assert.ok(grant.upload_url);
    path = grant.path;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    client = connect(`http://127.0.0.1:${address.port}`);
    const url = new URL(grant.upload_url);
    const bytes = 33 * 1024 * 1024;
    const request = client.request({ ":method": "PUT", ":path": url.pathname + url.search, "content-type": "video/mp4", "content-length": bytes });
    const response = once(request, "response");
    const ended = once(request, "end");
    request.resume();
    request.end(Buffer.alloc(bytes, 0));
    const [responseHeaders] = await response;
    await ended;
    assert.equal(responseHeaders[":status"], 204);
    const [metadata] = await bucket.file(path!).getMetadata();
    assert.equal(Number(metadata.size), bytes);
  } finally {
    client?.destroy();
    await app.close();
    if (path) await bucket.file(path).delete({ ignoreNotFound: true });
    for (const [collection, id] of [["cs2_memberships", ownerId], ["cs2_shops", shopId], ["cs2_devices", deviceId], ["cs2_pair_tokens", pairId]]) {
      if (id) await db.collection(collection!).doc(id).delete();
    }
    if (deviceId) {
      const uploads = await db.collection("cs2_uploads").where("device_id", "==", deviceId).get();
      await Promise.all(uploads.docs.map(doc => doc.ref.delete()));
    }
    if (ownerId) await getAuth(admin).deleteUser(ownerId);
    await deleteApp(admin);
    if (old === undefined) delete process.env.API_HTTP2; else process.env.API_HTTP2 = old;
  }
});
