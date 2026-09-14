// Twilio SMS. Dry run when Twilio is not configured so local dev never texts anyone.
import { db } from "./db.ts";
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGE_SERVICE_SID } from "./env.ts";

export interface SmsRecord {
  shopId: string | null;
  userId?: string | null;
  type: string;
  to: string | null;
  body: string;
  meta?: Record<string, unknown>;
}

export async function sendSms(rec: SmsRecord): Promise<void> {
  const sid = TWILIO_ACCOUNT_SID();
  const token = TWILIO_AUTH_TOKEN();
  const service = TWILIO_MESSAGE_SERVICE_SID();
  const from = TWILIO_FROM();
  let delivered = false;
  let errorText: string | undefined;

  if (rec.to && sid && token && (service || from)) {
    const form = new URLSearchParams({ To: rec.to, Body: rec.body });
    if (service) form.set("MessagingServiceSid", service);
    else if (from) form.set("From", from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    delivered = res.ok;
    if (!res.ok) errorText = `twilio ${res.status}`;
  } else {
    errorText = "dry_run";
  }

  await db().from("notifications").insert({
    shop_id: rec.shopId,
    user_id: rec.userId ?? null,
    type: rec.type,
    channel: "sms",
    body: rec.body,
    meta: { ...(rec.meta ?? {}), delivered, error: errorText ?? null },
  });
  if (!delivered) console.log(`sms not delivered (${errorText}) type=${rec.type}`);
}

export async function opsAlert(shopId: string | null, type: string, body: string, meta?: Record<string, unknown>): Promise<void> {
  await db().from("notifications").insert({ shop_id: shopId, type, channel: "ops", body, meta: meta ?? null });
  console.log(`ops alert ${type}: ${body}`);
}
