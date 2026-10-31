"""
Tables de textes FMG (v2 ; v1 pour Dark Souls et Dark Souls II) : {identifiant: texte}, et le texte
remis en paragraphes (les jeux le coupent à la main pour la largeur de leur fenêtre).
"""
import re
import struct

from lore_map.formats.archives import utf16_at


def read_fmg(b: bytes) -> dict[int, str]:
    """FMG v2, ou v1 (Dark Souls : positions sur 32 bits) : {identifiant: texte} ; les entrées vides sont omises."""
    v1 = b[2] == 1
    groups, strings = struct.unpack_from("<ii", b, 0x0C)
    if v1:
        offsets_at, = struct.unpack_from("<i", b, 0x14)
    else:
        offsets_at, = struct.unpack_from("<q", b, 0x18)
    offsets = struct.unpack_from(f"<{strings}{'i' if v1 else 'q'}", b, offsets_at)
    out = {}
    for g in range(groups):
        index, first, last = struct.unpack_from("<iii", b, (0x1C + 12 * g) if v1 else (0x28 + 16 * g))
        for k, i in enumerate(range(first, last + 1)):
            if offsets[index + k]:
                text = utf16_at(b, offsets[index + k])
                if text.strip():
                    out[i] = text
    return out


def unwrap(text: str, lang: str) -> str:
    """Le jeu coupe ses textes à la main pour la largeur de sa fenêtre : un retour à la ligne seul
    devient une espace (rien en japonais, qui n'en met pas entre les mots) ; une ligne vide
    sépare toujours deux paragraphes."""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t\u00a0]+\n", "\n", text)
    return re.sub(r"(?<!\n)\n(?!\n)", "" if lang == "jp" else " ", text)
