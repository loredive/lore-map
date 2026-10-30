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
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))      # souls_formats.py, à la racine du dépôt
from souls_formats import (  # noqa: E402,F401  (read_* : aussi importés par icons.py et les tests)
    dialog,
    drop_repeated_runs,
    read_bnd4,
    read_dcx,
    read_fmg,
    speaker_for,
    unwrap,
)

LANGS = {"en": "engus", "jp": "jpnjp", "fr": "frafr"}
PLACEHOLDERS = {"", "*"}
RUNE_FIRST_ID = 11000000           # dans la table des gemmes, les runes de Caryll viennent après
NOTES = range(10012000, 10013000)  # notes manuscrites, dans les textes d'événements

# catégorie -> (archive, table des noms, table des descriptions, filtre sur l'identifiant)
TABLES = {
    "goods":     ("item", "アイテム名", "アイテムうんちく", None),
    "weapon":    ("item", "武器名", "武器うんちく", None),
    "protector": ("item", "防具名", "防具うんちく", None),
    "rune":      ("menu", "魔石名", "魔石うんちく", lambda i: i >= RUNE_FIRST_ID),
    "gem":       ("menu", "魔石名", "魔石うんちく", lambda i: i < RUNE_FIRST_ID),
}


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
