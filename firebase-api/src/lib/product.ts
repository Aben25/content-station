import { readFileSync } from "node:fs";

// Root product.json: names, URLs and timing constants shared with the apps.
export const product = JSON.parse(
  readFileSync(new URL("../../../product.json", import.meta.url), "utf8"),
);
