"""
Formats des textes des jeux FromSoftware (Bloodborne, Dark Souls III…) et dialogues par interlocuteur.

Archives de messages : DCX « DFLT » (zlib) -> BND4 -> tables FMG v2. Les dialogues (会話.fmg) sont
rangés par blocs d'identifiants, un par personnage, sans nom : speakers.json (propre à chaque jeu)
nomme les blocs, et dialog() écrit les répliques dans la forme du dump d'Elden Ring, que lit prepare.py.
Utilisé par games/<jeu>/extract.py.
"""
import re
import struct
import zlib

# clé AES des paramètres de Dark Souls III sur PC (Data0.bdt), publiée par SoulsFormats (SFUtil) et les
# éditeurs de paramètres de la communauté
DS3_REGULATION_KEY = b"ds3#jn/8_7(rsY9pg55GFN7VFL#+3n/)"
# Dark Souls III : table de paramètres -> fichier de disposition de Paramdex
DS3_LAYOUTS = {"EquipParamGoods": "EQUIP_PARAM_GOODS_ST", "EquipParamWeapon": "EQUIP_PARAM_WEAPON_ST",
               "EquipParamProtector": "EQUIP_PARAM_PROTECTOR_ST", "EquipParamAccessory": "EQUIP_PARAM_ACCESSORY_ST"}
# Dark Souls III : catégorie du texte -> (table d'objets, champs d'icône par ordre de préférence) ; les sorts
# sont des objets
DS3_ITEMS = {"goods": ("EquipParamGoods", ["iconId"]), "weapon": ("EquipParamWeapon", ["iconId"]),
             "protector": ("EquipParamProtector", ["iconIdM", "iconIdF"]),
             "accessory": ("EquipParamAccessory", ["iconId"]), "magic": ("EquipParamGoods", ["iconId"])}
TYPE_SIZE = {"s8": 1, "u8": 1, "dummy8": 1, "s16": 2, "u16": 2, "s32": 4, "u32": 4, "f32": 4}
SUBTITLES_SPEAKER = "Cutscenes"
GENDER_OFFSET = 50                 # réplique adressée à une chasseuse : celle d'un chasseur + 50
GENDER_WORDS = 3                   # au plus autant de mots changés entre une réplique et sa jumelle (him/her…)


# ---------------------------------------------------------------- formats
def read_dcx(raw: bytes) -> bytes:
    """DCX « DFLT » : en-tête de 0x4C octets puis un flux zlib."""
    if raw[:4] != b"DCX\0" or raw[0x28:0x2C] != b"DFLT":
        raise ValueError("DCX DFLT attendu")
    size, = struct.unpack_from(">I", raw, 0x1C)
    data = zlib.decompress(raw[0x4C:])
    if len(data) != size:
        raise ValueError(f"DCX : {len(data)} octets décompressés, {size} annoncés")
    return data


def read_bnd4(data: bytes) -> dict[str, bytes]:
    """BND4 (petit-boutiste, noms UTF-16) : {nom de fichier sans chemin: contenu}."""
    if data[:4] != b"BND4":
        raise ValueError("BND4 attendu")
    count, = struct.unpack_from("<i", data, 0x0C)
    entry_size, = struct.unpack_from("<q", data, 0x20)
    files = {}
    for k in range(count):
        o = 0x40 + k * entry_size
        size, = struct.unpack_from("<q", data, o + 8)
        offset, _id, name_at = struct.unpack_from("<Iii", data, o + 24)
        files[_utf16(data, name_at).split("\\")[-1]] = data[offset:offset + size]
    return files


def read_fmg(b: bytes) -> dict[int, str]:
    """FMG v2 : {identifiant: texte} ; les entrées vides sont omises."""
    groups, strings = struct.unpack_from("<ii", b, 0x0C)
    offsets_at, = struct.unpack_from("<q", b, 0x18)
    offsets = struct.unpack_from(f"<{strings}q", b, offsets_at)
    out = {}
    for g in range(groups):
        index, first, last = struct.unpack_from("<iii", b, 0x28 + 16 * g)
        for k, i in enumerate(range(first, last + 1)):
            if offsets[index + k]:
                text = _utf16(b, offsets[index + k])
                if text.strip():
                    out[i] = text
    return out


def _utf16(b: bytes, at: int) -> str:
    end = at
    while b[end:end + 2] != b"\0\0":
        end += 2
    return b[at:end].decode("utf-16-le")


def unwrap(text: str, lang: str) -> str:
    """Le jeu coupe ses textes à la main pour la largeur de sa fenêtre : un retour à la ligne seul
    devient une espace (rien en japonais, qui n'en met pas entre les mots) ; une ligne vide
    sépare toujours deux paragraphes."""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t\u00a0]+\n", "\n", text)
    return re.sub(r"(?<!\n)\n(?!\n)", "" if lang == "jp" else " ", text)



# ---------------------------------------------------------------- paramètres
def param_rows(p: bytes) -> dict[int, int]:
    """PARAM (décalages 64 bits) : {identifiant de ligne: début de ses données}."""
    count, = struct.unpack_from("<H", p, 0x0A)
    return dict(struct.unpack_from("<i4xq", p, 0x40 + 24 * k) for k in range(count))


