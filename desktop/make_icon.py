import struct
import zlib

# Placeholder app icon drawn from scratch: dark square with three rising bars.
# Replace during the brand step.
N = 1024
bg = (10, 10, 12, 255)
bar = (58, 92, 224, 255)
rows = []
for y in range(N):
    row = bytearray([0])
    for x in range(N):
        c = bg
        for i, h in enumerate((0.30, 0.50, 0.72)):
            x0 = int(N * (0.22 + i * 0.22))
            x1 = x0 + int(N * 0.14)
            y1 = int(N * 0.78)
            y0 = y1 - int(N * h)
            if x0 <= x < x1 and y0 <= y < y1:
                c = bar
        row += bytes(c)
    rows.append(bytes(row))
raw = b"".join(rows)


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
open("icon-source.png", "wb").write(png)
print(len(png))
