"""
Les fixtures de tests/lore.test.mjs : une toute petite carte écrite par le vrai write_lore, que la page
décode ensuite sous node. Si le format écrit change, ce test échoue tant que les fixtures n'ont pas été
réécrites :  LORE_FIXTURES=write uv run --no-project --with pytest pytest tests/test_lore_fixtures.py
"""
import os
from pathlib import Path

import pytest

from lore_format import read_lore, write_lore

FIXTURES = Path(__file__).resolve().parent / "fixtures"

CATEGORIES = ["Armes", "Dialogues"]
VIEWS = ["t-SNE", "UMAP"]
# (nom, catégorie, groupe, échos, xy des deux vues) : 4 textes dans le groupe 0, 3 dans le groupe 1, 1 hors groupe
ROWS = [
    ("Épée de Lune", 0, 0, [1, 2], [0.1, 0.2, -0.3, 0.4]),
    ("Lame — « brisée »", 0, 0, [0, 2], [0.12, 0.25, -0.31, 0.42]),
    ("Arc", 0, 0, [0, 1], [0.15, 0.18, -0.28, 0.39]),
    ("Dague", 1, 0, [0, 7], [0.09, 0.22, -0.35, 0.45]),
    ("Gehrman", 1, 1, [5, 6], [-0.5, -0.4, 0.6, -0.1]),
    ("Maria", 1, 1, [4, 0], [-0.52, -0.38, 0.62, -0.12]),
    ("Poupée", 1, 1, [4, 5], [-0.49, -0.43, 0.58, -0.08]),
    ("Pierre", 0, -1, [0, 4], [0.8, -0.8, 0.0, 0.9]),
]


def docs(full):
    out = []
    for i, (name, cat, cluster, echoes, xy) in enumerate(ROWS):
        d = {"name": name, "cat": cat, "text": f"Ligne {i}\n« citée » é", "jp": f"テキスト{i}", "jpName": f"名前{i}",
             "xy": xy, "cluster": cluster, "echoes": echoes}
        if full and i != 3:                # un texte sans seconde langue : colonne vide
            d.update(alt=f"Texte {i} (fr)", altName=f"Nom {i} (fr)")
        if full and i == 6:
            d["dlc"] = True
        out.append(d)
    return out


def clusters(full):
    # le plus petit d'abord : la page les trie par taille
    small = {"id": 1, "label": "La Poupée", "description": "Gehrman, Maria et la Poupée.", "keywords": "Poupée, Maria",
             "n": 3, "views": [{"x": -0.5, "y": -0.4, "cohesion": 1.0}, {"x": 0.6, "y": -0.1, "cohesion": 0.667}]}
    big = {"id": 0, "label": "Les armes", "description": "Des lames et un arc.", "keywords": "Lame, Arc",
           "n": 4, "views": [{"x": 0.11, "y": 0.21, "cohesion": 0.75}, {"x": -0.31, "y": 0.41, "cohesion": 1.0}]}
    if full:
        small.update(altLabel="The Doll", altDescription="Gehrman, Maria and the Doll.")
    return [small, big]


ENTITIES = [
    {"name": "Maria", "label": "Maria", "kind": "personnage", "aliases": ["Lady Maria"], "docs": [5], "broad": False,
     "related": [["Gehrman", 1]]},
    {"name": "Gehrman", "label": "Gehrman", "kind": "personnage", "aliases": [], "docs": [4, 5, 6], "broad": False,
     "related": [["Maria", 1]]},
]


def write_fixture(path, full):
    write_lore(path, views=VIEWS, categories=CATEGORIES, clusters=clusters(full), entities=ENTITIES, docs=docs(full))


@pytest.mark.parametrize("name, full", [("lore-full.json", True), ("lore-plain.json", False)])
def test_committed_fixture_is_what_write_lore_writes(tmp_path, name, full):
    if os.environ.get("LORE_FIXTURES") == "write":
        FIXTURES.mkdir(exist_ok=True)
        write_fixture(FIXTURES / name, full)
    write_fixture(tmp_path / name, full)
    assert (FIXTURES / name).read_bytes() == (tmp_path / name).read_bytes(), (
        f"tests/fixtures/{name} is stale: rewrite it with "
        "LORE_FIXTURES=write uv run --no-project --with pytest pytest tests/test_lore_fixtures.py")


def test_read_lore_full_fixture():
    lore = read_lore(FIXTURES / "lore-full.json")
    assert lore["fields"][-3:] == ["alt", "altName", "dlc"]
    assert lore["views"] == VIEWS and lore["categories"] == CATEGORIES
    assert len(lore["docs"]) == len(ROWS) and lore["entities"] == ENTITIES
    d = lore["docs"][0]
    assert (d["name"], d["cat"], d["cluster"], d["echoes"], d["xy"]) == ("Épée de Lune", 0, 0, [1, 2], [0.1, 0.2, -0.3, 0.4])
    assert (d["alt"], d["altName"], d["dlc"]) == ("Texte 0 (fr)", "Nom 0 (fr)", 0)
    assert (lore["docs"][3]["alt"], lore["docs"][6]["dlc"]) == ("", 1)
    assert lore["clusters"][0]["altLabel"] == "The Doll" and "altLabel" not in lore["clusters"][1]


def test_read_lore_plain_fixture():
    lore = read_lore(FIXTURES / "lore-plain.json")
    assert lore["fields"] == ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"]
    assert all("alt" not in d and "dlc" not in d for d in lore["docs"])
    assert all("altLabel" not in c for c in lore["clusters"])
    assert lore["docs"][7]["cluster"] == -1 and lore["docs"][1]["name"] == "Lame — « brisée »"
