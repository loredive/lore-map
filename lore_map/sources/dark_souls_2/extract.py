"""
Textes de Dark Souls II (Scholar of the First Sin) : lus dans les archives du jeu (copie Steam du joueur).

L'index Game/GameDataEbl.bhd est chiffré en RSA avec la clé publique livrée à côté (GameDataKeyCode.pem) ;
déchiffré, c'est un index BHD5 (formats.archives.read_bhd5_ds2) qui liste chaque fichier de GameDataEbl.bdt
par le hash de son chemin. Les textes y sont des FMG v1 isolés, en clair : /menu/text/<langue>/itemname.fmg
(noms) et detailedexplanation.fmg (descriptions), les dialogues dans talk/m<carte>.fmg (un fichier par
carte, un même personnage parfois dans plusieurs) et le prologue dans prologue.fmg. La copie occidentale
n'a pas de textes japonais : anglais (montré) et français. Rien n'est écrit dans le dossier du jeu, et le
JSON reste hors du dépôt.

Les catégories se lisent sur l'identifiant d'un objet (en millions : 1–6 armes, 11 boucliers, 21–27
armures…). Les plages 892 (autre version de quelques armures) et 900 (brouillon des textes d'armes, au
format « Weapon type: … ») ne sont pas des objets du jeu. Les dialogues des trois DLC (Crown of the
Sunken King, Old Iron King, Ivory King) viennent des cartes m50_35 à m50_37 : une réplique qui n'est que
là est marquée DLC. Un objet est du DLC si son nom anglais est dans dlc.json (les pages des trois DLC sur
le wiki darksouls.fandom.com : les archives ne séparent pas les objets du DLC). Les interlocuteurs viennent
de speakers.json (blocs d'identifiants -> nom).
Les fichiers de texte gardent aussi des objets coupés (anneaux « Illusory », robe de Rosabeth…) : seul un
objet dont la ligne, dans ItemParam (Game/enc_regulation.bnd.dcx, chiffré), a une icône est gardé ; l'icône
est le premier champ de la ligne (disposition ITEM_PARAM de Paramdex, DS2S).

Usage :
    python -m lore_map.sources.dark_souls_2.extract \\
        --game "/mnt/c/Games/Steam/steamapps/common/Dark Souls II Scholar of the First Sin/Game" \\
        --dictionary ../dark-souls-2-text/uxm/ScholarDictionary.txt --out ../dark-souls-2-text/ds2_text.json
"""
import argparse
import json
import struct
from collections import Counter
from pathlib import Path

from lore_map.formats.archives import decrypt_ranges, path_hash, read_bhd5_ds2, rsa_public_decrypt
from lore_map.formats.dialog import dialog, speaker_for
from lore_map.formats.fmg import read_fmg
from lore_map.formats.params import param_rows, read_regulation_ds2
from lore_map.games import GAMES

HERE = GAMES / "dark-souls-2"                 # les données du jeu : game.json, speakers.json…

LANGS = {"en": "english", "fr": "french"}
TALK = "会話"                      # noms des tables attendus par formats.dialog.dialog
SUBTITLES = "ムービー字幕"
DLC_MAPS = ("m50_35", "m50_36", "m50_37")      # Sunken King, Old Iron King, Ivory King
JUNK = {"no text", "none text", "(no line)", "(n/a)", "(deleted)"}     # en minuscules

# catégorie -> plages d'identifiants, en millions
CATEGORIES = {
    "weapon":    range(1, 7),
    "shield":    range(11, 12),
    "protector": range(21, 28),
    "magic":     range(31, 36),
    "ring":      range(40, 43),
    "key":       range(50, 54),
    "goods":     range(60, 65),
}


