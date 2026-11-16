/**
 * Recomputes every derivation of the batch-1116 known-answer files that Node can compute without
 * dependencies (HMAC-SHA3, SHA3, SHA-256, the byte layouts, the encodings, the canonical CBOR a
 * signature covers) and compares it with the recorded value. ML-DSA-65 signatures and keys are
 * length-checked here and verified by the Rust crates' own tests against the same vectors.
 *
 * Every function returns { checks, mismatches } so the gate can print what it compared.
 */
import { createHash, createHmac } from 'node:crypto';
import { encodeCanonical, jsonToModel, bytesToHex, hexToBytes } from './cbor.mjs';

const sha3 = (...parts) => { const h = createHash('sha3-256'); for (const p of parts) h.update(p); return h.digest(); };
const hmac3 = (key, ...parts) => { const h = createHmac('sha3-256', key); for (const p of parts) h.update(p); return h.digest(); };
const ds = (domain, body) => Buffer.concat([Buffer.from(domain), Buffer.of(0), body]);
const str16 = (s) => { const b = Buffer.from(s, 'utf8'); const out = Buffer.alloc(2 + b.length); out.writeUInt16BE(b.length); b.copy(out, 2); return out; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');
const hex = (b) => Buffer.from(b).toString('hex');
function base32Lower(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let out = ''; let buffer = 0; let bits = 0;
  for (const byte of bytes) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(buffer >> bits) & 31]; } }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}
const bits11 = (bytes, i) => { let v = 0; for (let k = 0; k < 11; k++) { const bit = i * 11 + k; v = (v << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1); } return v; };

class Tally {
  constructor() { this.checks = 0; this.mismatches = []; }
  eq(what, actual, expected) { this.checks++; if (actual !== expected) this.mismatches.push(`${what}: computed ${String(actual).slice(0, 72)} but the file says ${String(expected).slice(0, 72)}`); }
  len(what, bytes, n) { this.eq(`${what} length`, bytes.length, n); }
}
const D = { sign: 'citadel-identity-sign-v1', pw: 'citadel-identity-pw-v1', server: 'citadel-server-sign-v1', spw: 'citadel-server-pw-v2',
  fp: 'citadel-identity-fp-v1', binding: 'citadel-identity-binding-v2', wk: 'citadel-well-known-v1', challenge: 'citadel-server-challenge-v1',
  assertion: 'citadel-sign-in-assertion-v1', match: 'citadel-sign-in-match-v1' };

