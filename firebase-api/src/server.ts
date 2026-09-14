import { buildApp } from "./app.js";
const app = await buildApp();
await app.listen({
  port: Number(process.env.PORT || 4310),
  host: process.env.HOST || "127.0.0.1",
});
console.log(
  `Firebase API listening on ${(app.server.address() && process.env.PORT) || 4310}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
