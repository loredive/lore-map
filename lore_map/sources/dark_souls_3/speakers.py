"""
Qui parle dans 会話.fmg de Dark Souls III ? Le bloc 0 mêle plusieurs personnages : ses sous-blocs sont
nommés par le vote. Le vote, commun aux jeux Souls, est dans lore_map/speakers.py ;
ici, ce qui est propre au jeu : les catégories du wiki, les noms corrigés ou donnés à la main, la lecture
des dialogues.

Usage (une fois ; les pages sont téléchargées à part, ce sont des données, pas du code) :
    uv run python -m lore_map.sources.dark_souls_3.speakers --download ../dark-souls-3-text/wiki_pages.json
    uv run python -m lore_map.sources.dark_souls_3.speakers --wiki ../dark-souls-3-text/wiki_pages.json \\
        --msg "/mnt/c/Games/Steam/steamapps/common/DARK SOULS III/Game/msg"
"""
import argparse
from pathlib import Path

from lore_map.speakers import Rules, main

RULES = Rules(
    game="dark-souls-3",
    title="Dark Souls III",
    wiki="Dark Souls",
    pages="personnages et boss",
    categories=("Dark_Souls_III:_Characters", "Dark_Souls_III:_Bosses"),
    rename={
        "Fire Keeper (Dark Souls III)": "Fire Keeper",
        "Lorian, Elder Prince and Lothric, Younger Prince": "Lothric, Younger Prince",   # Lorian ne parle pas
        "Forlorn Corvian Settler (character)": "Corvian Settler",
        "Emma, High Priestess of Lothric Castle": "Emma, High Priestess",
        "Nestling": "Pickle Pee, Pump-a-Rum Crow",          # « Me, me, pickle-pee. »
    },
    manual={
        "100": "Narrator",                                   # le récit d'ouverture (« Yes, indeed. »)
        "7500": "Darkdiver Grandahl",                        # « Fear not, the dark, my friend. »
    },
    sure=frozenset({
        "Narrator",                       # le récit d'ouverture (« It is called Lothric… »)
        "Pickle Pee, Pump-a-Rum Crow",    # ses répliques non citées sont la même comptine de troc
    }),
)


def add_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--msg", type=Path, help="dossier Game/msg/ du jeu, ouvert par UXM")


def load_talk(a: argparse.Namespace) -> dict[int, str]:
    """Les répliques anglaises du jeu ; importé ici : --download n'a pas besoin du jeu."""
    from lore_map.sources.dark_souls_3.extract import load_tables
    tables, _dlc = load_tables(a.msg)
    return {i: t for i, t in tables["en"]["会話"].items() if t != "(dummyText)"}


if __name__ == "__main__":
    main(RULES, __doc__.split("\n\n")[0].strip(), add_args, load_talk)
