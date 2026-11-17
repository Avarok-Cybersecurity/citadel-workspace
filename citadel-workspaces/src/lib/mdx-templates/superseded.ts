/**
 * Templates that shipped broken, recognised by the hash of their exact body.
 *
 * Before 2026-09-27 every template used components that exist nowhere (<SprintBoard>,
 * <TeamMembers>, ...), so a document saved straight from one cannot render. Such a document is
 * byte-identical to the old body, so its stored `mdx_content_hash` (SHA-256 of the UTF-8 bytes,
 * lib/mdx-integrity) names the template. Only those exact documents are offered the fixed
 * version; one the user edited has a different hash and is never touched. The hashes were taken
 * from the bodies at 716724de; the bodies themselves are not kept.
 */
export const SUPERSEDED_TEMPLATE_HASHES: Readonly<Record<string, string>> = {
  '1116e86e789966617a731d16c85dccb5a66ed5f298b83751a6bc748f398035dc': 'office-general',
  '72b14310a94e0ea3568aa013c5ae8df678917ebd424fb901213fd66bc549942f': 'office-engineering',
  '32b6a1971256e58681036eca0fd167c205602c4ab83caebd0dc396a2d3daa1b5': 'office-design',
  'dc99c858f007026ffbb7330953fc9cc93a6120bd821d806eb2d6a9b43058e4ce': 'office-security',
  '41685aa574ec82eb54ccac76b19dc9ef8997d6f7bdfcf4ce057a262a5c08969e': 'room-meeting',
  '5d35669b2b994e1891d44de63add310f7315db1ba3111dfdeeaa6e36ed9d30c7': 'room-projects',
  'cca5a380173524f73e243d5accfc319c6f2810dd4e794afb57f745c03827e43f': 'room-documentation',
  '6b34f3813e371fa401323c94defe6cb3dced4ee381f55830a81d7f64a5407a2e': 'room-training',
};

/** The id of the template a stored document is an unedited broken copy of, if it is one. */
export function supersededTemplateId(storedHash: string | null | undefined): string | undefined {
  return storedHash ? SUPERSEDED_TEMPLATE_HASHES[storedHash] : undefined;
}
