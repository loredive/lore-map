"""Paramètres de Dark Souls III (souls_formats) : disposition des lignes (XML de Paramdex), paramètres
chiffrés du PC, numéros d'icône par objet, sur de petits fichiers fabriqués ici."""
import struct

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from test_bloodborne_extract import make_bnd4, make_dcx

from souls_formats import icon_ids, layout_offsets, read_regulation

LAYOUT = """<?xml version="1.0" encoding="utf-8"?>
<PARAMDEF XmlVersion="1"><Fields>
    <Field Def="s32 refId = -1" />
    <Field Def="u8 flag0:1" />
    <Field Def="u8 flag1:1" />
    <Field Def="u8 rest:6" />
    <Field Def="u8 next:1" />
    <Field Def="s16 iconId = 6" />
    <Field Def="dummy8 pad[3]" />
    <Field Def="f32 weight" />
</Fields></PARAMDEF>"""


def test_layout_offsets_pack_bit_fields_and_count_arrays():
    offsets, size = layout_offsets(LAYOUT)
    assert offsets == {"refId": 0, "flag0": 4, "flag1": 4, "rest": 4, "next": 5, "iconId": 6, "pad": 8, "weight": 11}
    assert size == 15


def make_param(rows: dict[int, bytes]) -> bytes:
    """PARAM à décalages 64 bits : en-tête, table des lignes (id, données), puis les données."""
    head = bytearray(0x40)
    struct.pack_into("<H", head, 0x0A, len(rows))
    table, data, at = b"", b"", 0x40 + 24 * len(rows)
    for rid, row in rows.items():
        table += struct.pack("<i4xq8x", rid, at + len(data))
        data += row
    return bytes(head) + table + data


def row(icon_m: int, icon_f: int = 0) -> bytes:
    """Une ligne de 6 octets : deux numéros d'icône (s16) et un remplissage."""
    return struct.pack("<hhxx", icon_m, icon_f)


def test_armor_falls_back_to_the_female_icon():
    layout = """<PARAMDEF><Fields><Field Def="s16 iconIdM" /><Field Def="s16 iconIdF" />
        <Field Def="dummy8 pad[2]" /></Fields></PARAMDEF>"""
    params = {"EquipParamProtector.param": make_param({100: row(42, 43), 101: row(0, 44), 102: row(0, 0)})}
    out = icon_ids(params, {"EquipParamProtector": layout}, {"protector": ("EquipParamProtector", ["iconIdM", "iconIdF"])})
    assert out == {"protector": {100: 42, 101: 44, 102: 0}}


def test_a_layout_that_does_not_fit_the_rows_stops():
    layout = """<PARAMDEF><Fields><Field Def="s16 iconId" /></Fields></PARAMDEF>"""      # 2 octets, lignes de 6
    params = {"EquipParamGoods.param": make_param({1: row(5), 2: row(6)})}
    try:
        icon_ids(params, {"EquipParamGoods": layout}, {"goods": ("EquipParamGoods", ["iconId"])})
    except ValueError as err:
        assert "EquipParamGoods" in str(err)
    else:
        raise AssertionError("une disposition fausse doit arrêter le script")


def test_regulation_is_decrypted_then_unpacked():
    key = b"k" * 32
    bnd = make_dcx(make_bnd4({"EquipParamGoods.param": b"PARAM"}))
    padder = padding.PKCS7(128).padder()
    plain = padder.update(bnd) + padder.finalize()
    iv = bytes(range(16))
    enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    raw = iv + enc.update(plain) + enc.finalize()
    assert read_regulation(raw, key) == {"EquipParamGoods.param": b"PARAM"}
