-- "Sign in with Citadel" (control/sign-in-issuer.mjs; contract sign-in-with-citadel.md §1a, §4).
--
-- An attempt is drawn at /sign-in/begin and proven at most once within 300 s; five failed proofs
-- burn it (the row is deleted). A code is drawn when an attempt is proven; it is single use within
-- 600 s, and five failed completions burn it. Only the code's SHA3-256 is stored: the code is a
-- bearer secret (with the verifier the client holds), the attempt id is not (its proof is signed).
--
-- Rows outlive their TTL by the store's retention so an expired one is answered "expired" rather
-- than "unknown"; each begin and each prove deletes the rows past it, as support_nonces are.
CREATE TABLE sign_in_attempts (
  attempt     TEXT    NOT NULL PRIMARY KEY CHECK (length(attempt) BETWEEN 22 AND 43),
  nonce       TEXT    NOT NULL CHECK (length(nonce) = 43),
  client      TEXT    NOT NULL,
  aud         TEXT    NOT NULL,
  challenge   TEXT    NOT NULL CHECK (length(challenge) = 43),
  return_url  TEXT    NOT NULL,
  state       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  proven      INTEGER NOT NULL CHECK (proven IN (0, 1)),
  failures    INTEGER NOT NULL CHECK (failures >= 0)
);
CREATE INDEX sign_in_attempts_created ON sign_in_attempts (created_at);

CREATE TABLE sign_in_codes (
  code_hash   TEXT    NOT NULL PRIMARY KEY CHECK (length(code_hash) = 64),
  challenge   TEXT    NOT NULL CHECK (length(challenge) = 43),
  aud         TEXT    NOT NULL,
  identity_pk TEXT    NOT NULL,
  issued_at   INTEGER NOT NULL,
  used        INTEGER NOT NULL CHECK (used IN (0, 1)),
  failures    INTEGER NOT NULL CHECK (failures >= 0)
);
CREATE INDEX sign_in_codes_issued ON sign_in_codes (issued_at);
