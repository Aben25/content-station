import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { config } from "./config.js";

/// Admin credentials for the Mac worker. The key lives outside the repo
/// (~/.config/content-station/worker-sa.json by default) because the Admin SDK
/// bypasses every security rule — treat it like root for this project.
function initAdmin() {
  const existing = getApps()[0];
  if (existing) return existing;

  const raw = readFileSync(config.firebase.serviceAccountPath, "utf8");
  const serviceAccount = JSON.parse(raw) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };

  return initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
    storageBucket: config.firebase.bucket,
  });
}

let cachedDb: Firestore | undefined;

export function db(): Firestore {
  if (!cachedDb) {
    cachedDb = getFirestore(initAdmin());
    cachedDb.settings({ ignoreUndefinedProperties: true });
  }
  return cachedDb;
}

export function bucket() {
  return getStorage(initAdmin()).bucket(config.firebase.bucket);
}

export const CAPTURES = "csCaptures";
export const STATIONS = "csStations";
