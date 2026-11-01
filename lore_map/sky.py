"""La constellation de chaque jeu, pour la page d'accueil (web/galaxy-ui.js) : web/data/<id>/sky.json.

Tirée du lore.json publié, jamais des données brutes : elle ne peut donc pas s'écarter de la carte.
Quelques Ko par jeu : position (première vue), catégorie et groupe de chaque texte, centre de chaque
groupe et lignes entre ces centres (arbre couvrant minimal), couleurs des catégories, teinte du halo.

    python -m lore_map.sky              # tous les jeux dont lore.json est publié
    python -m lore_map.sky --game bloodborne
"""
import argparse
import json
import math

from lore_map.games import Game, list_games, load_game
from lore_map.lore_format import read_lore

FALLBACK_COLOR = "#cccccc"


def _spanning_lines(centres: list[list[float]]) -> list[list[int]]:
    """Arbre couvrant minimal (Prim) sur les centres : les lignes de la constellation."""
    n = len(centres)
    if n < 2:
        return []
    dist = lambda a, b: math.hypot(centres[a][0] - centres[b][0], centres[a][1] - centres[b][1])  # noqa: E731
    best = {b: (dist(0, b), 0) for b in range(1, n)}
    lines = []
    while best:
        b = min(best, key=lambda k: best[k][0])
        _, a = best.pop(b)
        lines.append([a, b])
        for c in best:
            if (d := dist(b, c)) < best[c][0]:
                best[c] = (d, b)
    return lines


def sky_of(lore: dict, *, title: str, tint: str, year: int, colors: list[str]) -> dict:
    """lore : lore.json lu par read_lore (docs en dicts). Renvoie le contenu de sky.json, sans id."""
    stars, sums = [], {}
    for d in lore["docs"]:
        x, y = round(d["xy"][0], 3), round(d["xy"][1], 3)
        stars += [x, y, d["cat"], d["cluster"]]
        if d["cluster"] >= 0:
            s = sums.setdefault(d["cluster"], [0.0, 0.0, 0])
            s[0] += d["xy"][0]
            s[1] += d["xy"][1]
            s[2] += 1
    centres = [[round(sx / k, 3), round(sy / k, 3), k] for _, (sx, sy, k) in sorted(sums.items())]
    return {"title": title, "year": year, "tint": tint, "n": len(lore["docs"]), "colors": colors,
            "stars": stars, "centres": centres, "lines": _spanning_lines(centres)}


def write_sky(game: Game) -> None:
    """Écrit web/data/<id>/sky.json à partir de web/data/<id>/lore.json."""
    lore = read_lore(game.data_dir / "lore.json")
    palette = game.cfg.get("colors", {})
    sky = {"id": game.id, **sky_of(lore, title=game.title, tint=game.cfg["sky_tint"], year=game.cfg["year"],
                                   colors=[palette.get(c, FALLBACK_COLOR) for c in lore["categories"]])}
    out = game.data_dir / "sky.json"
    out.write_text(json.dumps(sky, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{out} : {sky['n']} étoiles, {len(sky['centres'])} groupes")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--game", help="un seul jeu (par défaut : tous ceux dont lore.json est publié)")
    args = p.parse_args()
    ids = [args.game] if args.game else list_games()
    for gid in ids:
        game = load_game(gid)
        if (game.data_dir / "lore.json").exists():
            write_sky(game)


if __name__ == "__main__":
    main()
