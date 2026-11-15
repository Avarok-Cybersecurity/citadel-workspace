/**
 * A first-party app's committed manifest.json with its `artifact.sha256` and `.bytes` set to the
 * module's, every other field as it was. The one writer of those two fields, for the apps built by
 * build-first-party-apps.mjs and for the Calendar's glue (build-calendar-glue.mjs).
 */
export function withArtifact(text, digest, bytes) {
  const manifest = JSON.parse(text);
  manifest.artifact.sha256 = digest;
  manifest.artifact.bytes = bytes;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
