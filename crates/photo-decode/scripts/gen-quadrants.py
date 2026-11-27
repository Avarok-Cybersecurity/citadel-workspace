"""A 48x48 RGB PNG of four solid quadrants: red top-left, green top-right, blue bottom-left,
white bottom-right. Each corner names one orientation, so a rotated or mirrored preview shows.
Stdlib only; every pixel is written here. Usage: python3 gen-quadrants.py <out.png>"""
import struct
import sys
import zlib

SIZE = 48
HALF = SIZE // 2
COLOURS = {(0, 0): (255, 0, 0), (1, 0): (0, 255, 0), (0, 1): (0, 0, 255), (1, 1): (255, 255, 255)}


def chunk(tag: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)


raw = bytearray()
for y in range(SIZE):
    raw.append(0)
    for x in range(SIZE):
        raw += bytes(COLOURS[(x // HALF, y // HALF)])
png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
with open(sys.argv[1], "wb") as handle:
    handle.write(png)
