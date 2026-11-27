/**
 * Where the photo decoder's binary is served: a stable, unhashed URL under public/photo/, precached
 * with the app shell like the Calendar's (vite.config.ts globs every .wasm). It is fetched only when
 * the first HEIC, TIFF or camera RAW file is shown. scripts/build-photo-decode.mjs writes this URL
 * into the glue, which the vendored-pair test checks.
 */
export const PHOTO_DECODE_WASM_URL: string = '/photo/photo_decode_bg.wasm';
