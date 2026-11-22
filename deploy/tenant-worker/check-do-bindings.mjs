#!/usr/bin/env node
/**
 * Before `wrangler deploy`: would Cloudflare refuse this config's Durable Object class deletions
 * (do-binding-rule.mjs)? Reads the live Worker's bindings, read-only, from the API.
 *
 *   CLOUDFLARE_API_TOKEN=... check-do-bindings.mjs <wrangler.toml>   (deploy.sh runs it)
 *
 * The token comes from the environment only and is never printed. A Worker that does not exist
 * yet has no live bindings, so its first deploy passes.
 */
import { unstable_readConfig } from "wrangler";
import { bindingReuseRefusals } from "./do-binding-rule.mjs";

const fail = (message) => {
  console.error(`check-do-bindings: ${message}`);
  process.exit(1);
};
const path = process.argv[2];
if (!path) fail("usage: check-do-bindings.mjs <wrangler.toml>");
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail("CLOUDFLARE_API_TOKEN is not set");

const config = unstable_readConfig({ config: path });
const url = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/scripts/${config.name}/settings`;
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
let live = [];
if (response.status !== 404) {
  const body = await response.json();
  if (!response.ok || !body.success) fail(`reading ${config.name}'s settings: HTTP ${response.status} ${JSON.stringify(body.errors)}`);
  live = body.result.bindings.filter((b) => b.type === "durable_object_namespace");
}
const refusals = bindingReuseRefusals(live, config);
if (refusals.length) fail(refusals.join("\n"));
console.log(`check-do-bindings: ${config.name}: no deleted class keeps a live binding name (${live.map((b) => `${b.name}->${b.class_name}`).join(", ") || "none live"})`);
