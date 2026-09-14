import product from "../../_shared/product.json" with { type: "json" };
import { anon } from "../../_shared/db.ts";
import { ApiError, readJson, requireString, Router, CORS_HEADERS } from "../../_shared/http.ts";
import { TWILIO_AUTH_TOKEN } from "../../_shared/env.ts";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new ApiError(400, "bad_phone", "That doesn't look like a mobile number. Use 10 digits.");
}

async function twilioSignatureOk(req: Request, params: URLSearchParams): Promise<boolean> {
  const token = TWILIO_AUTH_TOKEN();
  if (!token) return true;
  const sig = req.headers.get("x-twilio-signature");
  if (!sig) return false;
  const keys = [...params.keys()].sort();
  let data = req.url;
  for (const k of keys) data += k + (params.get(k) ?? "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let s = "";
  for (const b of mac) s += String.fromCharCode(b);
  return btoa(s) === sig;
}

export function mountAuth(r: Router) {
  r.post("/auth/otp/send", async ({ req }) => {
    const body = await readJson(req);
    const phone = normalizePhone(requireString(body, "phone", 32));
    const { error } = await anon().auth.signInWithOtp({ phone });
    if (error) throw new ApiError(400, "otp_send_failed", "We couldn't text that number. Check it and try again.");
    return { ok: true, phone };
  });

  r.post("/auth/otp/verify", async ({ req }) => {
    const body = await readJson(req);
    const phone = normalizePhone(requireString(body, "phone", 32));
    const code = requireString(body, "code", 12).replace(/\D/g, "");
    const { data, error } = await anon().auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error || !data.session) throw new ApiError(401, "bad_code", "That code didn't match. Try again or text a new one.");
    return { session: data.session };
  });

  // Twilio inbound webhook for the card in the box: "Text START to (number)".
  r.post("/sms/inbound", async ({ req }) => {
    const params = new URLSearchParams(await req.text());
    if (!(await twilioSignatureOk(req, params))) throw new ApiError(403, "bad_signature", "Signature did not match.");
    const text = (params.get("Body") ?? "").trim().toLowerCase();
    const reply = text.startsWith("start")
      ? `Welcome to ${product.name}. Open ${product.startUrl} on this phone to set up your camera. Takes about five minutes.`
      : `Text START to set up your camera, or reply with your question and we'll get back to you.`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Message></Response>`;
    return new Response(twiml, { status: 200, headers: { "Content-Type": "text/xml", ...CORS_HEADERS } });
  });
}
