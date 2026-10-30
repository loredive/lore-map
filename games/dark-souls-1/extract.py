"""
Textes de Dark Souls (Prepare to Die Edition) : lus dans les archives du jeu (copie Steam du joueur).

Les archives DATA/dvdbnd<n>.bdt ne sont pas chiffrées : leur index dvdbnd<n>.bhd5 liste chaque
fichier par le hash de son chemin (souls_formats.read_bhd5), et on y lit /msg/<LANGUE>/item.msgbnd.dcx
et menu.msgbnd.dcx (DCX -> BND3 -> FMG v1) en anglais, japonais et français, sans rien décompresser
sur le disque. On écrit le JSON que lit prepare.py ; rien n'est écrit dans le dossier du jeu, et le JSON
reste hors du dépôt.

Chaque table a une part <table>パッチ (le correctif d'Artorias of the Abyss) : une entrée qui y est seule
vient du DLC et est marquée « dlc » ; une entrée qui est aussi dans le jeu de base en est la correction
et la remplace. Les sorts sont aussi des objets : un objet dont la description est celle d'un sort, ou
qui porte son nom (« Sorcery: Crystal Soul Spear »), n'est gardé qu'une fois, en sort. Les descriptions
d'armes commencent par leur type et leur type d'attaque, retirés.
Les fichiers de texte gardent aussi des textes absents du jeu (anneaux et objets coupés) : seul un texte
dont la ligne, dans les tables d'objets du jeu (/param/GameParam/GameParam.parambnd.dcx), a une icône
est gardé ; la disposition de ces lignes vient de Paramdex (icons.py --download).
Les interlocuteurs des dialogues viennent de speakers.json (blocs d'identifiants -> nom).

Usage :
    python games/dark-souls-1/icons.py --download ../dark-souls-1-text/paramdex
    python games/dark-souls-1/extract.py --paramdex ../dark-souls-1-text/paramdex \\
        --data "/mnt/c/Games/Steam/steamapps/common/Dark Souls Prepare to Die Edition/DATA" \\
        --out ../dark-souls-1-text/ds1_text.json
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))      # souls_formats.py, à la racine du dépôt
from souls_formats import (  # noqa: E402
    DS1_ITEMS,
    DS1_LAYOUTS,
    dialog,
    gender_twin,
    icon_ids,
    param_rows_32,
    path_hash,
    read_bhd5,
    read_bnd3,
    read_dcx,
    read_fmg,
    speaker_for,
    unwrap,
)

LANGS = {"en": "ENGLISH", "jp": "JAPANESE", "fr": "FRENCH"}
ARCHIVES = ("item", "menu")
PATCH = "パッチ"

# catégorie -> (table des noms, table des descriptions)
TABLES = {
    "goods":     ("アイテム名", "アイテムうんちく"),
    "weapon":    ("武器名", "武器うんちく"),
    "protector": ("防具名", "防具うんちく"),
    "accessory": ("アクセサリ名", "アクセサリうんちく"),
    "magic":     ("魔法名", "魔法うんちく"),
}
SPELLS = "magic"
JUNK = {"For Test"}                    # textes de test laissés dans les tables
SPELL_ITEM = re.compile(r"^(Sorcery|Pyromancy|Miracle): ")       # un objet qui porte le nom d'un sort
# les deux lignes de jeu en tête d'une description d'arme (« Weapon type: … », « Type d'arme : … »)
GAMEPLAY_LINE = re.compile(r"^\s*(Weapon type|Attack type|Type d'arme|Type d'attaque|武器種別|攻撃属性)\s*[:：].*$",
                           re.M)


# ---------------------------------------------------------------- lecture
class Archives:
    """Les fichiers des archives dvdbnd du jeu, par chemin."""

    def __init__(self, data: Path):
        self.data = data
        self.index = {h: (n, *entry) for n in range(4)
                      for h, entry in read_bhd5((data / f"dvdbnd{n}.bhd5").read_bytes()).items()}

    def read(self, path: str) -> bytes:
        n, size, offset = self.index[path_hash(path)]
        with open(self.data / f"dvdbnd{n}.bdt", "rb") as f:
            f.seek(offset)
            return f.read(size)


def merge_patch(files: dict[str, dict[int, str]]) -> tuple[dict[str, dict[int, str]], dict[str, set[int]]]:
    """Réunit <table> et <table>パッチ sous le nom de base, la correction l'emportant : ({table: {id: texte}},
    {table: identifiants qui ne sont que dans la part パッチ, ceux du DLC})."""
    tables: dict[str, dict[int, str]] = {}
    dlc: dict[str, set[int]] = {}
    for name in sorted(files, key=lambda n: n.endswith(PATCH)):          # le jeu de base d'abord
        base = name.removesuffix(PATCH)
        if base != name:
            dlc.setdefault(base, set()).update(set(files[name]) - set(tables.get(base, {})))
        tables.setdefault(base, {}).update(files[name])
        dlc.setdefault(base, set())
    return tables, dlc


def load_tables(archives: Archives) -> tuple[dict[str, dict[str, dict[int, str]]], dict[str, set[int]]]:
    """({langue: {table: {id: texte}}}, identifiants du DLC par table, lus sur l'anglais)."""
    out, dlc = {}, {}
    for lang, folder in LANGS.items():
        files = {}
        for archive in ARCHIVES:
            raw = archives.read(f"/msg/{folder}/{archive}.msgbnd.dcx")
            for name, b in read_bnd3(read_dcx(raw)).items():
                files[name.removesuffix(".fmg")] = {i: unwrap(t, lang) for i, t in read_fmg(b).items()}
        out[lang], lang_dlc = merge_patch(files)
        if lang == "en":
            dlc = lang_dlc
    return out, dlc


def shown_items(archives: Archives, paramdex: Path) -> dict[str, set[int]]:
    """{catégorie: identifiants des objets que le jeu montre}, ceux dont la ligne a une icône."""
    params = read_bnd3(read_dcx(archives.read("/param/GameParam/GameParam.parambnd.dcx")))
    layouts = {t: (paramdex / f"{n}.xml").read_text(encoding="utf-8-sig") for t, n in DS1_LAYOUTS.items()}
    return {cat: {i for i, n in ids.items() if n}
            for cat, ids in icon_ids(params, layouts, DS1_ITEMS, rows=param_rows_32).items()}


# ---------------------------------------------------------------- documents
def lore_only(text: str) -> str:
    """La description sans les lignes de jeu d'une arme (type, type d'attaque)."""
    return GAMEPLAY_LINE.sub("", text).strip()


def build(tables: dict, dlc: dict[str, set[int]], speakers: dict, shown: dict[str, set[int]] | None = None) -> dict:
    """Le JSON pour prepare.py, dans la forme du dump d'Elden Ring : {catégorie: {id: {name_en,
    caption_en, …, dlc?}}, dialog: {…}}. shown (shown_items) : un texte que le jeu ne montre jamais
    reste dehors."""
    en = tables["en"]
    spells = {lore_only(t) for t in en[TABLES[SPELLS][1]].values()}
    spell_names = set(en[TABLES[SPELLS][0]].values())
    out = {}
    for key, (names, lore) in TABLES.items():
        recs = {}
        for i in en[lore]:
            text = lore_only(en[lore][i])
            if not en[names].get(i, "").strip():
                continue                  # sans nom : une variante ou un prototype
            if shown is not None and i not in shown[key]:
                continue                  # sans ligne ni icône dans les tables du jeu : jamais en jeu
            if text in JUNK or text == en[names][i].strip():
                continue                  # un texte de test, ou rien que le nom
            if key != SPELLS and (text in spells or SPELL_ITEM.sub("", en[names][i]) in spell_names):
                continue                  # un sort, déjà dans les sorts (« Sorcery: Soul Arrow »)
            recs[str(i)] = {f"{f}_{lang}": (lore_only(tables[lang][t].get(i, "")) if f == "caption"
                                            else tables[lang][t].get(i, ""))
                            for lang in LANGS for f, t in (("name", names), ("caption", lore))}
            if i in dlc.get(lore, ()):
                recs[str(i)]["dlc"] = True
        out[key] = recs
    talk = {lang: {**t, "会話": {i: x for i, x in t["会話"].items() if x not in JUNK}} for lang, t in tables.items()}
    out["dialog"] = dialog(talk, speakers, lambda table, i: i in dlc.get(table, ()), twin=gender_twin)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--data", type=Path, required=True, help="dossier DATA/ du jeu (dvdbnd*.bhd5 et .bdt)")
    p.add_argument("--paramdex", type=Path, required=True, help="dispositions écrites par icons.py --download")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    speakers = json.loads((HERE / "speakers.json").read_text(encoding="utf-8"))
    archives = Archives(a.data)
    tables, dlc = load_tables(archives)
    data = build(tables, dlc, speakers, shown_items(archives, a.paramdex))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for key, recs in data.items():
        n_dlc = sum(1 for r in recs.values() if r.get("dlc") or r.get("dlc_lines"))
        print(f"  {key:10} {len(recs)}  (DLC : {n_dlc})")
    who = Counter(speaker_for(i, speakers) or speakers["unknown"] for i in tables["en"]["会話"])
    print(f"{sum(who.values())} répliques, {len(who)} interlocuteurs ; sans nom : {who[speakers['unknown']]}")
    print("écrit dans", a.out)


if __name__ == "__main__":
    main()