function identity(t, name, id) {
  const seed = hexToBytes(id.seed_hex);
  t.eq(`${name}.xi`, hex(hmac3(seed, D.sign)), id.xi_hex);
  t.eq(`${name}.k_pw`, hex(hmac3(seed, D.pw)), id.k_pw_hex);
  const pk = unb64(id.pk_b64url);
  t.len(`${name}.pk`, pk, 1952);
  t.eq(`${name}.pk_sha3`, hex(sha3(pk)), id.pk_sha3_256_hex);
  const fp = base32Lower(sha3(D.fp, Buffer.of(0), pk).subarray(0, 10));
  t.eq(`${name}.id_fp`, fp, id.id_fp);
  t.eq(`${name}.id_fp_grouped`, fp.match(/.{4}/g).join('-'), id.id_fp_grouped);
  for (const p of id.passwords) {
    const pw = hmac3(hexToBytes(id.k_pw_hex), D.spw, Buffer.of(0), p.domain, Buffer.of(0), p.username);
    t.eq(`${name}.password(${p.domain}) bytes`, hex(pw), p.pw_bytes_hex);
    t.eq(`${name}.password(${p.domain})`, b64(pw), p.password);
    t.len(`${name}.password(${p.domain}) text`, p.password, 43);
  }
  for (const [label, bnd] of [['binding', id.binding], ['legacy_binding', id.legacy_binding]]) {
    const message = ds(D.binding, Buffer.concat([str16(bnd.username), str16(bnd.domain), u64(bnd.issued_at_s)]));
    t.eq(`${name}.${label}.message`, hex(message), bnd.message_hex);
    const sig = hexToBytes(bnd.sig_hex);
    t.len(`${name}.${label}.sig`, sig, 3309);
    const blob = Buffer.concat([Buffer.of(2), u64(bnd.issued_at_s), str16(bnd.domain), pk, sig]);
    t.eq(`${name}.${label}.blob`, b64(blob), bnd.blob_b64url);
    t.eq(`${name}.${label}.blob_len`, blob.length, bnd.blob_len);
    t.eq(`${name}.${label}.blob_len formula`, 5272 + Buffer.byteLength(bnd.domain), bnd.blob_len);
  }
  const bits = Buffer.concat([seed, sha3(seed).subarray(0, 1)]);
  t.eq(`${name}.phrase.check_byte`, hex(bits.subarray(32)), id.phrase.check_byte_hex);
  t.eq(`${name}.phrase.indices`, JSON.stringify(Array.from({ length: 24 }, (_, i) => bits11(bits, i))), JSON.stringify(id.phrase.indices));
  t.eq(`${name}.phrase.words count`, id.phrase.words.length, 24);
}
function serverKey(t, name, key) {
  t.eq(`${name}.xi`, hex(hmac3(hexToBytes(key.seed_hex), D.server)), key.xi_hex);
  const pk = unb64(key.pk_b64url);
  t.len(`${name}.pk`, pk, 1952);
  t.eq(`${name}.pk_hex`, hex(pk), key.pk_hex);
  t.eq(`${name}.fp`, base32Lower(sha3(D.fp, Buffer.of(0), pk).subarray(0, 10)), key.fp);
  return pk;
}
/** The canonical CBOR a `sig` field covers: the JSON document without `sig`. */
export function signedCbor(doc) {
  const { sig: _omitted, ...rest } = doc;
  return bytesToHex(encodeCanonical(jsonToModel(rest)));
}

export function checkIdentityKat(kat, readFixture) {
  const t = new Tally();
  for (const [name, id] of Object.entries(kat.identities)) identity(t, name, id);
  for (const [domain, s] of Object.entries(kat.servers)) {
    const pk = serverKey(t, `servers.${domain}.key`, s.key);
    const doc = readFixture(s.well_known.document);
    t.eq(`servers.${domain}.well_known.pk`, doc.server_key.pk, s.key.pk_b64url);
    t.eq(`servers.${domain}.well_known.canonical_domain`, doc.canonical_domain, domain);
    t.eq(`servers.${domain}.well_known.signed_cbor`, signedCbor(doc), s.well_known.signed_cbor_hex);
    t.len(`servers.${domain}.well_known.sig`, unb64(doc.sig), 3309);
    if (s.challenge) {
      const c = s.challenge;
      const message = ds(D.challenge, Buffer.concat([hexToBytes(c.nonce_hex), u64(c.cid), Buffer.from(c.domain)]));
      t.eq(`servers.${domain}.challenge.message`, hex(message), c.message_hex);
      t.len(`servers.${domain}.challenge.sig`, hexToBytes(c.sig_hex), 3309);
      t.len(`servers.${domain}.challenge.nonce`, hexToBytes(c.nonce_hex), 32);
    }
    void pk;
  }
  t.eq('constants.BINDING_FIXED_LEN', 1 + 8 + 2 + 1952 + 3309, kat.constants.BINDING_FIXED_LEN);
  return t;
}

