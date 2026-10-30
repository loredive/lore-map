import json

import pytest

import games
from lore_format import write_lore


def make_game(tmp_path, monkeypatch, steps):
    """Un jeu minimal dans tmp_path : lore.json avec deux textes, tours.json avec ces étapes."""
    monkeypatch.setattr(games, "GAMES", tmp_path / "games")
    monkeypatch.setattr(games, "WEB", tmp_path / "web")
    (tmp_path / "games" / "g").mkdir(parents=True)
    (tmp_path / "web" / "data" / "g").mkdir(parents=True)
    docs = [{"name": n, "cat": 0, "text": "", "jp": "", "jpName": "", "xy": [0.0, 0.0], "cluster": -1, "echoes": []}
            for n in ("Saw Cleaver", "Blood Vial")]
    write_lore(tmp_path / "web" / "data" / "g" / "lore.json", views=["t-SNE"], categories=["Weapons"], clusters=[],
               entities=[], docs=docs)
    tours = [{"id": "t", "title": "T", "intro": "", "steps": [{"text": s, "note": ""} for s in steps]}]
    (tmp_path / "games" / "g" / "tours.json").write_text(json.dumps(tours))
    return games.Game(id="g", title="G", categories={}, dialog_label="", junk=(), extra_stop=(), speaker_names={},
                      min_cluster=1, min_samples=1, images=None, text_lang="en", alt_lang=None, min_chars=1, cfg={})


def test_tours_are_published_next_to_the_map(tmp_path, monkeypatch):
    game = make_game(tmp_path, monkeypatch, ["Saw Cleaver", "Blood Vial"])
    games.publish_tours(game)
    assert json.loads((game.data_dir / "tours.json").read_text())[0]["steps"][1]["text"] == "Blood Vial"


def test_a_step_naming_no_text_stops_the_publication(tmp_path, monkeypatch):
    game = make_game(tmp_path, monkeypatch, ["Saw Cleaver", "Couperet-scie"])
    with pytest.raises(SystemExit, match="Couperet-scie"):
        games.publish_tours(game)


def test_uncertain_speakers_reach_the_page(tmp_path, monkeypatch):
    game = make_game(tmp_path, monkeypatch, ["Saw Cleaver"])
    speakers = {"blocks": {}, "uncertain": {"Unknown NPC": "No source says who speaks these lines."}}
    (game.dir / "speakers.json").write_text(json.dumps(speakers))
    games.publish(game)
    page = json.loads((game.data_dir / "game.json").read_text())
    assert page["uncertain_speakers"] == {"Unknown NPC": "No source says who speaks these lines."}


def test_a_game_without_uncertain_speakers_publishes_none(tmp_path, monkeypatch):
    game = make_game(tmp_path, monkeypatch, ["Saw Cleaver"])
    games.publish(game)
    assert "uncertain_speakers" not in json.loads((game.data_dir / "game.json").read_text())
