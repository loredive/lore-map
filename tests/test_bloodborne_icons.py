"""Décodage des illustrations de Bloodborne : ordre des tuiles PS4 et disposition des paramètres."""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "games" / "bloodborne"))
from icons import deswizzle, morton, paramdef_offsets  # noqa: E402


def test_morton_interleaves_bits():
    assert [morton(i) for i in range(8)] == [(0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (3, 0), (2, 1), (3, 1)]


def test_deswizzle_puts_tiled_blocks_back_in_rows():
    # une image de 10 × 3 blocs, rangée en tuiles de 8 × 8 (deux tuiles, bourrées), un octet par bloc
    bw, bh = 10, 3
    tiled = bytearray(2 * 64)
    for t, tx in enumerate((0, 8)):
        for i in range(64):
            x, y = morton(i)
            if tx + x < bw and y < bh:
                tiled[64 * t + i] = (y * bw + tx + x) % 256
    assert deswizzle(bytes(tiled), bw, bh, block=1) == bytes(range(bw * bh))


def _paramdef(fields):
    """PARAMDEF v201 minimal : (type, nom, octets)."""
    size = 208
    head = bytearray(0x38)
    struct.pack_into("<HH", head, 8, len(fields), size)
    struct.pack_into("<q", head, 0x30, 0x38)
    body = bytearray()
    for typ, name, nbytes in fields:
        f = bytearray(size)
        struct.pack_into("<i", f, 100, nbytes)
        f[112:112 + len(typ)] = typ.encode()
        f[144:144 + len(name)] = name.encode()
        body += f
    return bytes(head + body)


def test_bit_fields_share_a_byte_before_the_next_field():
    d = _paramdef([("s32", "refId", 4), ("u8", "a:1", 1), ("u8", "b:1", 1), ("u8", "c:6", 1),
                   ("u8", "d:1", 1), ("u16", "iconId", 2)])
    offsets, size = paramdef_offsets(d)
    assert offsets["a"] == offsets["b"] == offsets["c"] == 4      # 8 bits : un octet
    assert offsets["d"] == 5 and offsets["iconId"] == 6 and size == 8
