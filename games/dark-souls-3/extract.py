"""
Textes de Dark Souls III : extraits des archives de messages du jeu (copie Steam du joueur).

Les archives du PC sont chiffrées : le joueur les ouvre une fois avec UXM Selective Unpacker
(« Unpack », sans « Patch »), qui écrit Game/msg/<langue>/ à côté du jeu. On y lit
item_dlc2.msgbnd.dcx et menu_dlc2.msgbnd.dcx (le jeu entier, DLC compris ; même format que
Bloodborne, souls_formats.py) en anglais, japonais et français, et on écrit le JSON que lit
prepare.py. Rien n'est écrit dans le dossier du jeu ; le JSON reste hors du dépôt.

Chaque table y est en trois parts : le jeu de base, <table>_dlc1 (Ashes of Ariandel) et
<table>_dlc2 (The Ringed City). Un texte d'une part _dlc est marqué « dlc ». Les sorts sont aussi
des objets : un objet dont la description est celle d'un sort n'est gardé qu'une fois, en sort.
Les interlocuteurs des dialogues viennent de speakers.json (blocs d'identifiants -> nom).

Usage :
    uv run python games/dark-souls-3/extract.py \\
        --msg "/mnt/c/Games/Steam/steamapps/common/DARK SOULS III/Game/msg" --out ../dark-souls-3-text/ds3_text.json
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))      # souls_formats.py, à la racine du dépôt
from souls_formats import dialog, gender_twin, read_bnd4, read_dcx, read_fmg, speaker_for, unwrap  # noqa: E402

LANGS = {"en": "engus", "jp": "jpnjp", "fr": "frafr"}
ARCHIVES = ("item_dlc2", "menu_dlc2")
DLC_PARTS = ("_dlc1", "_dlc2")

# catégorie -> (table des noms, table des descriptions)
TABLES = {
    "goods":     ("アイテム名", "アイテムうんちく"),
    "weapon":    ("武器名", "武器うんちく"),
    "protector": ("防具名", "防具うんちく"),
    "accessory": ("アクセサリ名", "アクセサリうんちく"),
    "magic":     ("魔法名", "魔法うんちく"),
}
SPELLS = "magic"
# 魔法うんちく garde aussi un ancien jeu de sorts (identifiants à 4 chiffres : textes abrégés, et des sorts
# de Dark Souls 1 et 2 absents du jeu) ; les sorts du jeu ont un identifiant d'objet, à partir d'ici
SPELL_FIRST_ID = 1_000_000
DUMMY = "(dummyText)"


# ---------------------------------------------------------------- lecture
def merge_parts(files: dict[str, dict[int, str]]) -> tuple[dict[str, dict[int, str]], dict[str, set[int]]]:
    """Réunit <table>, <table>_dlc1 et <table>_dlc2 sous le nom de base : ({table: {id: texte}},
    {table: identifiants venus d'une part _dlc})."""
    tables: dict[str, dict[int, str]] = {}
    dlc: dict[str, set[int]] = {}
    for name in sorted(files, key=lambda n: n.endswith(DLC_PARTS)):      # le jeu de base d'abord
        base = next((name.removesuffix(p) for p in DLC_PARTS if name.endswith(p)), name)
        tables.setdefault(base, {}).update(files[name])
        dlc.setdefault(base, set())
        if base != name:
            dlc[base].update(files[name])
    return tables, dlc


def load_tables(msg: Path) -> tuple[dict[str, dict[str, dict[int, str]]], dict[str, set[int]]]:
    """({langue: {table: {id: texte}}}, identifiants du DLC par table, lus sur l'anglais)."""
    out, dlc = {}, {}
    for lang, folder in LANGS.items():
        files = {}
        for archive in ARCHIVES:
            for name, b in read_bnd4(read_dcx((msg / folder / f"{archive}.msgbnd.dcx").read_bytes())).items():
                files[name.removesuffix(".fmg")] = {i: unwrap(t, lang) for i, t in read_fmg(b).items()}
        out[lang], lang_dlc = merge_parts(files)
        if lang == "en":
            dlc = lang_dlc
    return out, dlc


# ---------------------------------------------------------------- documents
def build(tables: dict, dlc: dict[str, set[int]], speakers: dict) -> dict:
    """Le JSON pour prepare.py, dans la forme du dump d'Elden Ring : {catégorie: {id: {name_en,
    caption_en, …, dlc?}}, dialog: {…}}."""
    en = tables["en"]
    spells = {t for i, t in en[TABLES[SPELLS][1]].items() if i >= SPELL_FIRST_ID}
    out = {}
    for key, (names, lore) in TABLES.items():
        recs = {}
        for i in en[lore]:
            if not en[names].get(i, "").strip():
                continue                  # sans nom : une variante ou un prototype
            if key == SPELLS and i < SPELL_FIRST_ID:
                continue                  # un ancien sort, jamais en jeu
            if en[lore][i].strip() == en[names][i].strip():
                continue                  # la description n'est que le nom (« No Travel Gear / Head »)
            if key != SPELLS and en[lore][i] in spells:
                continue                  # un sort, déjà dans les sorts
            recs[str(i)] = {f"{f}_{lang}": tables[lang][t].get(i, "")
                            for lang in LANGS for f, t in (("name", names), ("caption", lore))}
            if i in dlc.get(lore, ()):
                recs[str(i)]["dlc"] = True
        out[key] = recs
    dummy = {i for i, t in en["会話"].items() if t == DUMMY}          # répliques prévues mais jamais écrites
    talk = {lang: {**t, "会話": {i: x for i, x in t["会話"].items() if i not in dummy}} for lang, t in tables.items()}
    out["dialog"] = dialog(talk, speakers, lambda table, i: i in dlc.get(table, ()), twin=gender_twin)
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--msg", type=Path, required=True, help="dossier Game/msg/ du jeu, ouvert par UXM")
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    speakers = json.loads((HERE / "speakers.json").read_text(encoding="utf-8"))
    tables, dlc = load_tables(a.msg)
    data = build(tables, dlc, speakers)
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
