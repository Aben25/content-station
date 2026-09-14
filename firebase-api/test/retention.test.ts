import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildApp } from "../src/app.js";
test("cron deletes abandoned raw uploads and keeps failures pending for retry", async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = "demo-cs2-retention-tests",
    admin = initializeApp(
      { projectId, storageBucket: `${projectId}.appspot.com` },
      crypto.randomUUID(),
    );
  const db = getFirestore(admin),
    bucket = getStorage(admin).bucket(),
    id = crypto.randomUUID(),
    path = `v2/segments/test/${id}.mp4`,
    key = "a-very-long-test-secret-at-least-32-characters";
  await bucket
    .file(path)
    .save(Buffer.from("raw upload"), {
      resumable: false,
      contentType: "video/mp4",
    });
  const ref = db.collection("cs2_uploads").doc(id);
  await ref.set({
    path,
    state: "pending",
    created_at: new Date(Date.now() - 49 * 3600000).toISOString(),
  });
  let failDelete = true;
  const app = await buildApp({
    admin,
    deviceSecret: key,
    mediaSecret: key,
    engineKey: key,
    cronSecret: key,
    deleteObject: async (p) => {
      if (failDelete) throw Error("transient deletion failure");
      await bucket.file(p).delete({ ignoreNotFound: true });
    },
  });
  try {
    await app.inject({
      method: "POST",
      url: "/internal/cron/tick",
      headers: { "x-cron-secret": key },
      payload: {},
    });
    assert.equal((await ref.get()).data()?.deletion_state, "pending");
    assert.equal((await bucket.file(path).exists())[0], true);
    failDelete = false;
    await app.inject({
      method: "POST",
      url: "/internal/cron/tick",
      headers: { "x-cron-secret": key },
      payload: {},
    });
    assert.equal((await ref.get()).data()?.deletion_state, "deleted");
    assert.equal((await bucket.file(path).exists())[0], false);
  } finally {
    await app.close();
    await ref.delete();
    await bucket.file(path).delete({ ignoreNotFound: true });
    await deleteApp(admin);
  }
});

test("a failed concurrent upload cannot delete the successful immutable upload", async () => {
  const { createHmac } = await import("node:crypto");
  const { Readable } = await import("node:stream");
  const projectId = "demo-cs2-retention-tests",
    admin = initializeApp(
      { projectId, storageBucket: `${projectId}.appspot.com` },
      crypto.randomUUID(),
    );
  const db = getFirestore(admin),
    bucket = getStorage(admin).bucket(),
    id = crypto.randomUUID(),
    path = `v2/segments/test/${id}.mp4`,
    key = "a-very-long-test-secret-at-least-32-characters";
  const ur = db.collection("cs2_uploads").doc(id),
    dr = db.collection("cs2_devices").doc(id);
  await dr.set({ unpaired_at: null });
  await ur.set({ path, device_id: id, state: "pending" });
  const payload = Buffer.from(
    JSON.stringify({
      action: "upload",
      path,
      kind: "uploads",
      id,
      content_type: "video/mp4",
      max_bytes: 1024,
      exp: Date.now() + 60000,
    }),
  ).toString("base64url");
  const url = `/media/${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
  const app = await buildApp({
    admin,
    deviceSecret: key,
    mediaSecret: key,
    engineKey: key,
    cronSecret: key,
  });
  let firstChunk!: () => void;
  const streaming = new Promise<void>((resolve) => {
    firstChunk = resolve;
  });
  let started = false;
  const slow = new Readable({
    read() {
      if (!started) {
        started = true;
        this.push(Buffer.from("unfinished"));
        firstChunk();
      }
    },
  });
  try {
    const losing = app.inject({
      method: "PUT",
      url,
      headers: { "content-type": "video/mp4" },
      payload: slow,
    });
    const pending = losing.then(
      (x) => x,
      (e) => e,
    );
    await streaming;
    const success = await app.inject({
      method: "PUT",
      url,
      headers: { "content-type": "video/mp4" },
      payload: Buffer.from("successful upload"),
    });
    assert.equal(success.statusCode, 204);
    slow.push(Buffer.alloc(2048));
    slow.push(null);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await bucket.file(path).exists())[0], true);
    assert.equal(
      (await bucket.file(path).download())[0].toString(),
      "successful upload",
    );
  } finally {
    await app.close();
    await ur.delete();
    await dr.delete();
    await bucket.file(path).delete({ ignoreNotFound: true });
    await deleteApp(admin);
  }
});
