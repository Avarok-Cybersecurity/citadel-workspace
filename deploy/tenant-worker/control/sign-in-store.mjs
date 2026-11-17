/**
 * D1 state of "Sign in with Citadel" (migrations/0019_sign_in.sql): attempts and one-time codes.
 * Every decision is the issuer's (sign-in-issuer.mjs); this module only reads and writes, and makes
 * the two single-use transitions -- an attempt proven, a code used -- one conditional UPDATE each,
 * so two concurrent requests cannot both win.
 */

const ATTEMPT_COLUMNS = "attempt, nonce, client, aud, challenge, return_url, state, created_at, proven, failures";
const CODE_COLUMNS = "code_hash, challenge, aud, identity_pk, issued_at, used, failures";

export class SignInStore {
  constructor(db) {
    this.db = db;
  }

  /** Stores a new attempt, first deleting every attempt created at or before `purgeBefore`. */
  async addAttempt(a, purgeBefore) {
    await this.db.batch([
      this.db.prepare("DELETE FROM sign_in_attempts WHERE created_at <= ?").bind(purgeBefore),
      this.db
        .prepare(`INSERT INTO sign_in_attempts (${ATTEMPT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`)
        .bind(a.attempt, a.nonce, a.client, a.aud, a.challenge, a.return_url, a.state, a.created_at),
    ]);
  }

  /** The attempt, or null. */
  attempt(id) {
    return this.db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM sign_in_attempts WHERE attempt = ?`).bind(id).first();
  }

  /** Counts a failed proof; at `burnAt` failures the attempt is deleted. */
  async attemptFailed(id, burnAt) {
    await this.db.batch([
      this.db.prepare("UPDATE sign_in_attempts SET failures = failures + 1 WHERE attempt = ?").bind(id),
      this.db.prepare("DELETE FROM sign_in_attempts WHERE attempt = ? AND failures >= ?").bind(id, burnAt),
    ]);
  }

  /** Marks the attempt proven. False when another request already did (or it was burnt). */
  async markProven(id) {
    const r = await this.db.prepare("UPDATE sign_in_attempts SET proven = 1 WHERE attempt = ? AND proven = 0").bind(id).run();
    return r.meta.changes === 1;
  }

  /** Stores a new code, first deleting every code issued at or before `purgeBefore`. */
  async addCode(c, purgeBefore) {
    await this.db.batch([
      this.db.prepare("DELETE FROM sign_in_codes WHERE issued_at <= ?").bind(purgeBefore),
      this.db
        .prepare(`INSERT INTO sign_in_codes (${CODE_COLUMNS}) VALUES (?, ?, ?, ?, ?, 0, 0)`)
        .bind(c.code_hash, c.challenge, c.aud, c.identity_pk, c.issued_at),
    ]);
  }

  /** The code's record, or null. */
  code(codeHash) {
    return this.db.prepare(`SELECT ${CODE_COLUMNS} FROM sign_in_codes WHERE code_hash = ?`).bind(codeHash).first();
  }

  /** Counts a failed completion; at `burnAt` failures the code is deleted. */
  async codeFailed(codeHash, burnAt) {
    await this.db.batch([
      this.db.prepare("UPDATE sign_in_codes SET failures = failures + 1 WHERE code_hash = ?").bind(codeHash),
      this.db.prepare("DELETE FROM sign_in_codes WHERE code_hash = ? AND failures >= ?").bind(codeHash, burnAt),
    ]);
  }

  /** Marks the code used. False when another request already did (or it was burnt). */
  async markUsed(codeHash) {
    const r = await this.db.prepare("UPDATE sign_in_codes SET used = 1 WHERE code_hash = ? AND used = 0").bind(codeHash).run();
    return r.meta.changes === 1;
  }
}
