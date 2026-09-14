// ContentStation api. One function, every route from docs/CONTRACT.md.
import { Router } from "../_shared/http.ts";
import { mountAuth } from "./routes/auth.ts";
import { mountShops } from "./routes/shops.ts";
import { mountPair } from "./routes/pair.ts";
import { mountDevice } from "./routes/device.ts";
import { mountCamera } from "./routes/camera.ts";
import { mountClips } from "./routes/clips.ts";
import { mountEngine } from "./routes/engine.ts";
import { mountCron } from "./routes/cron.ts";

const router = new Router();
mountAuth(router);
mountShops(router);
mountPair(router);
mountDevice(router);
mountCamera(router);
mountClips(router);
mountEngine(router);
mountCron(router);
router.get("/health", () => ({ ok: true, at: new Date().toISOString() }));

Deno.serve((req) => router.handle(req, "/api"));
