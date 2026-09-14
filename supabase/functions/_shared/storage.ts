import { db } from "./db.ts";

export async function signedUrl(bucket: string, path: string | null | undefined, seconds = 3600): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function removeObjects(bucket: string, paths: string[]): Promise<void> {
  const clean = paths.filter(Boolean);
  if (clean.length === 0) return;
  const { error } = await db().storage.from(bucket).remove(clean);
  if (error) console.warn(`storage remove ${bucket}: ${error.message}`);
}

export async function uploadJpeg(bucket: string, path: string, bytes: Uint8Array): Promise<void> {
  const { error } = await db().storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`storage upload ${bucket}/${path}: ${error.message}`);
}

export async function objectExists(bucket: string, path: string): Promise<boolean> {
  const dir = path.split("/").slice(0, -1).join("/");
  const name = path.split("/").pop() ?? "";
  const { data } = await db().storage.from(bucket).list(dir, { search: name, limit: 1 });
  return !!data && data.some((o) => o.name === name);
}
