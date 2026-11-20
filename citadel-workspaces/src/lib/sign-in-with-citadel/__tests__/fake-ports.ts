/**
 * In-memory ports for the sign-in flow: the issuer and agent answer from scripts and record every
 * call, so a test asserts what was sent where — and what never was. No production module is mocked;
 * these stand in for the network and the agent socket only.
 */
import type { IdentityOutcome } from 'citadel-internal-service-wasm-client';
import type { ReturnAllowlist, SignInBeginRequest, SignInBeginResponse, SignInProveRequest, SignInProveResponse } from '../issuer-wire';
import type { AgentAnswer, IssuerAnswer, SignChallenge, SignInPorts } from '../ports';

/** The contract's own fixtures (fixtures/sign-in-with-citadel/*), restated as values the tests compare against. */
export const LINK = {
  client: 'synchronized.work',
  challenge: '2i7js9uw64RvSzVINywDxXLTQyLI6lZfTFFFUHnJsDc',
  state: 'ozHjXJPho4EgyGbICkCj-g',
  return: 'https://synchronized.work/auth/return',
} as const;

export const search = (fields: Record<string, string>): string => `?${new URLSearchParams(fields).toString()}`;

export const ALLOWLIST: ReturnAllowlist = {
  v: 1,
  clients: {
    'sw-mcp': { display_name: 'synchronized.work MCP', aud: 'sw-mcp', returns: ['https://work.avarok.net/sign-in/code'] },
    'synchronized.work': { display_name: 'synchronized.work', aud: 'synchronized.work', returns: ['https://synchronized.work/auth/return'] },
  },
};

export const BEGUN: SignInBeginResponse = {
  v: 1, attempt: 'AAECAwQFBgcICQoLDA0ODw', nonce: 'EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8',
  issuer: 'work.avarok.net', aud: 'synchronized.work', display_name: 'synchronized.work', expires_in_s: 300,
};

export const PROVEN: SignInProveResponse = { v: 1, code: 'K7QM-2XRA', return: LINK.return, state: LINK.state };

export const ID_FP: string = '3forj6ftckvpoy2r';
export const LOCKED: AgentAnswer = { ok: true, outcome: { Status: { state: { Locked: { id_fp: ID_FP } } } } };
export const NO_IDENTITY: AgentAnswer = { ok: true, outcome: { Status: { state: 'None' } } };
export const SIGNED: AgentAnswer = { ok: true, outcome: { SignedChallenge: { proof: 'AQ' + 'A'.repeat(7200) } } };
export const refusal = (reason: Extract<AgentAnswer, { ok: false }>['reason']): AgentAnswer => ({ ok: false, reason, message: reason });
export const outcome = (value: IdentityOutcome): AgentAnswer => ({ ok: true, outcome: value });

export interface Script {
  allowlist: IssuerAnswer<ReturnAllowlist>;
  begin: IssuerAnswer<SignInBeginResponse>;
  prove: IssuerAnswer<SignInProveResponse>;
  status: AgentAnswer | null;
  create: AgentAnswer;
  exportPhrase: AgentAnswer;
  sign: AgentAnswer[];
  randoms: number[];
}

export interface Calls {
  allowlist: number;
  begin: SignInBeginRequest[];
  prove: SignInProveRequest[];
  status: number[];
  create: string[];
  exportPhrase: string[];
  sign: SignChallenge[];
  posted: { action: string; fields: { code: string; state: string } }[];
}

export function fakePorts(overrides: Partial<Script> = {}): { ports: SignInPorts; calls: Calls; script: Script } {
  const script: Script = {
    allowlist: { ok: true, value: ALLOWLIST },
    begin: { ok: true, value: BEGUN },
    prove: { ok: true, value: PROVEN },
    status: LOCKED,
    create: outcome({ Created: { pk: 'pk', id_fp: 'newidentityfp234' } }),
    exportPhrase: outcome({ Exported: { phrase: Array.from({ length: 24 }, (_: unknown, i: number) => `word${i}`) } }),
    sign: [SIGNED],
    randoms: [20, 3, 3, 11],
    ...overrides,
  };
  const calls: Calls = { allowlist: 0, begin: [], prove: [], status: [], create: [], exportPhrase: [], sign: [], posted: [] };
  const randoms: number[] = [...script.randoms];
  const ports: SignInPorts = {
    issuer: {
      allowlist: async () => { calls.allowlist += 1; return script.allowlist; },
      begin: async (body) => { calls.begin.push(body); return script.begin; },
      prove: async (body) => { calls.prove.push(body); return script.prove; },
    },
    agent: {
      status: async (ms) => { calls.status.push(ms); return script.status; },
      create: async (pw) => { calls.create.push(pw); return script.create; },
      exportPhrase: async (pw) => { calls.exportPhrase.push(pw); return script.exportPhrase; },
      signChallenge: async (request) => {
        calls.sign.push(request);
        return script.sign.length > 1 ? (script.sign.shift() as AgentAnswer) : script.sign[0];
      },
    },
    returner: { post: (action, fields) => { calls.posted.push({ action, fields }); } },
    randomIndex: (bound: number) => {
      const next: number | undefined = randoms.shift();
      if (next === undefined || next >= bound) throw new Error(`the script has no random below ${bound}`);
      return next;
    },
  };
  return { ports, calls, script };
}
