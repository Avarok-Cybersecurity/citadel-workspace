/** Signs `payload` the way Stripe signs a webhook: `t=…,v1=…`. Tests and the local proof only. */
import { toHex } from "../control/secrets.mjs";

export async function signLikeStripe(payload, secret, timestamp) {
  const enc = new TextEncoder();
  const mac = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", mac, enc.encode(`${timestamp}.${payload}`));
  return `t=${timestamp},v1=${toHex(sig)}`;
}
