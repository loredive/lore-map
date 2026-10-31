"""
Illustrations des objets, armes, armures, anneaux et sorts de Dark Souls II, tirées de la copie Steam du joueur.

Chaque objet a un numéro d'icône, premier champ de sa ligne dans ItemParam (Game/enc_regulation.bnd.dcx,
lu par extract.item_icons) ; l'icône est un fichier à elle dans GameDataEbl.bdt, /menu/tex/icon/ic_<n sur
10 chiffres>.tpf, une texture DDS haute (128 × 256 pour l'équipement). Le script la recadre sur ce qui est
visible, la centre dans un carré, l'écrit en WebP dans web/img/dark-souls-2/ et écrit
web/data/dark-souls-2/images.json ({nom du texte: n}). Rien n'est écrit dans le dossier du jeu ; les
dialogues n'ont pas d'icône.

Usage (après extract.py et prepare.py) :
    uv run --with pillow python -m lore_map.sources.dark_souls_2.icons \\
        --game "/mnt/c/Games/Steam/steamapps/common/Dark Souls II Scholar of the First Sin/Game" \\
        --text ../dark-souls-2-text/ds2_text.json
"""
import argparse
import io
import json
from collections import Counter
from pathlib import Path

from lore_map.formats.textures import read_tpf
from lore_map.games import GAMES, ROOT

HERE = GAMES / "dark-souls-2"                 # les données du jeu : game.json, speakers.json…


DATA, IMG = ROOT / "web" / "data" / "dark-souls-2", ROOT / "web" / "img" / "dark-souls-2"
LANG = json.loads((HERE / "game.json").read_text(encoding="utf-8"))["text_lang"]   # langue des noms sur la carte
QUALITY = 80
SIZE = 160                                       # côté du carré, en pixels


def square(im, size: int = SIZE):
    """L'icône recadrée sur ses pixels visibles, centrée dans un carré transparent de size pixels."""
    im = im.convert("RGBA")
    box = im.getchannel("A").getbbox()
    if box:
        im = im.crop(box)
    side = max(im.size)
    from PIL import Image
    canvas = Image.new("RGBA", (side, side))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS) if side > size else canvas


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--game", type=Path, required=True, help="dossier Game/ du jeu (GameDataEbl.bhd, .bdt, .pem)")
    p.add_argument("--text", type=Path, required=True, help="JSON écrit par extract.py")
    a = p.parse_args()
    from PIL import Image

    from lore_map.sources.dark_souls_2.extract import CATEGORIES, Archive, item_icons  # ici : les tests chargent ce fichier sans le jeu
    archive, icons = Archive(a.game), item_icons(a.game)
    text = json.loads(a.text.read_text(encoding="utf-8"))
    lore = json.loads((DATA / "lore.json").read_text(encoding="utf-8"))
    on_map = {r[lore["fields"].index("name")] for r in lore["docs"]}
    IMG.mkdir(parents=True, exist_ok=True)
    mapping, found, missing = {}, Counter(), []
    for cat in CATEGORIES:
        for sid, rec in text[cat].items():
            name, n = rec[f"name_{LANG}"].strip(), icons.get(int(sid), 0)    # comme prepare.clean
            if name not in on_map or name in mapping or n <= 0:
                continue
            path = f"/menu/tex/icon/ic_{n:010d}.tpf"
            if path not in archive:
                missing.append(f"{name} ({n})")
                continue
            out = IMG / f"{n}.webp"
            if not out.exists():
                dds = next(iter(read_tpf(archive.read(path)).values()))
                buf = io.BytesIO()
                square(Image.open(io.BytesIO(dds))).save(buf, "WEBP", quality=QUALITY, method=6)
                out.write_bytes(buf.getvalue())
            mapping[name] = str(n)
            found[cat] += 1
    (DATA / "images.json").write_text(json.dumps(mapping, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    files = list(IMG.glob("*.webp"))
    print(dict(found), f"-> {len(mapping)} textes illustrés, {len(files)} images "
          f"({sum(f.stat().st_size for f in files) / 1e6:.1f} Mo)")
    if missing:
        print(f"  sans icône ({len(missing)}) :", ", ".join(missing[:20]))


if __name__ == "__main__":
    main()
