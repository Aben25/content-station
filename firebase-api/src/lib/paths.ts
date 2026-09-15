import type { Row } from "./types.js";

// Deterministic output object paths for a render job and clip index.
export const outputPaths = (j: Row, index: number) => ({
  path: `v2/clips/${j.shop_id}/${j.id}/${index}.mp4`,
  thumb_path: `v2/thumbs/${j.shop_id}/clips/${j.id}/${index}.jpg`,
});
