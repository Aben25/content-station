// HS256 JWT for wall devices. WebCrypto only, no dependency.
import { DEVICE_JWT_SECRET } from "./env.ts";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode(DEVICE_JWT_SECRET()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface DeviceClaims {
  sub: string;
  shop_id: string;
  role: "device";
  iat: number;
  exp: number;
}

export async function signDeviceJwt(deviceId: string, shopId: string, days = 365): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: DeviceClaims = { sub: deviceId, shop_id: shopId, role: "device", iat: now, exp: now + days * 86400 };
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function verifyDeviceJwt(token: string): Promise<DeviceClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), b64urlDecode(sig), enc.encode(`${header}.${payload}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as DeviceClaims;
    if (claims.role !== "device" || !claims.sub || !claims.shop_id) return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
