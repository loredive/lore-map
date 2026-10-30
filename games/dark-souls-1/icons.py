"""
Illustrations des objets, armes, armures, anneaux et sorts de Dark Souls, tirées de la copie Steam du joueur.

Chaque objet a un numéro d'icône dans les paramètres du jeu (/param/GameParam/GameParam.parambnd.dcx ;
la disposition des lignes vient de Paramdex, dossier DS1, téléchargée à part). Les icônes ne sont pas
des fichiers à elles : elles sont rangées en planches (Icon00, Icon10… dans /menu/menu_0.tpf.dcx et
menu_4.tpf.dcx), et la mise en page des menus donne, pour chaque « EquIcon_<n> », sa planche et son
rectangle : /menu/menu.drb.dcx (corrigée avec le DLC) d'abord, sinon l'ancienne /menu/menu.drb.
Le script découpe chaque icône en WebP dans web/img/dark-souls-1/ et écrit
web/data/dark-souls-1/images.json ({nom du texte: n}). Rien n'est écrit dans le dossier du jeu ;
les dialogues n'ont pas d'icône.

Usage (après extract.py et prepare.py) :
    python games/dark-souls-1/icons.py --download ../dark-souls-1-text/paramdex
    uv run --with pillow python games/dark-souls-1/icons.py --paramdex ../dark-souls-1-text/paramdex \\
        --data "/mnt/c/Games/Steam/steamapps/common/Dark Souls Prepare to Die Edition/DATA" \\
        --text ../dark-souls-1-text/ds1_text.json
"""
import argparse
import io
import json
import struct
import sys
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))                    # souls_formats.py, à la racine du dépôt
from souls_formats import DS1_ITEMS, DS1_LAYOUTS, icon_ids, param_rows_32, read_bnd3, read_dcx  # noqa: E402

DATA, IMG = ROOT / "web" / "data" / "dark-souls-1", ROOT / "web" / "img" / "dark-souls-1"
LANG = json.loads((HERE / "game.json").read_text(encoding="utf-8"))["text_lang"]   # langue des noms sur la carte
QUALITY = 80
PARAMDEX = "https://raw.githubusercontent.com/soulsmods/Paramdex/master/DS1/Defs/"
SHEETS = ("/menu/menu_0.tpf.dcx", "/menu/menu_4.tpf.dcx")    # les planches d'icônes en pleine taille
ICON = "EquIcon_"


# ---------------------------------------------------------------- formats
def read_tpf(d: bytes) -> dict[str, bytes]:
    """TPF du PC (Dark Souls) : {nom de la texture: fichier DDS}."""
    if d[:4] != b"TPF\0":
        raise ValueError("TPF attendu")
    count, = struct.unpack_from("<i", d, 8)
    out = {}
    for k in range(count):
        offset, size, _fmt, _type, _mips, _flags, name_at, _ = struct.unpack_from("<IiBBBBII", d, 0x10 + 20 * k)
        out[d[name_at:d.index(b"\0", name_at)].decode("shift_jis")] = d[offset:offset + size]
    return out


def drb_sprites(d: bytes, prefix: str = ICON) -> dict[str, tuple[str, tuple[int, int, int, int]]]:
    """Mise en page DRB des menus (Dark Souls) : {nom du dialogue: (planche, (gauche, haut, droite, bas))}
    pour les sprites dont le nom commence par prefix. Morceaux de 16 octets d'en-tête (étiquette, taille,
    nombre) alignés sur 16 ; STR : textes UTF-16 ; TEXI : planches (16 octets : nom, chemin…) ; DLGO :
    dialogues (32 octets : nom, forme…) ; SHAP : formes (8 octets : type, données dans SHPR) ; un Sprite
    porte son rectangle dans la planche aux shorts 4 à 7, et le rang de la planche au short 8."""
    if d[:4] != b"DRB\0":
        raise ValueError("DRB attendu")
    chunks, pos = {}, 0x10
    while True:
        tag = d[pos:pos + 4].rstrip(b"\0").decode()
        size, count = struct.unpack_from("<ii", d, pos + 4)
        chunks[tag] = (pos + 0x10, count)
        if tag == "END":
            break
        pos = (pos + 0x10 + size + 15) & ~15

    def text(at):
        start = end = chunks["STR"][0] + at
        while d[end:end + 2] != b"\0\0":
            end += 2
        return d[start:end].decode("utf-16-le")

    texi_at, n_texi = chunks["TEXI"]
    sheets = [text(struct.unpack_from("<i", d, texi_at + 16 * k)[0]) for k in range(n_texi)]
    dlgo_at, n_dlgo = chunks["DLGO"]
    out = {}
    for k in range(n_dlgo):
        name_at, shape_at = struct.unpack_from("<ii", d, dlgo_at + 32 * k)
        name = text(name_at)
        if not name.startswith(prefix):
            continue
        type_at, data_at = struct.unpack_from("<ii", d, chunks["SHAP"][0] + shape_at)
        if text(type_at) != "Sprite":
            continue
        left, top, right, bottom, sheet = struct.unpack_from("<5h", d, chunks["SHPR"][0] + data_at + 8)
        out[name] = (sheets[sheet], (left, top, right, bottom))
    return out


