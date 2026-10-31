"""
Qui parle dans 会話.fmg de Dark Souls ? Le bloc 0 mêle le récit d'ouverture et Gwyndolin au tombeau de
Gwyn : il est nommé par sous-bloc (manual_sub). Le vote, commun aux jeux Souls, est dans lore_map/speakers.py ;
ici, ce qui est propre au jeu : les catégories du wiki, les noms corrigés ou donnés à la main, la lecture
des dialogues.

Usage (une fois ; les pages sont téléchargées à part, ce sont des données, pas du code) :
    uv run python -m lore_map.sources.dark_souls_1.speakers --download ../dark-souls-1-text/wiki_pages.json
    uv run python -m lore_map.sources.dark_souls_1.speakers --wiki ../dark-souls-1-text/wiki_pages.json \\
        --data "/mnt/c/Games/Steam/steamapps/common/Dark Souls Prepare to Die Edition/DATA"
"""
import argparse
from pathlib import Path

from lore_map.speakers import Rules, main

RULES = Rules(
    game="dark-souls-1",
    title="Dark Souls",
    wiki="Dark Souls",
    pages="personnages, marchands et boss",
    categories=("Dark_Souls:_Characters", "Dark_Souls:_Merchants", "Dark_Souls:_Bosses"),
    rename={},
    manual={
        "3802": "Siegmeyer of Catarina",                     # « Mmm...mmm... », dans les blocs de Siegmeyer
        "5500": "Snuggly the Crow",                          # « Give me, warm. Give me, soft. »
        "5600": "Dusk of Oolacile",                          # le DLC : « Long ago, in my homeland of Oolacile… »
    },
    manual_sub={"10": "Narrator", "20": "Narrator", "30": "Dark Sun Gwyndolin", "40": "Dark Sun Gwyndolin"},
    sure=frozenset({
        "Narrator",                       # le récit d'ouverture (« The Darksign brands the Undead. »)
        "Snuggly the Crow",               # ses répliques sont celles du troc au nid
    }),
)


def add_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--data", type=Path, help="dossier DATA/ du jeu (dvdbnd*.bhd5 et .bdt)")


def load_talk(a: argparse.Namespace) -> dict[int, str]:
    """Les répliques anglaises du jeu ; importé ici : --download n'a pas besoin du jeu."""
    from lore_map.sources.dark_souls_1.extract import Archives, load_tables
    tables, _dlc = load_tables(Archives(a.data))
    return tables["en"]["会話"]


if __name__ == "__main__":
    main(RULES, __doc__.split("\n\n")[0].strip(), add_args, load_talk)
