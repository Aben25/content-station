// Pair a station from the command line.
//
//   npx tsx pair.mts            → list stations waiting to pair
//   npx tsx pair.mts ABC123     → approve the station with that code
//   npx tsx pair.mts --revoke <uid>
//
// The dashboard does the same thing, but this works without signing in — handy
// when the station is in another country and someone reads you the code.
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db, STATIONS } from "./src/firebase.js";

db();

const arg = process.argv[2];

if (arg === "--revoke") {
  const uid = process.argv[3];
  if (!uid) {
    console.error("usage: npx tsx pair.mts --revoke <uid>");
    process.exit(1);
  }
  await getAuth().setCustomUserClaims(uid, {});
  await db().collection(STATIONS).doc(uid).update({ approved: false, claimSynced: false });
  console.log(`revoked ${uid} — the station stops uploading on its next token refresh`);
  process.exit(0);
}

const snap = await db().collection(STATIONS).get();

if (!arg) {
  if (snap.empty) {
    console.log("No stations have registered yet.");
    console.log("Open the app on the iPhone — it registers on launch and shows a 6-character code.");
    process.exit(0);
  }
  console.log(`${snap.size} station(s):\n`);
  for (const doc of snap.docs) {
    const d = doc.data();
    const seen = d.lastSeenAt?.toDate?.();
    console.log(`  ${d.approved ? "✅ paired  " : "⏳ waiting "} code ${d.pairingCode}  ${d.name ?? ""}`);
    console.log(`     uid ${doc.id}`);
    if (seen) console.log(`     last seen ${seen.toISOString()}`);
  }
  console.log("\nTo pair:  npx tsx pair.mts <CODE>");
  process.exit(0);
}

const code = arg.trim().toUpperCase();
// A station that recovered its identity re-registers under a new uid with the
// same code, so several rows can share it. The one that checked in most
// recently is the live device; the rest are residue of dead identities.
const matches = snap.docs
  .filter((d) => d.data().pairingCode === code)
  .sort((a, b) => (b.data().lastSeenAt?.toMillis() ?? 0) - (a.data().lastSeenAt?.toMillis() ?? 0));
const match = matches[0];

for (const stale of matches.slice(1)) {
  await getAuth().deleteUser(stale.id).catch(() => {});
  await stale.ref.delete();
  console.log(`cleaned up stale registration ${stale.id.slice(0, 8)} (same code, older lastSeen)`);
}

if (!match) {
  console.error(`No station is waiting with code ${code}.`);
  console.error("Run without arguments to see which codes are registered.");
  process.exit(1);
}

if (match.data().approved) {
  console.log(`Station ${code} is already paired.`);
  process.exit(0);
}

// Mint the claim directly rather than waiting for the worker's sync pass, so
// the station can upload the moment it refreshes its token.
await match.ref.update({
  approved: true,
  claimSynced: true,
  claimSyncedAt: FieldValue.serverTimestamp(),
});
await getAuth().setCustomUserClaims(match.id, { stationApproved: true });

console.log(`Paired ${code} (${match.id}).`);
console.log("The station starts uploading within a couple of minutes, or immediately if someone taps the screen.");
process.exit(0);
