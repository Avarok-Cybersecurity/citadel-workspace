import assert from "node:assert/strict";
import test from "node:test";
import { subsystemOf } from "./assert-pe-subsystem.mjs";

/** The smallest header this reads: MZ, a pointer to PE at 0x40, the signature, and a PE32+ optional header. */
function exe(subsystem, magic = 0x20b) {
  const bytes = Buffer.alloc(0x40 + 24 + 70);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.writeUInt32LE(0x4550, 0x40);
  bytes.writeUInt16LE(magic, 0x40 + 24);
  bytes.writeUInt16LE(subsystem, 0x40 + 24 + 68);
  return bytes;
}

test("the GUI subsystem is named windows", () => assert.equal(subsystemOf(exe(2)), "windows"));
test("the console subsystem is named console", () => assert.equal(subsystemOf(exe(3)), "console"));
test("a 32-bit header reads the same way", () => assert.equal(subsystemOf(exe(2, 0x10b)), "windows"));
test("another subsystem is reported, not guessed", () => assert.equal(subsystemOf(exe(9)), "unknown-9"));
test("a file that is not an executable is an error", () => {
  assert.throws(() => subsystemOf(Buffer.from("#!/bin/sh\n".repeat(20))), /not an MZ/);
  const noPe = exe(2);
  noPe.writeUInt32LE(0, 0x40);
  assert.throws(() => subsystemOf(noPe), /no PE header/);
});
