// Exercises the Firestore and Storage rules the way the station app does:
// anonymous sign-in over REST, then the exact writes the app performs. Run
// with `npx tsx rules-check.mts`. Safe to re-run; it cleans up after itself.
import { readFileSync } from "node:fs";
import { getAuth } from "firebase-admin/auth";
import { db, bucket, STATIONS, CAPTURES } from "./src/firebase.js";

const API_KEY = "AIzaSyAFxKYI_ViLFAxjk2b1EcCn2B9ctYvn6-E";
const PROJECT = "lemekeru";
const BUCKET = "lemekeru-content-station";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

const s = (v: string) => ({ stringValue: v });
const b = (v: boolean) => ({ booleanValue: v });
const t = (v: Date) => ({ timestampValue: v.toISOString() });

/// Mirrors what the worker's syncStationClaims does, then re-mints the token
/// the way the app does after pairing.
async function mintRefreshedToken(refresh: string): Promise<string> {
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${refresh}`,
  });
  return (await res.json()).id_token;
}

async function signInAnon(): Promise<{ idToken: string; uid: string; refreshToken: string }> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const json = await res.json();
  return { idToken: json.idToken, uid: json.localId, refreshToken: json.refreshToken };
}

async function createDoc(token: string, collection: string, id: string, fields: object): Promise<number> {
  const res = await fetch(`${DOCS}/${collection}?documentId=${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function patchDoc(token: string, collection: string, id: string, fields: Record<string, object>): Promise<number> {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const res = await fetch(`${DOCS}/${collection}/${id}?${mask}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

async function uploadRaw(token: string, captureId: string, file: string): Promise<number> {
  const objectPath = encodeURIComponent(`captures/${captureId}/raw.mp4`);
  const res = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${objectPath}`,
    {
      method: "POST",
      headers: { "Content-Type": "video/mp4", Authorization: `Firebase ${token}` },
      body: readFileSync(file),
    },
  );
  return res.status;
}

const RAW = process.argv[2] ?? "uploads/2bf00732-fe9c-4b3d-90ca-f39b7266c505/raw.mp4";
const { idToken: initialToken, uid, refreshToken } = await signInAnon();
let idToken = initialToken;
console.log(`anonymous station uid: ${uid}\n`);

const code = "TEST01";
const captureId = `rulescheck-${Date.now()}`;

// --- registration -----------------------------------------------------------
check(
  "station cannot register itself pre-approved",
  (await createDoc(idToken, STATIONS, `${uid}-bad`, { approved: b(true), pairingCode: s(code) })) >= 400,
);
check(
  "station registers unapproved with a pairing code",
  (await createDoc(idToken, STATIONS, uid, {
    approved: b(false),
    pairingCode: s(code),
    name: s("Rules check"),
    createdAt: t(new Date()),
  })) === 200,
);

// --- before approval --------------------------------------------------------
check("unapproved station cannot upload footage", (await uploadRaw(idToken, captureId, RAW)) >= 400);
check(
  "unapproved station cannot create a capture",
  (await createDoc(idToken, CAPTURES, captureId, {
    stationId: s(uid),
    status: s("uploaded"),
    storagePath: s(`captures/${captureId}/raw.mp4`),
    createdAt: t(new Date()),
  })) >= 400,
);
check("station cannot approve itself", (await patchDoc(idToken, STATIONS, uid, { approved: b(true) })) >= 400);

// --- owner approves (the dashboard's pairing action) -------------------------
await db().collection(STATIONS).doc(uid).update({ approved: true });
await getAuth().setCustomUserClaims(uid, { stationApproved: true });
idToken = await mintRefreshedToken(refreshToken);
console.log("\n  (owner approved the station; worker minted the claim)\n");

// --- after approval ---------------------------------------------------------
check("approved station uploads footage", (await uploadRaw(idToken, captureId, RAW)) === 200);
check(
  "approved station creates its capture",
  (await createDoc(idToken, CAPTURES, captureId, {
    stationId: s(uid),
    status: s("uploaded"),
    storagePath: s(`captures/${captureId}/raw.mp4`),
    bytes: { integerValue: "130909" },
    createdAt: t(new Date()),
    updatedAt: t(new Date()),
  })) === 200,
);
check(
  "station cannot fabricate an approved capture",
  (await createDoc(idToken, CAPTURES, `${captureId}-bad`, {
    stationId: s(uid),
    status: s("approved"),
    storagePath: s("x"),
    createdAt: t(new Date()),
  })) >= 400,
);
check(
  "station cannot impersonate another station",
  (await createDoc(idToken, CAPTURES, `${captureId}-imp`, {
    stationId: s("someone-else"),
    status: s("uploaded"),
    storagePath: s("x"),
    createdAt: t(new Date()),
  })) >= 400,
);
check(
  "station cannot move its own capture to approve_requested",
  (await patchDoc(idToken, CAPTURES, captureId, { status: s("approve_requested") })) >= 400,
);

// --- cleanup ----------------------------------------------------------------
await db().collection(STATIONS).doc(uid).delete();
await getAuth().deleteUser(uid);
await db().collection(CAPTURES).doc(captureId).delete();
await bucket().deleteFiles({ prefix: `captures/${captureId}/` });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
