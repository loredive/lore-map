"""
Qui parle dans 会話.fmg ? Les répliques sont rangées par blocs d'identifiants (10 000 par
personnage ; 100 par personnage dans certains blocs du DLC), sans nom. Chaque réplique est
cherchée dans la page « Dialogue Reference » du wiki bloodborne-wiki.com, rangée par personnage ;
chaque bloc prend le personnage qui y a le plus de répliques. Écrit speakers.json, relu à la main.

Usage (une fois ; la page est téléchargée à part, c'est une donnée, pas du code) :
    curl -L http://www.bloodborne-wiki.com/2017/12/dialogue-reference.html -o /tmp/wiki/dialogue.html
    uv run python games/bloodborne/vote_speakers.py --wiki /tmp/wiki/dialogue.html --msg <…/msg>
"""
import argparse
import html
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from extract import HERE, LANGS, read_bnd4, read_dcx, read_fmg

MIN_CHARS = 12          # en dessous (« Ahh... »), une réplique ne désigne personne
SUB_MIN_VOTES = 2       # un sous-bloc ne contredit son bloc qu'avec au moins 2 voix…
SUB_MIN_SHARE = 0.55    # … et 55 % des voix du sous-bloc (le Church Doctor partage 5 répliques sur 6 avec Amelia)
SKIP = {"Basic Information", "Characters", "Early Draft Dialogues"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", html.unescape(s).lower()).strip()


def wiki_sections(page: str) -> dict[str, str]:
    """{titre de section (personnage): texte normalisé de ses répliques}."""
    out = {}
    for part in re.split(r"<h3[^>]*>", page)[1:]:
        head, _, body = part.partition("</h3>")
        title = html.unescape(re.sub(r"<[^>]+>", "", head)).strip().replace("’", "'")
        # « (Unused) » : répliques coupées, recopiées sous un autre titre que leur personnage
        if title and title not in SKIP and "(Unused)" not in title:
            out[title] = norm(re.sub(r"<[^>]+>", " ", body))
    return out


def votes(lines: list[str], sections: dict[str, str]) -> Counter:
    """Une voix par réplique, partagée entre les sections qui la contiennent."""
    c = Counter()
    for t in lines:
        n = norm(t)
        hits = [s for s, body in sections.items() if len(n) >= MIN_CHARS and n in body]
        for s in hits:
            c[s] += 1 / len(hits)
    return c


def vote(talk: dict[int, str], sections: dict[str, str]) -> dict:
    blocks, subs = defaultdict(list), defaultdict(list)
    for i, t in talk.items():
        blocks[i // 10000].append(t)
        subs[i // 100].append(t)
    winner = {b: (votes(ls, sections).most_common(1) or [(None, 0)])[0][0] for b, ls in blocks.items()}
    # bloc sans voix (une ou deux répliques) : celui de son voisin le plus proche qui en a
    named = sorted(b for b, w in winner.items() if w)
    for b, w in winner.items():
        if not w:
            winner[b] = winner[min(named, key=lambda n: abs(n - b))]
    overrides = {}
    for s, ls in subs.items():
        c = votes(ls, sections)
        top = c.most_common(1)
        if top and top[0][0] != winner[s // 100] and top[0][1] >= SUB_MIN_VOTES \
                and top[0][1] / sum(c.values()) >= SUB_MIN_SHARE:
            overrides[str(s)] = top[0][0]
    return {"blocks": {str(b): w for b, w in sorted(winner.items())}, "sub_blocks": overrides}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--wiki", type=Path, required=True)
    p.add_argument("--msg", type=Path, required=True)
    a = p.parse_args()
    files = read_bnd4(read_dcx((a.msg / LANGS["en"] / "menu.msgbnd.dcx").read_bytes()))
    talk = read_fmg(files["会話.fmg"])
    result = vote(talk, wiki_sections(a.wiki.read_text(encoding="utf-8", errors="replace")))
    result = {"source": "bloodborne-wiki.com, Dialogue Reference (2017), vote par réplique",
              "unknown": "Unknown NPC", **result}
    (HERE / "speakers.json").write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(result['blocks'])} blocs, {len(result['sub_blocks'])} sous-blocs : {result['sub_blocks']}")


if __name__ == "__main__":
    main()
