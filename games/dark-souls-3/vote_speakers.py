"""
Qui parle dans 会話.fmg ? Les répliques sont rangées par blocs de 10 000 identifiants, un par
personnage (le bloc 0 en mêle plusieurs, par sous-blocs de 100), sans nom. Chaque réplique est
cherchée dans les pages des personnages et des boss de Dark Souls III du wiki darksouls.fandom.com
(leur texte source, par l'API du wiki) ; chaque bloc prend la page qui cite le plus de ses
répliques. Un bloc mêlé (son gagnant n'a pas plus de la moitié des voix) n'a pas de nom par défaut :
chacun de ses sous-blocs prend la page qui cite le plus de ses répliques, et un sous-bloc qu'aucune ne
cite reste sans nom. Ailleurs, pas d'exception : une page cite souvent les répliques des autres qui
parlent d'elle.

Un nom dont le wiki ne confirme pas au moins la moitié des répliques (CONFIRMED), un nom donné à la
main, et les répliques sans nom sont marqués incertains (« uncertain » : la raison, montrée par la page),
sauf les noms de SURE, que leurs répliques suffisent à reconnaître.
Quelques noms sont corrigés à la main (RENAME, MANUAL). Écrit speakers.json, relu à la main.

Usage (une fois ; les pages sont téléchargées à part, ce sont des données, pas du code) :
    uv run python games/dark-souls-3/vote_speakers.py --download /tmp/wiki/ds3_pages.json
    uv run python games/dark-souls-3/vote_speakers.py --wiki /tmp/wiki/ds3_pages.json \\
        --msg "/mnt/c/Games/Steam/steamapps/common/DARK SOULS III/Game/msg"
"""
import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))      # souls_formats.py, à la racine du dépôt
from souls_formats import speaker_for  # noqa: E402

API = "https://darksouls.fandom.com/api.php?"
CATEGORIES = ("Dark_Souls_III:_Characters", "Dark_Souls_III:_Bosses")
MIN_CHARS = 15                    # plus court (« Hmm... »), une réplique ne dit pas qui parle
MIN_VOTES = 3                     # en dessous, un bloc reste sans nom
MIN_SUB_VOTES = 2                 # un sous-bloc ne contredit son bloc qu'avec au moins ce score
MIXED = 0.5                       # part des voix du gagnant d'un bloc mêlé, au plus
CONFIRMED = 0.5                   # en dessous de cette part de répliques confirmées, un nom est incertain
UNKNOWN = "Unknown NPC"
# titres de pages -> nom affiché
RENAME = {
    "Fire Keeper (Dark Souls III)": "Fire Keeper",
    "Lorian, Elder Prince and Lothric, Younger Prince": "Lothric, Younger Prince",   # Lorian ne parle pas
    "Forlorn Corvian Settler (character)": "Corvian Settler",
    "Emma, High Priestess of Lothric Castle": "Emma, High Priestess",
    "Nestling": "Pickle Pee, Pump-a-Rum Crow",          # « Me, me, pickle-pee. »
}
# blocs qu'aucune page ne cite, nommés d'après leurs répliques
MANUAL = {
    "100": "Narrator",                                   # le récit d'ouverture (« Yes, indeed. »)
    "7500": "Darkdiver Grandahl",                        # « Fear not, the dark, my friend. »
}

# noms certains sans confirmation du wiki : leurs répliques ne laissent pas de doute
SURE = {
    "Narrator",                       # le récit d'ouverture (« It is called Lothric… »)
    "Pickle Pee, Pump-a-Rum Crow",    # ses répliques non citées sont la même comptine de troc
}


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower().replace("’", "'")).strip()


def page_text(wikitext: str) -> str:
    """Le texte d'une page sans balises ni liens, normalisé et entouré d'espaces (pour chercher des
    répliques entières)."""
    plain = re.sub(r"<[^>]+>|\[\[([^|\]]*\|)?|\]\]|'''?", " ", wikitext)
    return f" {norm(plain)} "


