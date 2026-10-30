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
