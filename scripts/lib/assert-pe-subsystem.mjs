#!/usr/bin/env node
// Reads which Windows subsystem an .exe asks for, from its own header, and requires it to be the
// expected one. Runs anywhere: it reads bytes, it does not run the program.
//
//   node scripts/lib/assert-pe-subsystem.mjs <file.exe> <windows|console>
//
// "windows" is the GUI subsystem: Windows opens no console window for it. "console" opens one.
// The shipped agent must be "windows": a black terminal window that stays open for as long as
// the agent runs was the first Windows tester's first report (2026-10-04).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUBSYSTEMS = new Map([[2, "windows"], [3, "console"]]);

/** The subsystem name in a PE file's optional header ("windows", "console", or "unknown-N"). */
export function subsystemOf(bytes) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error("not an MZ executable");
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 + 70 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) throw new Error("no PE header");
  // COFF header is 20 bytes after the 4-byte signature; the optional header follows, and its
  // Subsystem field sits 68 bytes in for both PE32 and PE32+.
  const optional = pe + 24;
  const magic = bytes.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error("no optional header");
  const code = bytes.readUInt16LE(optional + 68);
  return SUBSYSTEMS.get(code) ?? `unknown-${code}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, expected] = process.argv.slice(2);
  if (!file || !SUBSYSTEMS.has(expected === "windows" ? 2 : expected === "console" ? 3 : -1)) {
    console.error("usage: assert-pe-subsystem.mjs <file.exe> <windows|console>");
    process.exit(2);
  }
  const got = subsystemOf(readFileSync(file));
  if (got !== expected) {
    console.error(`::error::${file} asks Windows for the ${got} subsystem, expected ${expected}`);
    process.exit(1);
  }
  console.log(`  ${file}: ${got} subsystem`);
}