def read_regulation(raw: bytes, key: bytes) -> dict[str, bytes]:
    """Paramètres chiffrés du PC (Data0.bdt de Dark Souls III) : 16 octets d'IV, puis un DCX (BND4 de
    .param) chiffré en AES-256-CBC. {nom du fichier: contenu}."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    dec = Cipher(algorithms.AES(key), modes.CBC(raw[:16])).decryptor()
    return read_bnd4(read_dcx(dec.update(raw[16:]) + dec.finalize()))


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


def icon_ids(params: dict[str, bytes], layouts: dict[str, str], wanted: dict = DS3_ITEMS) -> dict[str, dict[int, int]]:
    """{catégorie: {identifiant de l'objet: numéro d'icône}} (0 : pas d'icône). Une disposition qui ne
    tombe pas sur la taille des lignes arrête tout : ses décalages seraient faux."""
    out = {}
    for cat, (table, fields) in wanted.items():
        offsets, size = layout_offsets(layouts[table])
        p, rows = params[f"{table}.param"], param_rows(params[f"{table}.param"])
        starts = sorted(rows.values())
        if len(starts) > 1 and starts[1] - starts[0] != size:
            raise ValueError(f"{table} : lignes de {starts[1] - starts[0]} octets, la disposition en annonce {size}")
        out[cat] = {rid: next((i for i in (struct.unpack_from("<h", p, at + offsets[f])[0] for f in fields) if i > 0), 0)
                    for rid, at in rows.items()}
    return out


# ---------------------------------------------------------------- dialogues
def speaker_for(i: int, speakers: dict) -> str | None:
    """Nom de l'interlocuteur d'une réplique : un sous-bloc de 100 identifiants l'emporte sur
    son bloc de 10 000 (dans les blocs du DLC, plusieurs personnages se partagent un bloc)."""
    return speakers["sub_blocks"].get(str(i // 100)) or speakers["blocks"].get(str(i // 10000))


def drop_repeated_runs(ids: list[int], tables: dict) -> list[int]:
    """Le jeu range certaines conversations plusieurs fois (une par situation) : une suite d'au
    moins deux répliques déjà dites par le même personnage est retirée ; une réplique isolée
    déjà dite (« Oh... ») reste à sa place. Comparées dans la langue affichée (l'anglais)."""
    def text(i):
        return tables["en"]["会話"][i]
    seen, repeat = set(), []
    for i in ids:
        repeat.append(text(i) in seen)
        seen.add(text(i))
    return [i for k, i in enumerate(ids)
            if not (repeat[k] and ((k > 0 and repeat[k - 1]) or (k + 1 < len(ids) and repeat[k + 1])))]


def gender_twin(first: str | None, other: str) -> bool:
    """La réplique +50 n'est que la variante de la première pour l'autre genre : même nombre de mots,
    au plus GENDER_WORDS changés (« himself » / « herself »). Sinon, c'est une autre réplique."""
    if first is None:
        return False
    a, b = first.split(), other.split()
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= GENDER_WORDS


def dialog(tables: dict, speakers: dict, new=lambda table, i: False,
           twin=lambda first, other: first is not None) -> dict:
    """Répliques regroupées par interlocuteur, au format du dump d'Elden Ring
    (« [id] texte<br/><br/>[id] texte », info_en, info_fr…), que dialog_docs de prepare.py découpe
    en passages. L'interlocuteur se lit sur les identifiants anglais, les mêmes dans chaque langue."""
    by_speaker: dict[str, list[int]] = {}
    talk = tables["en"]["会話"]
    for i in sorted(talk):
        # chaque réplique existe pour un chasseur (…00–…49) et pour une chasseuse (+50) : en
        # français, « le nouveau chasseur » / « la nouvelle chasseuse » ; on garde la première
        # twin(première, +50) : par défaut (Bloodborne), toute réplique +50 dont la première existe ;
        # gender_twin, plus stricte, ne retire que celles qui n'en diffèrent que par quelques mots
        if i % 100 >= GENDER_OFFSET and twin(talk.get(i - GENDER_OFFSET), talk[i]):
            continue
        ids = by_speaker.setdefault(speaker_for(i, speakers) or speakers["unknown"], [])
        if not ids or talk[ids[-1]] != talk[i]:      # la même réplique enregistrée deux fois de suite
            ids.append(i)
    by_speaker = {name: drop_repeated_runs(ids, tables) for name, ids in by_speaker.items()}
    by_speaker[SUBTITLES_SPEAKER] = sorted(tables["en"]["ムービー字幕"])
    out = {}
    for name, ids in by_speaker.items():
        table = "ムービー字幕" if name == SUBTITLES_SPEAKER else "会話"
        out[name] = {"name_en": f"{name} dialog",
                     **{f"info_{lang}": "<br/><br/>".join(f"[{i}] {tables[lang][table][i]}"
                                                       for i in ids if i in tables[lang][table])
                        for lang in tables}}
        dlc = [i for i in ids if new(table, i)]
        if dlc:
            out[name]["dlc_lines"] = dlc
    return out
