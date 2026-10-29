"""La musique d'ambiance : chaque groupe a une humeur, chaque humeur une piste libre de droits, créditée,
présente dans les deux formats, et la musique d'un jeu tient en 4 Mo."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GAMES = ["bloodborne", "elden-ring"]
LICENSES = {"CC0", "CC-BY 3.0", "CC-BY 4.0"}
MAX_BYTES = 4 * 1024 * 1024


def music(game):
    return json.loads((ROOT / "web" / "data" / game / "music.json").read_text(encoding="utf-8"))


def titles(game):
    return {g["title"] for g in json.loads((ROOT / "games" / game / "labels.json").read_text(encoding="utf-8"))}


@pytest.mark.parametrize("game", GAMES)
def test_moods_and_default(game):
    m = music(game)
    assert 4 <= len(m["tracks"]) <= 6
    assert m["default"] in m["tracks"]


@pytest.mark.parametrize("game", GAMES)
def test_every_group_has_a_known_mood(game):
    m = music(game)
    assert set(m["groups"].values()) <= set(m["tracks"])
    assert set(m["groups"]) == titles(game)


@pytest.mark.parametrize("game", GAMES)
def test_tracks_are_free_credited_and_present(game):
    folder = ROOT / "web" / "music" / game
    for mood, t in music(game)["tracks"].items():
        assert t["title"] and t["author"], mood
        assert t["source"].startswith("https://"), mood
        assert t["license"] in LICENSES, mood
        for ext in ("ogg", "m4a"):
            assert (folder / f"{t['file']}.{ext}").is_file(), f"{mood}: {t['file']}.{ext}"


@pytest.mark.parametrize("game", GAMES)
def test_music_fits_in_4_mb(game):
    size = sum(f.stat().st_size for f in (ROOT / "web" / "music" / game).iterdir())
    assert size <= MAX_BYTES, f"{size / 1e6:.1f} MB"


def test_credits_name_every_track():
    credits = (ROOT / "web" / "music" / "CREDITS.md").read_text(encoding="utf-8")
    for game in GAMES:
        for t in music(game)["tracks"].values():
            assert t["title"] in credits, t["title"]


def test_csp_allows_own_media():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    csp = re.search(r'Content-Security-Policy" content="([^"]+)"', html).group(1)
    assert "media-src 'self'" in csp
