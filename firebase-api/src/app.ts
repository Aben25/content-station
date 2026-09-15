// Composes the API: shared context first, then one module per route group.
// Behaviour and route paths are documented in docs/FIREBASE-CONTRACT.md.
import { createContext, type Options } from "./context.js";
import { fail } from "./lib/errors.js";
import { hash, str } from "./lib/validate.js";
import { registerCamera } from "./routes/camera.js";
import { registerClips } from "./routes/clips.js";
import { registerDevice } from "./routes/device.js";
import { registerEngine } from "./routes/engine.js";
import { registerMaintenance } from "./routes/maintenance.js";
import { registerMedia } from "./routes/media.js";
import { registerOwner } from "./routes/owner.js";
import { registerPairing } from "./routes/pairing.js";
import { registerPublishing } from "./routes/publishing.js";

export type { Options } from "./context.js";

export async function buildApp(options: Options = {}) {
  const ctx = await createContext(options);
  registerOwner(ctx);
  registerPairing(ctx);
  registerCamera(ctx);
  registerDevice(ctx);
  const publishing = registerPublishing(ctx.app, {
    db: ctx.db,
    bucket: ctx.bucket,
    collection: ctx.collection,
    get: ctx.get,
    ownerShop: ctx.ownerShop,
    ownedClip: ctx.ownedClip,
    now: ctx.now,
    iso: ctx.iso,
    fail,
    str,
    hash,
    base: ctx.base,
    ownerAppUrl: ctx.ownerAppUrl,
    postiz: ctx.postiz,
    vault: ctx.vault,
    providers: ctx.publishingProviders,
  });
  registerClips(ctx, publishing);
  registerEngine(ctx);
  registerMedia(ctx);
  registerMaintenance(ctx, publishing);
  return ctx.app;
}
