"""Textures des jeux sur PC (lore_map.formats.textures) : un TPF fabriqué dans la disposition du jeu."""
import struct

from lore_map.formats.textures import read_tpf


def make_tpf(textures):
    """TPF du PC : en-tête de 0x10 octets, entrées de 20 octets, noms Shift-JIS, puis les fichiers DDS."""
    names = [n.encode("shift_jis") + b"\0" for n in textures]
    names_at = 0x10 + 20 * len(textures)
    data_at = names_at + sum(map(len, names))
    head = b"TPF\0" + struct.pack("<ii", sum(map(len, textures.values())), len(textures)) + b"\x00\x03\x02\x00"
    entries, at, name_at = b"", data_at, names_at
    for dds, name in zip(textures.values(), names):
        entries += struct.pack("<IiBBBBII", at, len(dds), 0, 0, 1, 0, name_at, 0)
        at += len(dds)
        name_at += len(name)
    return head + entries + b"".join(names) + b"".join(textures.values())


def test_tpf_lists_each_dds_by_its_texture_name():
    tpf = make_tpf({"HQ_WP_IC_0001000000": b"DDS dagger", "アイコン": b"DDS icon"})
    assert read_tpf(tpf) == {"HQ_WP_IC_0001000000": b"DDS dagger", "アイコン": b"DDS icon"}


def test_anything_else_is_refused():
    try:
        read_tpf(b"BND4" + bytes(12))
    except ValueError:
        return
    raise AssertionError("un fichier qui n'est pas un TPF doit être refusé")
