"""sky.json : la constellation de chaque jeu pour la page d'accueil, tirée du lore.json publié."""
import json
import re
from pathlib import Path

import pytest

from lore_map.sky import sky_of

DATA = Path(__file__).resolve().parent.parent / "web" / "data"
GAMES = ["bloodborne", "dark-souls-1", "dark-souls-2", "dark-souls-3", "elden-ring"]


def lore(docs, categories=("A", "B")):
    """Un lore.json minimal, docs déjà en dicts (comme read_lore les rend)."""
    return {"views": ["t-SNE", "UMAP"], "categories": list(categories), "docs": docs}


def doc(x, y, cat, cluster):
    # deux vues : la seconde ne doit jamais servir
    return {"name": "t", "cat": cat, "xy": [x, y, 9.0, 9.0], "cluster": cluster}


THREE = [doc(0.12345, -0.5, 0, 0), doc(0.2, 0.3333, 1, 0), doc(-0.9, 0.1, 1, -1)]


def sky(docs):
    return sky_of(lore(docs), title="T", tint="#abcdef", year=2000, colors=["#111111", "#222222"])


def test_stars_use_the_first_view():
    s = sky(THREE)
    assert s["n"] == 3
    assert s["stars"] == [0.123, -0.5, 0, 0, 0.2, 0.333, 1, 0, -0.9, 0.1, 1, -1]
    assert (s["title"], s["tint"], s["year"], s["colors"]) == ("T", "#abcdef", 2000, ["#111111", "#222222"])


def test_centres_skip_unclustered():
    s = sky(THREE)
    assert s["centres"] == [[pytest.approx(0.162, abs=1e-3), pytest.approx(-0.083, abs=1e-3), 2]]
    assert s["lines"] == []


def test_lines_span_every_group():
    docs = [doc(0, 0, 0, 0), doc(1, 0, 0, 1), doc(0, 1, 0, 2), doc(5, 5, 0, 3)]
    s = sky(docs)
    assert len(s["centres"]) == 4
    assert len(s["lines"]) == 3
    reached, todo = {0}, list(s["lines"])
    while todo:
        step = [e for e in todo if e[0] in reached or e[1] in reached]
        assert step, "the lines do not join every group"
        for a, b in step:
            reached |= {a, b}
            todo.remove([a, b])
    assert reached == {0, 1, 2, 3}


@pytest.mark.parametrize("game", GAMES)
def test_published_sky_matches_lore(game):
    s = json.loads((DATA / game / "sky.json").read_text(encoding="utf-8"))
    raw = json.loads((DATA / game / "lore.json").read_text(encoding="utf-8"))
    assert s["id"] == game
    assert s["n"] == len(raw["docs"])
    assert len(s["stars"]) == 4 * s["n"]
    assert len(s["colors"]) == len(raw["categories"])
    assert re.fullmatch(r"#[0-9a-f]{6}", s["tint"])
