"""
Illustrations des objets, armes, armures, anneaux et sorts de Dark Souls III, tirées de la copie Steam du joueur.

Chaque objet a un numéro d'icône dans les paramètres du jeu ; l'illustration est la texture
menu/knowledge/menu_knowledge_<n>.tpf.dcx (un DDS dans un TPF, que Pillow lit tel quel). Sur PC, les
paramètres sont dans Data0.bdt, chiffré en AES avec une clé publiée par les outils de la communauté ;
la disposition de leurs lignes vient de Paramdex (github.com/soulsmods/Paramdex), téléchargée à part.
Le script réduit les illustrations en WebP dans web/img/dark-souls-3/ et écrit
web/data/dark-souls-3/images.json ({nom du texte: n}). Rien n'est écrit dans le dossier du jeu.
Les sorts sont des objets (EquipParamGoods) ; les dialogues n'ont pas d'icône.

Usage (après extract.py et prepare.py ; dossier Game/ ouvert par UXM) :
    uv run --with cryptography python games/dark-souls-3/icons.py --download /tmp/paramdex
    uv run --with cryptography python games/dark-souls-3/icons.py --paramdex /tmp/paramdex \\
        --game "/mnt/c/Games/Steam/steamapps/common/DARK SOULS III/Game" --text ../dark-souls-3-text/ds3_text.json
"""
import argparse
import io
import json
import struct
import sys
import urllib.request
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))                    # souls_formats.py, à la racine du dépôt
from souls_formats import DS3_ITEMS, DS3_LAYOUTS, DS3_REGULATION_KEY, icon_ids, read_dcx, read_regulation  # noqa: E402

DATA, IMG = ROOT / "web" / "data" / "dark-souls-3", ROOT / "web" / "img" / "dark-souls-3"
LANG = json.loads((HERE / "game.json").read_text(encoding="utf-8"))["text_lang"]   # langue des noms sur la carte
SIZE = 192                 # px : affichée à 96 px, nette sur un écran à haute densité
QUALITY = 80
PARAMDEX = "https://raw.githubusercontent.com/soulsmods/Paramdex/master/DS3/Defs/"
# ---------------------------------------------------------------- textures
def read_tpf_image(raw: bytes) -> Image.Image:
    """Première texture d'un TPF PC : un fichier DDS complet."""
    d = read_dcx(raw)
    if d[:4] != b"TPF\0":
        raise ValueError("TPF attendu")
    offset, size = struct.unpack_from("<Ii", d, 0x10)
    im = Image.open(io.BytesIO(d[offset:offset + size]))
    im.load()
    return im


def download(out: Path) -> None:
    """Les dispositions de DS3_LAYOUTS, depuis Paramdex."""
    out.mkdir(parents=True, exist_ok=True)
    for name in DS3_LAYOUTS.values():
        req = urllib.request.Request(PARAMDEX + f"{name}.xml", headers={"User-Agent": "lore-map (fan project)"})
        (out / f"{name}.xml").write_bytes(urllib.request.urlopen(req, timeout=30).read())
    print(f"{len(DS3_LAYOUTS)} dispositions écrites dans {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--download", type=Path, help="télécharge les dispositions de Paramdex dans ce dossier, puis s'arrête")
    p.add_argument("--paramdex", type=Path, help="dossier écrit par --download")
    p.add_argument("--game", type=Path, help="dossier Game/ du jeu, ouvert par UXM")
    p.add_argument("--text", type=Path, help="JSON écrit par extract.py")
    a = p.parse_args()
    if a.download:
        download(a.download)
        return
    layouts = {t: (a.paramdex / f"{n}.xml").read_text(encoding="utf-8-sig") for t, n in DS3_LAYOUTS.items()}
    icons = icon_ids(read_regulation((a.game / "Data0.bdt").read_bytes(), DS3_REGULATION_KEY), layouts)
    text = json.loads(a.text.read_text(encoding="utf-8"))
    lore = json.loads((DATA / "lore.json").read_text(encoding="utf-8"))
    on_map = {r[lore["fields"].index("name")] for r in lore["docs"]}
    IMG.mkdir(parents=True, exist_ok=True)
    mapping, found, failed = {}, Counter(), []
    for cat in DS3_ITEMS:
        for sid, rec in text[cat].items():
            name, n = rec[f"name_{LANG}"].strip(), icons[cat].get(int(sid), 0)    # comme prepare.clean ("Lucerne ")
            path = a.game / "menu" / "knowledge" / f"menu_knowledge_{n:05d}.tpf.dcx"
            if name not in on_map or name in mapping or not n or not path.exists():
                continue
            out = IMG / f"{n}.webp"
            try:
                if not out.exists():
                    im = read_tpf_image(path.read_bytes())
                    im.thumbnail((SIZE, SIZE))
                    buf = io.BytesIO()
                    im.save(buf, "WEBP", quality=QUALITY, method=6)
                    out.write_bytes(buf.getvalue())
            except (OSError, ValueError) as err:     # texture illisible : texte sans image
                failed.append(f"{name}: {err}")
                continue
            mapping[name] = str(n)
            found[cat] += 1
    (DATA / "images.json").write_text(json.dumps(mapping, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    files = list(IMG.glob("*.webp"))
    print(dict(found), f"-> {len(mapping)} textes illustrés, {len(files)} images "
          f"({sum(f.stat().st_size for f in files) / 1e6:.1f} Mo)")
    for line in failed:
        print("  échec :", line)


if __name__ == "__main__":
    main()
