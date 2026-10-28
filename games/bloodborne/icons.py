"""
Illustrations des objets, armes et tenues de Bloodborne, tirées de la copie PS4 du joueur.

Chaque objet a un numéro d'icône dans les paramètres du jeu (param/gameparam, champ iconId,
disposition donnée par paramdef/) ; l'illustration est la texture menu/menu_knowledge_<n>.tpf.dcx
(BC7, rangée par tuiles PS4 de 8 × 8 blocs en ordre de Morton). Le script les décode, les réduit
en WebP dans web/img/bloodborne/ et écrit web/data/bloodborne/images.json ({nom du texte: n}).
Rien n'est écrit dans le dossier du jeu. Pas d'icônes pour les gemmes, runes, notes et dialogues.

Usage (après extract.py et prepare.py) :
    uv run python games/bloodborne/icons.py --dump /mnt/c/PS4Games/CUSA00207-UPDATE/dvdroot_ps4 \\
        --base /mnt/c/PS4Games/CUSA00207/dvdroot_ps4 --text ../bloodborne-text/bloodborne_text.json
"""
import argparse
import io
import json
import struct
from collections import Counter
from pathlib import Path

from extract import HERE, read_bnd4, read_dcx
from PIL import Image

ROOT = HERE.parent.parent
DATA, IMG = ROOT / "web" / "data" / "bloodborne", ROOT / "web" / "img" / "bloodborne"
LANG = json.loads((HERE / "game.json").read_text(encoding="utf-8"))["text_lang"]   # langue des noms sur la carte
SIZE = 192                 # px : affichée à 96 px, nette sur un écran à haute densité
QUALITY = 80
BC7 = 102                  # code de format des textures du menu
# catégorie du texte -> (table de paramètres, champs d'icône par ordre de préférence)
PARAMS = {"goods": ("EquipParamGoods", ["iconId"]), "weapon": ("EquipParamWeapon", ["iconId"]),
          "protector": ("EquipParamProtector", ["iconIdM", "iconIdF"])}
TYPE_SIZE = {"s8": 1, "u8": 1, "dummy8": 1, "s16": 2, "u16": 2, "s32": 4, "u32": 4, "f32": 4}


# ---------------------------------------------------------------- paramètres
def _cstr(b: bytes) -> str:
    return b.split(b"\0")[0].decode("ascii", "replace")


def paramdef_offsets(d: bytes) -> tuple[dict[str, int], int]:
    """PARAMDEF v201 : {nom du champ: décalage dans la ligne}, taille d'une ligne. Les champs de
    bits (« flag:1 ») de même type se partagent un octet (ou un mot) tant qu'il reste de la place."""
    count, field_size = struct.unpack_from("<HH", d, 8)
    start, = struct.unpack_from("<q", d, 0x30)
    offsets, off, bit, unit = {}, 0, 0, 0
    for k in range(count):
        f = d[start + k * field_size: start + (k + 1) * field_size]
        typ, name = _cstr(f[112:144]), _cstr(f[144:176])
        nbytes, = struct.unpack_from("<i", f, 100)
        if ":" in name:
            name, bits = name.split(":")
            size = TYPE_SIZE.get(typ, 1)
            if bit == 0 or size != unit or bit + int(bits) > 8 * size:
                off += unit if bit else 0
                unit, bit = size, 0
            offsets[name] = off
            bit += int(bits)
            continue
        if bit:
            off, bit = off + unit, 0
        offsets[name.split("[")[0]] = off
        off += nbytes
    return offsets, off + (unit if bit else 0)


def param_rows(p: bytes) -> dict[int, int]:
    """PARAM (décalages 64 bits) : {identifiant de ligne: début de ses données}."""
    count, = struct.unpack_from("<H", p, 0x0A)
    return dict(struct.unpack_from("<i4xq", p, 0x40 + 24 * k) for k in range(count))