def vote(talk: dict[int, str], pages: dict[str, str]) -> tuple[dict, dict, dict]:
    """({bloc: Counter(page)}, {sous-bloc: Counter(page)}, {réplique: pages qui la citent}) : une
    réplique trouvée sur n pages donne 1/n voix à chacune ; une réplique trop courte n'est pas cherchée."""
    texts = {title: page_text(w) for title, w in pages.items()}
    blocks, subs, hits = defaultdict(Counter), defaultdict(Counter), {}
    for i, line in talk.items():
        n = norm(line)
        if len(n) < MIN_CHARS:
            continue
        hits[i] = [title for title, t in texts.items() if f" {n} " in t]
        for title in hits[i]:
            blocks[i // 10000][title] += 1 / len(hits[i])
            subs[i // 100][title] += 1 / len(hits[i])
    return blocks, subs, hits


def speakers(blocks: dict, subs: dict) -> dict:
    """speakers.json : le gagnant de chaque bloc, et les sous-blocs qui en votent un autre."""
    def name(title):
        return RENAME.get(title, title)
    out, mixed = {}, set()
    for b, c in sorted(blocks.items()):
        title, score = c.most_common(1)[0]
        if score <= MIXED * sum(c.values()):
            mixed.add(b)
        elif score >= MIN_VOTES:
            out[str(b)] = name(title)
    out.update(MANUAL)
    sub_blocks = {}
    for s, c in sorted(subs.items()):
        title, score = c.most_common(1)[0]
        if s // 100 in mixed and score >= MIN_SUB_VOTES:
            sub_blocks[str(s)] = name(title)
    return {"source": "darksouls.fandom.com, pages des personnages et boss de Dark Souls III, vote par réplique",
            "unknown": UNKNOWN, "blocks": out, "sub_blocks": sub_blocks}


def uncertain(talk: dict[int, str], data: dict, hits: dict[int, list[str]]) -> dict[str, str]:
    """{nom: raison} des interlocuteurs incertains, d'après les répliques cherchées (hits) : celles que
    le wiki cite sous ce nom sont confirmées."""
    total, confirmed = Counter(), Counter()
    for i in hits:
        who = speaker_for(i, data) or data["unknown"]
        total[who] += 1
        confirmed[who] += any(RENAME.get(t, t) == who for t in hits[i])
    out = {}
    for who, n in total.items():
        if who in SURE:
            continue
        if who == data["unknown"]:
            out[who] = "No source says who speaks these lines."
        elif who in MANUAL.values() and not confirmed[who]:
            out[who] = "Named from what the lines say; no source confirms it."
        elif confirmed[who] < CONFIRMED * n:
            out[who] = (f"The Dark Souls wiki confirms {confirmed[who]} of {n} lines; "
                        "the others are attributed by where they sit in the game files.")
    return out


def download(out: Path) -> None:
    """Le texte source des pages des catégories CATEGORIES, une requête par seconde."""
    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "lore-map (fan project)"})
        return json.load(urllib.request.urlopen(req, timeout=30))
    titles = set()
    for cat in CATEGORIES:
        q = get(API + f"action=query&list=categorymembers&cmtitle=Category:{cat}&cmlimit=500&format=json")
        titles |= {m["title"] for m in q["query"]["categorymembers"] if m["ns"] == 0}
        time.sleep(1)
    pages = {}
    for t in sorted(titles):
        pages[t] = get(API + "action=parse&prop=wikitext&format=json&page=" + urllib.parse.quote(t))["parse"]["wikitext"]["*"]
        time.sleep(1)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    print(f"{len(pages)} pages écrites dans {out}")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    p.add_argument("--download", type=Path, help="télécharge les pages du wiki dans ce fichier, puis s'arrête")
    p.add_argument("--wiki", type=Path, help="pages téléchargées par --download")
    p.add_argument("--msg", type=Path, help="dossier Game/msg/ du jeu, ouvert par UXM")
    a = p.parse_args()
    if a.download:
        download(a.download)
        return
    from extract import load_tables  # ici : les tests chargent ce fichier sans le dossier du jeu
    tables, _dlc = load_tables(a.msg)
    talk = {i: t for i, t in tables["en"]["会話"].items() if t != "(dummyText)"}
    blocks, subs, hits = vote(talk, json.loads(a.wiki.read_text(encoding="utf-8")))
    data = speakers(blocks, subs)
    data["uncertain"] = uncertain(talk, data, hits)
    (HERE / "speakers.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    lines = Counter(i // 10000 for i in talk)
    for b in sorted(lines):
        c = blocks.get(b, Counter())
        print(f"{b:6} {lines[b]:4} répliques  {data['blocks'].get(str(b), UNKNOWN):40} "
              + "; ".join(f"{t} {v:.0f}" for t, v in c.most_common(2)))
    print("exceptions :", data["sub_blocks"])
    print("incertains :", json.dumps(data["uncertain"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
