"""
Qui parle dans les dialogues de Dark Souls II (talk/m<carte>.fmg, réunis par extract.load_tables) ?
Le vote, commun aux jeux Souls, est dans lore_map/speakers.py ; ici, ce qui est propre au jeu : les
catégories du wiki, les noms corrigés ou donnés à la main, la lecture des dialogues.

Usage (une fois ; les pages sont téléchargées à part, ce sont des données, pas du code) :
    uv run python -m lore_map.sources.dark_souls_2.speakers --download ../dark-souls-2-text/wiki_pages.json
    uv run python -m lore_map.sources.dark_souls_2.speakers --wiki ../dark-souls-2-text/wiki_pages.json \\
        --game "/mnt/c/Games/Steam/steamapps/common/Dark Souls II Scholar of the First Sin/Game" \\
        --dictionary ../dark-souls-2-text/uxm/ScholarDictionary.txt
"""
import argparse
from pathlib import Path

from lore_map.speakers import Rules, main

RULES = Rules(
    game="dark-souls-2",
    title="Dark Souls II",
    wiki="Dark Souls II",
    pages="personnages, marchands et boss",
    categories=("Dark_Souls_II:_Characters", "Dark_Souls_II:_Merchants", "Dark_Souls_II:_Bosses"),
    rename={"Rat King (character)": "Rat King"},
    manual={
        "6270": "Nashandra",                         # fin du jeu : « Brave Undead, you have proven yourself to me. »
        "7050": "Old Ladies",                        # Things Betwixt : « Heh heh heh... What seems to be the ruckus? »
        "7051": "Old Ladies",
        "7052": "Old Ladies",
        "7590": "Elana, the Squalid Queen",          # le DLC, Shulva : « You...forever you shall rot... »
        "7602": "Milfanito",                         # « Ah...Ahh... » chanté, à côté des blocs 7600 et 7601
    },
    sure=frozenset({
        "Old Ladies",                     # les trois vieilles de Things Betwixt, seules à y parler
    }),
)


def add_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--game", type=Path, help="dossier Game/ du jeu (GameDataEbl.bhd, .bdt, .pem)")
    p.add_argument("--dictionary", type=Path, help="ScholarDictionary.txt d'UXM (chemins des fichiers)")


def load_talk(a: argparse.Namespace) -> dict[int, str]:
    """Les répliques anglaises du jeu ; importé ici : --download n'a pas besoin du jeu."""
    from lore_map.sources.dark_souls_2.extract import Archive, load_tables, talk_maps
    maps = talk_maps(a.dictionary.read_text(encoding="utf-8").splitlines())
    tables, _dlc = load_tables(Archive(a.game), maps)
    return tables["en"]["会話"]


if __name__ == "__main__":
    main(RULES, __doc__.split("\n\n")[0].strip(), add_args, load_talk)