# ---------------------------------------------------------------- icônes
def download(out: Path) -> None:
    """Les dispositions de DS1_LAYOUTS, depuis Paramdex."""
    out.mkdir(parents=True, exist_ok=True)
    for name in DS1_LAYOUTS.values():
        req = urllib.request.Request(PARAMDEX + f"{name}.xml", headers={"User-Agent": "lore-map (fan project)"})
        (out / f"{name}.xml").write_bytes(urllib.request.urlopen(req, timeout=30).read())
    print(f"{len(DS1_LAYOUTS)} dispositions écrites dans {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--download", type=Path, help="télécharge les dispositions de Paramdex dans ce dossier, puis s'arrête")
    p.add_argument("--paramdex", type=Path, help="dossier écrit par --download")
    p.add_argument("--data", type=Path, help="dossier DATA/ du jeu (dvdbnd*.bhd5 et .bdt)")
    p.add_argument("--text", type=Path, help="JSON écrit par extract.py")
    a = p.parse_args()
    if a.download:
        download(a.download)
        return
    from extract import Archives  # ici : --download n'a besoin ni du jeu ni de Pillow
    from PIL import Image
    archives = Archives(a.data)
    layouts = {t: (a.paramdex / f"{n}.xml").read_text(encoding="utf-8-sig") for t, n in DS1_LAYOUTS.items()}
    params = read_bnd3(read_dcx(archives.read("/param/GameParam/GameParam.parambnd.dcx")))
    icons = icon_ids(params, layouts, DS1_ITEMS, rows=param_rows_32)
    sprites = {**drb_sprites(archives.read("/menu/menu.drb")),
               **drb_sprites(read_dcx(archives.read("/menu/menu.drb.dcx")))}
    sheets = {}
    for path in SHEETS:
        for name, dds in read_tpf(read_dcx(archives.read(path))).items():
            im = Image.open(io.BytesIO(dds))
            im.load()
            sheets[name] = im
    text = json.loads(a.text.read_text(encoding="utf-8"))
    lore = json.loads((DATA / "lore.json").read_text(encoding="utf-8"))
    on_map = {r[lore["fields"].index("name")] for r in lore["docs"]}
    IMG.mkdir(parents=True, exist_ok=True)
    mapping, found, missing = {}, Counter(), []
    for cat in DS1_ITEMS:
        for sid, rec in text[cat].items():
            name, n = rec[f"name_{LANG}"].strip(), icons[cat].get(int(sid), 0)    # comme prepare.clean
            if name not in on_map or name in mapping or not n:
                continue
            sprite = sprites.get(f"{ICON}{n:04d}")
            if sprite is None or sprite[0] not in sheets:
                missing.append(f"{name} ({n})")
                continue
            out = IMG / f"{n}.webp"
            if not out.exists():
                buf = io.BytesIO()
                sheets[sprite[0]].crop(sprite[1]).save(buf, "WEBP", quality=QUALITY, method=6)
                out.write_bytes(buf.getvalue())
            mapping[name] = str(n)
            found[cat] += 1
    (DATA / "images.json").write_text(json.dumps(mapping, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    files = list(IMG.glob("*.webp"))
    print(dict(found), f"-> {len(mapping)} textes illustrés, {len(files)} images "
          f"({sum(f.stat().st_size for f in files) / 1e6:.1f} Mo)")
    if missing:
        print(f"  sans sprite ({len(missing)}) :", ", ".join(missing[:20]))


if __name__ == "__main__":
    main()
