// Provision the fixed station account shipped inside the app.
//
//   npx tsx provision-station.mts "Shop name"
//
// Creates one anonymous Firebase identity, marks it approved, mints the
// stationApproved claim, and prints a refresh token. The refresh token does
// not expire unless revoked, so the app can authenticate forever without any
// setup on site — which is the point: staff plug the phone in and press Start.
//
// Write the output to ContentStation/StationCredentials.plist (gitignored).
// Revoke with: npx tsx pair.mts --revoke <uid>
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db, STATIONS } from "./src/firebase.js";

const API_KEY = process.env.FIREBASE_WEB_API_KEY ?? "AIzaSyAFxKYI_ViLFAxjk2b1EcCn2B9ctYvn6-E";
const name = process.argv[2] ?? "Station";

db();

// Anonymous sign-in gives us an identity plus the refresh token in one call.
const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ returnSecureToken: true }),
});
const json = (await res.json()) as { localId?: string; refreshToken?: string; error?: unknown };
if (!json.localId || !json.refreshToken) {
  console.error("sign-up failed:", JSON.stringify(json.error ?? json));
  process.exit(1);
}

const uid = json.localId;
await getAuth().setCustomUserClaims(uid, { stationApproved: true });
await db().collection(STATIONS).doc(uid).set({
  name,
  approved: true,
  claimSynced: true,
  claimSyncedAt: FieldValue.serverTimestamp(),
  pairingCode: "PREPRD",
  provisioned: true,
  createdAt: FieldValue.serverTimestamp(),
  lastSeenAt: FieldValue.serverTimestamp(),
});

console.log(`\nProvisioned station "${name}"`);
console.log(`uid: ${uid}\n`);
console.log("Write this to apps/station/ContentStation/StationCredentials.plist:\n");
console.log(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>StationRefreshToken</key>
\t<string>${json.refreshToken}</string>
\t<key>StationUID</key>
\t<string>${uid}</string>
</dict>
</plist>`);
process.exit(0);
