"""Formats de Dark Souls (Prepare to Die Edition), sur de petits fichiers fabriqués dans la même
disposition que ceux du jeu : index BHD5 des archives dvdbnd, BND3, FMG version 1."""
import struct

from test_bloodborne_extract import make_dcx

from souls_formats import path_hash, read_bhd5, read_bnd3, read_dcx, read_fmg


def make_fmg1(entries):
    """FMG v1 : comme la v2 (make_fmg), mais des positions sur 32 bits et des groupes de 12 octets."""
    ids = sorted(entries)
    groups, start = [], 0
    for k in range(1, len(ids) + 1):
        if k == len(ids) or ids[k] != ids[k - 1] + 1:
            groups.append((start, ids[start], ids[k - 1]))
            start = k
    offsets_at = 0x1C + 12 * len(groups)
    at = offsets_at + 4 * len(ids)
    blobs, offsets = [], []
    for i in ids:
        b = entries[i].encode("utf-16-le") + b"\0\0"
        offsets.append(at if entries[i] else 0)       # une entrée vide n'a pas de texte
        if entries[i]:
            blobs.append(b)
            at += len(b)
    out = bytearray(b"\0\0\x01\0") + struct.pack("<i", at) + b"\x01\0\0\0"
    out += struct.pack("<iiii", len(groups), len(ids), offsets_at, 0)
    for index, first, last in groups:
        out += struct.pack("<iii", index, first, last)
    out += struct.pack(f"<{len(ids)}i", *offsets) + b"".join(blobs)
    return bytes(out)


def make_bnd3(files):
    """BND3 au format 0x74 (comme les msgbnd du jeu) : entrées de 0x18 octets, noms Shift-JIS."""
    names = [f"N:\\FRPG\\data\\Msg\\Data_ENGLISH\\{n}".encode("shift_jis") + b"\0" for n in files]
    names_at = 0x20 + 0x18 * len(files)
    data_at = names_at + sum(map(len, names))
    head = bytearray(b"BND3" + b"07D7R6\0\0") + bytes([0x74, 0, 0, 0]) + struct.pack("<i", len(files))
    head += struct.pack("<i", data_at) + bytes(8)
    entries, at, name_at = bytearray(), data_at, names_at
    for content, name in zip(files.values(), names):
        entries += struct.pack("<B3xIIiIi", 0x40, len(content), at, 0, name_at, len(content))
        at += len(content)
        name_at += len(name)
    return bytes(head + entries + b"".join(names) + b"".join(files.values()))


def make_bhd5(files):
    """Index BHD5 (petit-boutiste, non chiffré) : {chemin: (taille, position)}, en deux seaux."""
    buckets = [[], []]
    for path, (size, offset) in files.items():
        buckets[path_hash(path) % 2].append((path_hash(path), size, offset))
    entries_at = 0x18 + 8 * len(buckets)
    head = bytearray(b"BHD5" + b"\xff\0\0\0" + struct.pack("<iiii", 1, 0, len(buckets), 0x18))
    table, entries, at = bytearray(), bytearray(), entries_at
    for b in buckets:
        table += struct.pack("<ii", len(b), at)
        for h, size, offset in b:
            entries += struct.pack("<IIII", h, size, offset, 0)
        at += 16 * len(b)
    return bytes(head + table + entries)


def test_path_hash_is_the_games_hash_of_the_lowercased_path():
    # h = h * 37 + caractère, sur 32 bits ; la casse et le sens des barres ne comptent pas
    assert path_hash("/a") == (ord("/") * 37 + ord("a"))
    assert path_hash("/MSG/English/item.msgbnd.dcx") == path_hash("\\msg\\english\\item.msgbnd.dcx")
    assert path_hash("/" + "z" * 20) < 2 ** 32


def test_bhd5_lists_each_file_by_the_hash_of_its_path():
    index = read_bhd5(make_bhd5({"/msg/ENGLISH/item.msgbnd.dcx": (120, 4096), "/sound/frpg_main.fev": (7, 0)}))
    assert index == {path_hash("/msg/ENGLISH/item.msgbnd.dcx"): (120, 4096), path_hash("/sound/frpg_main.fev"): (7, 0)}


def test_reads_texts_through_dcx_bnd3_and_fmg_version_1():
    fmg = make_fmg1({10: "Dagger", 11: "Straight Sword Hilt", 12: "", 300: "Estus Flask"})
    files = read_bnd3(read_dcx(make_dcx(make_bnd3({"武器名.fmg": fmg, "空.fmg": make_fmg1({1: "x"})}))))
    assert set(files) == {"武器名.fmg", "空.fmg"}
    assert read_fmg(files["武器名.fmg"]) == {10: "Dagger", 11: "Straight Sword Hilt", 300: "Estus Flask"}
