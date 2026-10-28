"""
Textes de Bloodborne : extraits des archives de messages du jeu (copie PS4 du joueur).

Lit msg/<langue>/item.msgbnd.dcx et menu.msgbnd.dcx (DCX « DFLT » = zlib, archive BND4, tables
de texte FMG v2) en anglais, japonais et français, et écrit le JSON que lit prepare.py, dans la
même forme que celui d'Elden Ring : {catégorie: {id: {name_en, caption_en, …}}, dialog: {…}}.
Rien n'est écrit dans le dossier du jeu ; le JSON reste hors du dépôt.

Les interlocuteurs des dialogues viennent de speakers.json (blocs d'identifiants -> nom).
Avec --base (msg/ du jeu de base, sans la mise à jour), les textes absents du jeu de base sont
marqués « dlc » : ajoutés avec The Old Hunters (le DLC et la mise à jour gratuite parue avec lui).

Usage :
    uv run python games/bloodborne/extract.py --msg "/mnt/c/PS4Games/CUSA00207-UPDATE/dvdroot_ps4/msg" \\
        --base "/mnt/c/PS4Games/CUSA00207/dvdroot_ps4/msg" --out ../bloodborne-text/bloodborne_text.json
"""
import argparse
import json
import re
import struct
import zlib
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
LANGS = {"en": "engus", "jp": "jpnjp", "fr": "frafr"}
PLACEHOLDERS = {"", "*"}
RUNE_FIRST_ID = 11000000           # dans la table des gemmes, les runes de Caryll viennent après
NOTES = range(10012000, 10013000)  # notes manuscrites, dans les textes d'événements
SUBTITLES_SPEAKER = "Cutscenes"
GENDER_OFFSET = 50                 # réplique adressée à une chasseuse : celle d'un chasseur + 50

# catégorie -> (archive, table des noms, table des descriptions, filtre sur l'identifiant)
TABLES = {
    "goods":     ("item", "アイテム名", "アイテムうんちく", None),
    "weapon":    ("item", "武器名", "武器うんちく", None),
    "protector": ("item", "防具名", "防具うんちく", None),
    "rune":      ("menu", "魔石名", "魔石うんちく", lambda i: i >= RUNE_FIRST_ID),
    "gem":       ("menu", "魔石名", "魔石うんちく", lambda i: i < RUNE_FIRST_ID),
}


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


def load_tables(msg: Path) -> dict[str, dict[str, dict[int, str]]]:
    """{langue: {table: {id: texte}}} pour les deux archives de chaque langue, textes découpés."""
    out = {}
    for lang, folder in LANGS.items():
        out[lang] = {}
        for archive in ("item", "menu"):
            files = read_bnd4(read_dcx((msg / folder / f"{archive}.msgbnd.dcx").read_bytes()))
            out[lang].update({name.removesuffix(".fmg"): {i: unwrap(t, lang) for i, t in read_fmg(b).items()}
                              for name, b in files.items()})
    return out


def load_ids(msg: Path) -> dict[str, set[int]]:
    """{table: identifiants} des textes anglais d'un dossier msg/ (le jeu de base, pour repérer le DLC)."""
    out = {}
    for archive in ("item", "menu"):
        files = read_bnd4(read_dcx((msg / LANGS["en"] / f"{archive}.msgbnd.dcx").read_bytes()))
        out.update({name.removesuffix(".fmg"): set(read_fmg(b)) for name, b in files.items()})
    return out


