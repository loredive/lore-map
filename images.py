"""
La carte du lore : icônes des objets et portraits des PNJ.

Associe chaque texte de web/data/<jeu>/lore.json à l'icône officielle de l'objet (ou au portrait
du PNJ qui parle, pour un dialogue), d'après l'Elden Ring Fan API (eldenring.fanapis.com). Les images
sont téléchargées une fois, réduites en WebP dans web/img/<jeu>/, et la correspondance est écrite dans
web/data/<jeu>/images.json ({nom du texte: fichier}). Indépendant de prepare.py : à relancer après lui.
Seuls les jeux dont game.json dit "images": "fanapi" ont une source d'images (Elden Ring).

Usage :
    uv run python images.py              # réponses de l'API gardées dans .cache/fanapi/
    uv run python images.py --refresh    # les redemander
"""
import argparse
import io
import json
import re
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path

from PIL import Image

from games import DEFAULT, list_games, load_game
from lore_format import read_lore

ROOT = Path(__file__).parent
CACHE = ROOT / ".cache" / "fanapi"
API = "https://eldenring.fanapis.com/api"
ITEM_ENDPOINTS = ["items", "weapons", "armors", "talismans", "ashes", "spirits",
                  "sorceries", "incantations", "shields", "ammos"]
NPC_ENDPOINT = "npcs"
SIZE = 128       # px, côté maximal d'une icône
QUALITY = 80     # WebP

DIALOGUES = "Dialogue"
PASSAGE_RE = re.compile(r"\s+—\s+passage\s+\d+$")
UPGRADE_RE = re.compile(r"\s*\+\d+$")
ASH_RE = re.compile(r"^ash(?:es)? of war\s*:?\s*", re.I)


def norm(name):
    """Forme de comparaison d'un nom : sans accents ni ponctuation, en minuscules."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def speaker_of(name):
    """« Ranni the Witch — passage 20 » -> « Ranni the Witch »."""
    return PASSAGE_RE.sub("", name)


def match(name, cat, items, npcs):
    """Clé de l'image du texte `name` (catégorie `cat`), ou None. `items` et `npcs` : {nom normalisé: …},
    icônes d'objets et portraits de PNJ, tenus à part (un PNJ homonyme d'un objet n'en prend pas l'icône).

    Dans l'ordre : nom exact ; sans le niveau « +1 » ; Cendre de guerre <-> compétence du même nom ;
    pour un dialogue, le portrait de son interlocuteur. Rien d'approché : mieux vaut pas d'image
    qu'une image fausse.
    """
    if cat == DIALOGUES:
        key = norm(speaker_of(name))
        return key if key in npcs else None
    base = UPGRADE_RE.sub("", name)
    bare = ASH_RE.sub("", base)
    for candidate in (name, base, "Ash of War: " + bare, bare):
        key = norm(candidate)
        if key in items:
            return key
    return None


def slug(key):
    return key.replace(" ", "-")


# ---------------------------------------------------------------- réseau


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def api_index(endpoints, refresh=False):
    """{nom normalisé: URL de l'image} sur ces points d'accès (le premier venu l'emporte)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    index = {}
    for e in endpoints:
        path = CACHE / f"{e}.json"
        if refresh or not path.exists():
            rows, page = [], 0
            while True:
                d = fetch_json(f"{API}/{e}?limit=100&page={page}")
                rows += d["data"]
                page += 1
                if page * 100 >= d["total"]:
                    break
            path.write_text(json.dumps(rows, ensure_ascii=False))
        for x in json.loads(path.read_text()):
            if x.get("image") and x.get("name"):
                index.setdefault(norm(x["name"]), x["image"])
    return index


def save_webp(url, out):
    """Télécharge `url` et l'enregistre réduite en WebP (déjà là : rien à faire)."""
    if out.exists():
        return
    with urllib.request.urlopen(url, timeout=30) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGBA")
    im.thumbnail((SIZE, SIZE))
    im.save(out, "WEBP", quality=QUALITY, method=6)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--game", default=DEFAULT, choices=list_games())
    p.add_argument("--refresh", action="store_true", help="redemander les listes à l'API")
    args = p.parse_args()
    game = load_game(args.game)
    if game.images != "fanapi":
        raise SystemExit(f"pas de source d'images pour {game.title} : la page s'affiche sans")
    DATA, IMG = game.data_dir, game.img_dir

    lore = read_lore(DATA / "lore.json")
    cats = lore["categories"]
    items, npcs = api_index(ITEM_ENDPOINTS, args.refresh), api_index([NPC_ENDPOINT], args.refresh)
    IMG.mkdir(parents=True, exist_ok=True)

    mapping, total, found, failed = {}, Counter(), Counter(), []
    for doc in lore["docs"]:
        name, cat = doc["name"], cats[doc["cat"]]
        total[cat] += 1
        key = match(name, cat, items, npcs)
        if not key:
            continue
        portrait = cat == DIALOGUES
        file = ("pnj-" if portrait else "") + slug(key)
        try:
            save_webp((npcs if portrait else items)[key], IMG / f"{file}.webp")
        except (OSError, ValueError) as err:       # image absente ou illisible : texte sans image
            failed.append(f"{name}: {err}")
            continue
        mapping[name] = file
        found[cat] += 1

    with open(DATA / "images.json", "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    for c in cats:
        print(f"  {c:24} {found[c]:4} / {total[c]}")
    files = list(IMG.glob("*.webp"))
    print(f"{len(mapping)} textes illustrés, {len(files)} images "
          f"({sum(f.stat().st_size for f in files) / 1e6:.1f} Mo) dans {IMG}")
    for line in failed:
        print("  échec :", line)


if __name__ == "__main__":
    main()
