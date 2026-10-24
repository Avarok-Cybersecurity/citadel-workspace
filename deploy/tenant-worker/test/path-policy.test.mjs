/** The path policy a tenant's server is given (control/path-policy.mjs): pure. */
import { describe, expect, it } from "vitest";
import { mediaOnServerRelay, pathPolicyOf } from "../control/path-policy.mjs";

const plan = (tier, extra = {}) => ({ tier, trial_clamped: false, ...extra });
const relay = (policy) => policy.rules.find((r) => r.kind === "ServerRelay");

describe("path policy", () => {
  it("is the owner's order on every tier, every path enabled", () => {
    for (const tier of ["free", "team", "business"]) {
      const policy = pathPolicyOf(plan(tier));
      expect(policy.rules.map((r) => r.kind)).toEqual(["Direct", "PeerRelay", "Turn", "ServerRelay"]);
      expect(policy.rules.every((r) => r.enabled)).toBe(true);
      expect(policy.denied).toEqual([]);
    }
  });

  it("lets the server relay carry media on paid tiers only", () => {
    expect(relay(pathPolicyOf(plan("team"))).classes).toContain("Media");
    expect(relay(pathPolicyOf(plan("business"))).classes).toContain("Media");
    expect(relay(pathPolicyOf(plan("free"))).classes).toEqual(["Control", "Msg", "File"]);
  });

  it("keeps media on peer paths for a free tenant, so a call still connects peer to peer", () => {
    const policy = pathPolicyOf(plan("free"));
    for (const kind of ["Direct", "PeerRelay", "Turn"]) {
      expect(policy.rules.find((r) => r.kind === kind).classes).toContain("Media");
    }
  });

  it("treats a trial clamped to the free allowance as free", () => {
    expect(mediaOnServerRelay(plan("team", { trial_clamped: true }))).toBe(false);
    expect(mediaOnServerRelay(plan("team"))).toBe(true);
  });
});