export function checkSignInKat(kat, identityKat, readFixture) {
  const t = new Tally();
  const verifier = hexToBytes(kat.verifier_hex);
  const challenge = sha3(verifier);
  t.eq('challenge', hex(challenge), kat.challenge_hex);
  t.eq('challenge_b64url', b64(challenge), kat.challenge_b64url);
  const mh = sha3(ds(D.match, challenge));
  t.eq('match_phrase.hash', hex(mh), kat.match_phrase.hash_hex);
  t.eq('match_phrase.indices', JSON.stringify([0, 1, 2].map((i) => bits11(mh, i))), JSON.stringify(kat.match_phrase.indices));
  t.eq('match_phrase.words count', kat.match_phrase.words.length, 3);
  t.eq('code format', /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/.test(kat.code.example), true);
  t.eq('device rule', kat.device.value, `macbook-pro#${b64(sha3(hexToBytes(kat.device.device_sign_pk_hex)))}`);
  const a = kat.assertion;
  const pk = unb64(a.identity_pk_b64url);
  t.eq('assertion.identity is identity A', a.identity_pk_b64url, identityKat.identities.A.pk_b64url);
  t.eq('assertion.nonce is the challenge', a.nonce_hex, kat.challenge_hex);
  const body = Buffer.concat([str16(a.aud), str16(a.device), u64(a.exp_s), hexToBytes(a.nonce_hex), pk]);
  t.eq('assertion.body', hex(body), a.body_hex);
  t.eq('assertion.message', hex(ds(D.assertion, body)), a.message_hex);
  const sig = hexToBytes(a.sig_hex);
  t.len('assertion.sig', sig, 3309);
  const blob = Buffer.concat([Buffer.of(1), body, sig]);
  t.eq('assertion.blob', b64(blob), a.blob_b64url);
  t.eq('assertion.blob_len', blob.length, a.blob_len);
  serverKey(t, 'issuer.key', kat.issuer.key);
  const request = readFixture('fixtures/sign-in-with-citadel/SignInCompleteRequest/valid.json');
  t.eq('fixture request.verifier', request.verifier, b64(verifier));
  t.eq('fixture request.code', request.code, kat.code.example);
  t.eq('fixture request.device', request.device, kat.device.value);
  t.eq('fixture response.assertion', readFixture('fixtures/sign-in-with-citadel/SignInCompleteResponse/valid.json').assertion, a.blob_b64url);
  t.eq('fixture link.challenge', readFixture('fixtures/sign-in-with-citadel/SignInLink/valid-sw-mcp.json').challenge, kat.challenge_b64url);
  return t;
}

export function checkTrayKat(kat, readFixture) {
  const t = new Tally();
  t.len('publisher.pk', hexToBytes(kat.publisher.pk_hex), 1952);
  const docs = [['tab_manifest.web_panel', 'fixtures/tray-tab-manifest/valid-web-panel.json', kat.tab_manifest.web_panel_signed_cbor_hex],
    ['tab_manifest.native_panel', 'fixtures/tray-tab-manifest/valid-native-panel.json', kat.tab_manifest.native_panel_signed_cbor_hex],
    ['update_manifest', 'fixtures/update-manifest/valid-release.json', kat.update_manifest.signed_cbor_hex]];
  for (const [name, path, expected] of docs) {
    const doc = readFixture(path);
    t.eq(`${name}.signed_cbor`, signedCbor(doc), expected);
    t.eq(`${name}.publisher key`, doc.publisher.mldsa65_public_key, kat.publisher.pk_hex);
    t.len(`${name}.sig`, unb64(doc.sig), 3309);
    if (doc.icon_template_png) t.eq(`${name}.icon PNG magic`, Buffer.from(doc.icon_template_png, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  const update = readFixture('fixtures/update-manifest/valid-release.json');
  t.eq('update asset sha3', update.assets[0].sha3_256, hex(sha3(hexToBytes(kat.update_manifest.asset_bytes_hex))));
  return t;
}

export function checkSwWireKat(kat, identityKat) {
  const t = new Tally();
  t.eq('person.id_fp', kat.person.id_fp, identityKat.identities.A.id_fp);
  t.eq('person.identity_kid', kat.person.identity_kid_hex, hex(sha3(unb64(identityKat.identities.A.pk_b64url))));
  for (const role of ['device', 'controller']) t.eq(`${role}.kid`, kat[role].kid_hex, hex(sha3(hexToBytes(kat[role].sign_pk_hex))));
  t.eq('device.kem_kid', kat.device.kem_kid_hex, hex(sha3(hexToBytes(kat.device.kem_ek_hex))));
  t.len('device.kem_ek', hexToBytes(kat.device.kem_ek_hex), 1184);
  return t;
}
