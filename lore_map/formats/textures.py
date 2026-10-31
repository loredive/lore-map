"""Textures des jeux sur PC : conteneurs TPF de fichiers DDS."""
import struct


def read_tpf(d: bytes) -> dict[str, bytes]:
    """TPF du PC (Dark Souls, Dark Souls II, Dark Souls III) : {nom de la texture: fichier DDS}.
    Entrées de 20 octets : position, taille, format, type, mipmaps, drapeaux, position du nom (Shift-JIS)."""
    if d[:4] != b"TPF\0":
        raise ValueError("TPF attendu")
    count, = struct.unpack_from("<i", d, 8)
    out = {}
    for k in range(count):
        offset, size, _fmt, _type, _mips, _flags, name_at, _ = struct.unpack_from("<IiBBBBII", d, 0x10 + 20 * k)
        out[d[name_at:d.index(b"\0", name_at)].decode("shift_jis")] = d[offset:offset + size]
    return out
