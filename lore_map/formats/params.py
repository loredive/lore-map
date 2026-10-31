"""
Paramètres des jeux (tables d'objets) : lignes d'une table PARAM, dispositions de Paramdex, numéros
d'icône, et les paramètres chiffrés du PC (Dark Souls III : Data0.bdt ; Dark Souls II :
enc_regulation.bnd.dcx), avec les clés publiées par la communauté.
"""
import re
import struct

from lore_map.formats.archives import read_bnd4, read_dcx

# clé AES des paramètres de Dark Souls III sur PC (Data0.bdt), publiée par SoulsFormats (SFUtil) et les
# éditeurs de paramètres de la communauté
DS3_REGULATION_KEY = b"ds3#jn/8_7(rsY9pg55GFN7VFL#+3n/)"
# clé AES des paramètres de Dark Souls II: Scholar of the First Sin (enc_regulation.bnd.dcx), publiée par
# SoulsFormats (SFUtil.DecryptDS2Regulation)
DS2_REGULATION_KEY = bytes([0x40, 0x17, 0x81, 0x30, 0xDF, 0x0A, 0x94, 0x54,
                            0x33, 0x09, 0xE1, 0x71, 0xEC, 0xBF, 0x25, 0x4C])
# Dark Souls III : table de paramètres -> fichier de disposition de Paramdex
DS3_LAYOUTS = {"EquipParamGoods": "EQUIP_PARAM_GOODS_ST", "EquipParamWeapon": "EQUIP_PARAM_WEAPON_ST",
               "EquipParamProtector": "EQUIP_PARAM_PROTECTOR_ST", "EquipParamAccessory": "EQUIP_PARAM_ACCESSORY_ST"}
# Dark Souls III : catégorie du texte -> (table d'objets, champs d'icône par ordre de préférence) ; les sorts
# sont des objets
DS3_ITEMS = {"goods": ("EquipParamGoods", ["iconId"]), "weapon": ("EquipParamWeapon", ["iconId"]),
             "protector": ("EquipParamProtector", ["iconIdM", "iconIdF"]),
             "accessory": ("EquipParamAccessory", ["iconId"]), "magic": ("EquipParamGoods", ["iconId"])}
# Dark Souls : table de paramètres -> fichier de disposition de Paramdex (dossier DS1), et catégorie du
# texte -> (table, champs d'icône) ; les sorts ont leur propre table
DS1_LAYOUTS = {"EquipParamGoods": "EquipParamGoods", "EquipParamWeapon": "EquipParamWeapon",
               "EquipParamProtector": "EquipParamProtector", "EquipParamAccessory": "EquipParamAccessory",
               "Magic": "MagicParam"}
DS1_ITEMS = {"goods": ("EquipParamGoods", ["iconId"]), "weapon": ("EquipParamWeapon", ["iconId"]),
             "protector": ("EquipParamProtector", ["iconIdM", "iconIdF"]),
             "accessory": ("EquipParamAccessory", ["iconId"]), "magic": ("Magic", ["iconId"])}
TYPE_SIZE = {"s8": 1, "u8": 1, "dummy8": 1, "s16": 2, "u16": 2, "s32": 4, "u32": 4, "f32": 4}


def param_rows(p: bytes) -> dict[int, int]:
    """PARAM (décalages 64 bits) : {identifiant de ligne: début de ses données}."""
    count, = struct.unpack_from("<H", p, 0x0A)
    return dict(struct.unpack_from("<i4xq", p, 0x40 + 24 * k) for k in range(count))


def param_rows_32(p: bytes) -> dict[int, int]:
    """PARAM de Dark Souls (décalages 32 bits) : {identifiant de ligne: début de ses données}."""
    count, = struct.unpack_from("<H", p, 0x0A)
    return {rid: at for rid, at, _name in (struct.unpack_from("<iII", p, 0x30 + 12 * k) for k in range(count))}


def read_regulation(raw: bytes, key: bytes) -> dict[str, bytes]:
    """Paramètres chiffrés du PC (Data0.bdt de Dark Souls III) : 16 octets d'IV, puis un DCX (BND4 de
    .param) chiffré en AES-256-CBC. {nom du fichier: contenu}."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    dec = Cipher(algorithms.AES(key), modes.CBC(raw[:16])).decryptor()
    return read_bnd4(read_dcx(dec.update(raw[16:]) + dec.finalize()))


def read_regulation_ds2(raw: bytes, key: bytes = DS2_REGULATION_KEY) -> dict[str, bytes]:
    """Paramètres chiffrés de Dark Souls II (enc_regulation.bnd.dcx) : AES-128-CTR à partir de l'octet 32,
    compteur initial 0x80, les 11 premiers octets du fichier, puis 1 ; dessous, un DCX (BND4 de .param)."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    dec = Cipher(algorithms.AES(key), modes.CTR(b"\x80" + raw[:11] + b"\0\0\0\x01")).decryptor()
    return read_bnd4(read_dcx(dec.update(raw[32:]) + dec.finalize()))


def layout_offsets(xml: str) -> tuple[dict[str, int], int]:
    """Disposition Paramdex (« s16 iconId = 6 », « u8 flag:1 », « dummy8 pad[3] ») : {nom du champ:
    décalage dans la ligne}, taille d'une ligne. Les champs de bits de même type se partagent un octet
    (ou un mot) tant qu'il reste de la place, comme dans le PARAMDEF de Bloodborne."""
    offsets, off, bit, unit = {}, 0, 0, 0
    for typ, name, count, bits in re.findall(r'Def="(\w+) (\w+)(?:\[(\d+)\])?(?::(\d+))?', xml):
        size = TYPE_SIZE[typ]
        if bits:
            if bit == 0 or size != unit or bit + int(bits) > 8 * size:
                off += unit if bit else 0
                unit, bit = size, 0
            offsets[name] = off
            bit += int(bits)
            continue
        if bit:
            off, bit = off + unit, 0
        offsets[name] = off
        off += size * int(count or 1)
    return offsets, off + (unit if bit else 0)


def icon_ids(params: dict[str, bytes], layouts: dict[str, str], wanted: dict = DS3_ITEMS,
             rows=param_rows) -> dict[str, dict[int, int]]:
    """{catégorie: {identifiant de l'objet: numéro d'icône}} (0 : pas d'icône). Une disposition qui ne
    tombe pas sur la taille des lignes arrête tout : ses décalages seraient faux. rows : param_rows_32
    pour Dark Souls."""
    out = {}
    for cat, (table, fields) in wanted.items():
        offsets, size = layout_offsets(layouts[table])
        p, at_rows = params[f"{table}.param"], rows(params[f"{table}.param"])
        starts = sorted(at_rows.values())
        if len(starts) > 1 and starts[1] - starts[0] != size:
            raise ValueError(f"{table} : lignes de {starts[1] - starts[0]} octets, la disposition en annonce {size}")
        out[cat] = {rid: next((i for i in (struct.unpack_from("<h", p, at + offsets[f])[0] for f in fields) if i > 0), 0)
                    for rid, at in at_rows.items()}
    return out