def category_of(i: int) -> str | None:
    return next((cat for cat, r in CATEGORIES.items() if i // 1_000_000 in r), None)


# ---------------------------------------------------------------- lecture
class Archive:
    """Les fichiers de GameDataEbl.bdt, par chemin."""

    def __init__(self, game: Path):
        self.bdt = game / "GameDataEbl.bdt"
        header = rsa_public_decrypt((game / "GameDataEbl.bhd").read_bytes(), (game / "GameDataKeyCode.pem").read_bytes())
        self.index = read_bhd5_ds2(header)

    def __contains__(self, path: str) -> bool:
        return path_hash(path) in self.index

    def read(self, path: str) -> bytes:
        size, offset, key, ranges = self.index[path_hash(path)]
        with open(self.bdt, "rb") as f:
            f.seek(offset)
            return decrypt_ranges(f.read(size), key, ranges)


def item_icons(game: Path) -> dict[int, int]:
    """{identifiant d'objet: icône} lus dans ItemParam ; 0 ou moins : pas d'icône."""
    item = read_regulation_ds2((game / "enc_regulation.bnd.dcx").read_bytes())["ItemParam.param"]
    return {rid: struct.unpack_from("<i", item, at)[0] for rid, at in param_rows(item).items()}


def clean(text: str) -> str:
    return "" if text.strip().lower() in JUNK else text.strip()


def fmg(archive: Archive, path: str) -> dict[int, str]:
    if path not in archive:
        return {}
    return {i: t for i, t in ((i, clean(t)) for i, t in read_fmg(archive.read(path)).items()) if t}


def talk_maps(dictionary: list[str]) -> list[str]:
    """Les cartes qui ont des dialogues (« m10_02_00_00 »), lues dans la liste des fichiers de l'anglais."""
    prefix = "/menu/text/english/talk/m"
    return sorted(p.removeprefix(prefix[:-1]).removesuffix(".fmg") for p in dictionary if p.startswith(prefix))


def load_tables(archive: Archive, maps: list[str]) -> tuple[dict, set[int]]:
    """({langue: {table: {id: texte}}}, identifiants des répliques du DLC). Tables : names, lore (objets),
    会話 (toutes les cartes réunies), ムービー字幕 (le prologue)."""
    out, seen_base, seen_dlc = {}, set(), set()
    for lang, folder in LANGS.items():
        base = f"/menu/text/{folder}"
        talk = {}
        for m in maps:
            lines = fmg(archive, f"{base}/talk/{m}.fmg")
            talk.update(lines)
            if lang == "en":
                (seen_dlc if m.startswith(DLC_MAPS) else seen_base).update(lines)
        out[lang] = {"names": fmg(archive, f"{base}/itemname.fmg"),
                     "lore": fmg(archive, f"{base}/detailedexplanation.fmg"),
                     TALK: talk, SUBTITLES: fmg(archive, f"{base}/prologue.fmg")}
    return out, seen_dlc - seen_base


# ---------------------------------------------------------------- documents
def build(tables: dict, dlc_lines: set[int], speakers: dict, icons: dict[int, int] | None = None,
          dlc_items: set[str] = frozenset()) -> dict:
    """Le JSON pour prepare.py, dans la forme du dump d'Elden Ring : {catégorie: {id: {name_en,
    caption_en, name_fr, caption_fr}}, dialog: {…}}. icons (item_icons) : un objet sans icône, que le jeu
    ne montre jamais, reste dehors."""
    en = tables["en"]
    out = {cat: {} for cat in CATEGORIES}
    for i, text in en["lore"].items():
        cat, name = category_of(i), en["names"].get(i, "")
        if cat is None or not name or text == name:
            continue                      # hors des plages du jeu, sans nom, ou rien que le nom
        if icons is not None and icons.get(i, 0) <= 0:
            continue                      # sans ligne ni icône dans ItemParam : jamais en jeu
        out[cat][str(i)] = {f"{f}_{lang}": tables[lang][t].get(i, "")
                            for lang in LANGS for f, t in (("name", "names"), ("caption", "lore"))}
        if name in dlc_items:
            out[cat][str(i)]["dlc"] = True
    # aucune réplique n'a de variante +50 pour l'autre genre (vérifié sur les fichiers du jeu)
    out["dialog"] = dialog(tables, speakers, lambda table, i: i in dlc_lines, twin=lambda first, other: False)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--game", type=Path, required=True, help="dossier Game/ du jeu (GameDataEbl.bhd, .bdt, .pem)")
    p.add_argument("--dictionary", type=Path, required=True, help="ScholarDictionary.txt d'UXM (chemins des fichiers)")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    speakers = json.loads((HERE / "speakers.json").read_text(encoding="utf-8"))
    archive = Archive(a.game)
    maps = talk_maps(a.dictionary.read_text(encoding="utf-8").splitlines())
    tables, dlc_lines = load_tables(archive, maps)
    dlc_items = {n for names in json.loads((HERE / "dlc.json").read_text(encoding="utf-8"))["crowns"].values() for n in names}
    data = build(tables, dlc_lines, speakers, item_icons(a.game), dlc_items)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for key, recs in data.items():
        n_dlc = sum(1 for r in recs.values() if r.get("dlc") or r.get("dlc_lines"))
        print(f"  {key:10} {len(recs)}  (DLC : {n_dlc})")
    who = Counter(speaker_for(i, speakers) or speakers["unknown"] for i in tables["en"][TALK])
    print(f"{sum(who.values())} répliques, {len(who)} interlocuteurs ; sans nom : {who[speakers['unknown']]}")
    print("écrit dans", a.out)


if __name__ == "__main__":
    main()