# ---------------------------------------------------------------- documents
def speaker_for(i: int, speakers: dict) -> str | None:
    """Nom de l'interlocuteur d'une réplique : un sous-bloc de 100 identifiants l'emporte sur
    son bloc de 10 000 (dans les blocs du DLC, plusieurs personnages se partagent un bloc)."""
    return speakers["sub_blocks"].get(str(i // 100)) or speakers["blocks"].get(str(i // 10000))


def build(tables: dict, speakers: dict, base: dict[str, set[int]] | None = None) -> dict:
    """Le JSON pour prepare.py, à partir des tables des trois langues. base : identifiants du jeu
    de base (load_ids) ; un texte qui n'y est pas reçoit "dlc": true (une réplique : dans "dlc_lines")."""
    en = tables["en"]
    new = (lambda table, i: i not in base.get(table, ())) if base is not None else (lambda table, i: False)
    out = {}
    for key, (_archive, names, lore, keep) in TABLES.items():
        recs = {}
        for i in en[lore]:
            name = en[names].get(i, "")
            if (keep and not keep(i)) or name.strip() in PLACEHOLDERS:
                continue                  # prototypes et variantes sans nom propre
            recs[str(i)] = {f"{f}_{lang}": tables[lang][t].get(i, "")
                            for lang in LANGS for f, t in (("name", names), ("caption", lore))}
            if new(lore, i):
                recs[str(i)]["dlc"] = True
        out[key] = recs
    ev = {lang: tables[lang]["イベントテキスト"] for lang in LANGS}
    out["note"] = {str(i): {**{f"caption_{lang}": ev[lang].get(i, "") for lang in LANGS},
                            **{f"name_{lang}": note_title(ev[lang].get(i, "")) for lang in LANGS},
                            **({"dlc": True} if new("イベントテキスト", i) else {})}
                   for i in sorted(ev["en"]) if i in NOTES}
    out["dialog"] = dialog(tables, speakers, new)
    return out


def note_title(text: str, words: int = 6) -> str:
    """Une note n'a pas de nom : ses premiers mots, sans l'en-tête « Handwritten scrawl: »
    (« Phrase griffonnée : »…), une première ligne qui finit par deux-points."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) > 1 and lines[0].rstrip().endswith((":", "：")):
        lines = lines[1:]
    body = " ".join(lines).split()
    if len(body) <= 2 and len(" ".join(body)) > 24:      # japonais : pas d'espaces entre les mots
        flat = " ".join(lines)
        return flat[:20] + "…"
    return " ".join(body[:words]) + ("…" if len(body) > words else "")


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


def dialog(tables: dict, speakers: dict, new=lambda table, i: False) -> dict:
    """Répliques regroupées par interlocuteur, au format du dump d'Elden Ring
    (« [id] texte<br/><br/>[id] texte », info_en, info_fr…), que dialog_docs de prepare.py découpe
    en passages. L'interlocuteur se lit sur les identifiants anglais, les mêmes dans chaque langue."""
    by_speaker: dict[str, list[int]] = {}
    talk = tables["en"]["会話"]
    for i in sorted(talk):
        # chaque réplique existe pour un chasseur (…00–…49) et pour une chasseuse (+50) : en
        # français, « le nouveau chasseur » / « la nouvelle chasseuse » ; on garde la première
        if i % 100 >= GENDER_OFFSET and i - GENDER_OFFSET in talk:
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
                        for lang in LANGS}}
        dlc = [i for i in ids if new(table, i)]
        if dlc:
            out[name]["dlc_lines"] = dlc
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--msg", type=Path, required=True, help="dossier msg/ du jeu (copie du joueur)")
    p.add_argument("--base", type=Path, help="dossier msg/ du jeu de base : ce qui n'y est pas vient du DLC")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    speakers = json.loads((HERE / "speakers.json").read_text(encoding="utf-8"))
    data = build(load_tables(a.msg), speakers, load_ids(a.base) if a.base else None)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for key, recs in data.items():
        dlc = sum(1 for r in recs.values() if r.get("dlc") or r.get("dlc_lines"))
        print(f"  {key:10} {len(recs)}" + (f"  (DLC : {dlc})" if a.base else ""))
    who = Counter(speaker_for(i, speakers) or speakers["unknown"] for i in load_tables(a.msg)["en"]["会話"])
    print(f"{sum(who.values())} répliques, {len(who)} interlocuteurs ; sans nom : {who[speakers['unknown']]}")
    print("écrit dans", a.out)


if __name__ == "__main__":
    main()
