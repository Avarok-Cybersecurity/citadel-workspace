"""Two orientation fixtures from quadrants-48.jpg, stdlib only:
  quadrants-48-exif6.jpg  the same JPEG with an Exif segment saying Orientation 6 (turn 90 CW)
  turned-6.dng            a little-endian TIFF/DNG whose first directory also says Orientation 6
                          and points at that JPEG as its preview (JPEGInterchangeFormat)
A preview drawn upright once shows blue top-left; turned twice (the file's tag and the JPEG's
own) it shows white there. Usage: python3 gen-turned.py <fixtures dir>"""
import struct
import sys
from pathlib import Path

out = Path(sys.argv[1])
jpeg = (out / "quadrants-48.jpg").read_bytes()
assert jpeg[:2] == b"\xff\xd8"

# Exif APP1: "Exif\0\0" then a TIFF with one directory holding Orientation (0x0112, SHORT) = 6.
tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHIHH", 0x0112, 3, 1, 6, 0) + struct.pack("<I", 0)
payload = b"Exif\x00\x00" + tiff
app1 = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
exif6 = jpeg[:2] + app1 + jpeg[2:]
(out / "quadrants-48-exif6.jpg").write_bytes(exif6)

# DNG: header, IFD0 at 8 (entries sorted by tag), the JPEG after it.
entries = [(0x0100, 3, 1, 48), (0x0101, 3, 1, 48), (0x0112, 3, 1, 6), (0x0201, 4, 1, None), (0x0202, 4, 1, len(exif6))]
ifd_len = 2 + 12 * len(entries) + 4
data_at = 8 + ifd_len
ifd = struct.pack("<H", len(entries))
for tag, kind, count, value in entries:
    value = data_at if value is None else value
    packed = struct.pack("<HH", value, 0) if kind == 3 else struct.pack("<I", value)
    ifd += struct.pack("<HHI", tag, kind, count) + packed
ifd += struct.pack("<I", 0)
(out / "turned-6.dng").write_bytes(b"II*\x00" + struct.pack("<I", 8) + ifd + exif6)