def icon_ids(dump: Path) -> dict[str, dict[int, int]]:
    """{catégorie: {identifiant de l'objet: numéro d'icône}} (0 : pas d'icône)."""
    defs = read_bnd4(read_dcx((dump / "paramdef" / "paramdef.paramdefbnd.dcx").read_bytes()))
    params = read_bnd4(read_dcx((dump / "param" / "gameparam" / "gameparam.parambnd.dcx").read_bytes()))
    out = {}
    for cat, (table, fields) in PARAMS.items():
        offsets, size = paramdef_offsets(defs[f"{table}.paramdef"])
        p, rows = params[f"{table}.param"], param_rows(params[f"{table}.param"])
        starts = sorted(rows.values())
        if len(starts) > 1 and starts[1] - starts[0] != size:
            raise ValueError(f"{table} : lignes de {starts[1] - starts[0]} octets, paramdef en annonce {size}")
        out[cat] = {}
        for rid, at in rows.items():
            icons = [struct.unpack_from("<H", p, at + offsets[f])[0] for f in fields]
            out[cat][rid] = next((i for i in icons if i), 0)
    return out


# ---------------------------------------------------------------- textures
def morton(i: int) -> tuple[int, int]:
    """Position (x, y) du i-ème bloc d'une tuile : bits pairs pour x, impairs pour y."""
    x = y = 0
    for b in range(8):
        x |= ((i >> (2 * b)) & 1) << b
        y |= ((i >> (2 * b + 1)) & 1) << b
    return x, y


def deswizzle(data: bytes, bw: int, bh: int, block: int = 16, tile: int = 8) -> bytes:
    """Blocs rangés par tuiles PS4 (tile × tile blocs, ordre de Morton) -> lignes de blocs."""
    out, src = bytearray(bw * bh * block), 0
    for ty in range(0, -(-bh // tile) * tile, tile):
        for tx in range(0, -(-bw // tile) * tile, tile):
            for i in range(tile * tile):
                x, y = morton(i)
                if tx + x < bw and ty + y < bh:
                    at = ((ty + y) * bw + tx + x) * block
                    out[at:at + block] = data[src:src + block]
                src += block
    return bytes(out)


def read_tpf_image(raw: bytes) -> Image.Image:
    """Première texture d'un TPF PS4 (BC7), décodée."""
    d = read_dcx(raw)
    if d[:4] != b"TPF\0":
        raise ValueError("TPF attendu")
    offset, size, fmt = struct.unpack_from("<IiB", d, 0x10)
    w, h = struct.unpack_from("<hh", d, 0x1C)
    if fmt != BC7:
        raise ValueError(f"format de texture {fmt} non pris en charge")
    bw, bh = -(-w // 4), -(-h // 4)
    blocks = deswizzle(d[offset:offset + size], bw, bh)
    return Image.frombytes("RGBA", (4 * bw, 4 * bh), blocks, "bcn", 7).crop((0, 0, w, h))


def texture_path(n: int, folders: list[Path]) -> Path | None:
    """La mise à jour (DLC compris) d'abord, puis le jeu de base."""
    for f in folders:
        p = f / "menu" / f"menu_knowledge_{n:05d}.tpf.dcx"
        if p.exists():
            return p
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--dump", type=Path, required=True, help="dvdroot_ps4 de la mise à jour")
    p.add_argument("--base", type=Path, help="dvdroot_ps4 du jeu de base (textures absentes de la mise à jour)")
    p.add_argument("--text", type=Path, required=True, help="JSON écrit par extract.py")
    a = p.parse_args()
    folders = [a.dump] + ([a.base] if a.base else [])
    text = json.loads(a.text.read_text(encoding="utf-8"))
    lore = json.loads((DATA / "lore.json").read_text(encoding="utf-8"))
    on_map = {r[lore["fields"].index("name")] for r in lore["docs"]}
    icons = icon_ids(a.dump)
    IMG.mkdir(parents=True, exist_ok=True)
    mapping, found, failed = {}, Counter(), []
    for cat in PARAMS:
        for sid, rec in text[cat].items():
            name, n = rec[f"name_{LANG}"], icons[cat].get(int(sid), 0)
            if name not in on_map or name in mapping or not n:
                continue
            path = texture_path(n, folders)
            if not path:
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
