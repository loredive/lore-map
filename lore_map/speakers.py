"""
Qui parle dans les dialogues d'un jeu Souls ? Les répliques sont rangées par blocs de 10 000
identifiants, un par personnage, sans nom. Chaque réplique est cherchée dans les pages des personnages
(et des marchands, des boss…) du jeu sur le wiki darksouls.fandom.com (leur texte source, par l'API du
wiki) ; chaque bloc prend la page qui cite le plus de ses répliques. Un bloc mêlé (son gagnant n'a pas
plus de la moitié des voix) n'a pas de nom par défaut : chacun de ses sous-blocs de 100 prend la page qui
cite le plus de ses répliques, et un sous-bloc qu'aucune ne cite reste sans nom. Ailleurs, pas
d'exception : une page cite souvent les répliques des autres qui parlent d'elle.

Un nom dont le wiki ne confirme pas au moins la moitié des répliques (CONFIRMED), un nom donné à la
main, et les répliques sans nom sont marqués incertains (« uncertain » : la raison, montrée par la page),
sauf les noms sûrs (Rules.sure), que leurs répliques suffisent à reconnaître.

Ce qui change d'un jeu à l'autre (catégories du wiki, noms corrigés ou donnés à la main, lecture des
dialogues) est dans lore_map/sources/<jeu>/speakers.py, qui appelle main(). Écrit games/<id>/speakers.json,
relu à la main.
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from lore_map.formats.dialog import speaker_for
from lore_map.games import GAMES

API = "https://darksouls.fandom.com/api.php?"
MIN_CHARS = 15                    # plus court (« Hmm... »), une réplique ne dit pas qui parle
MIN_VOTES = 3                     # en dessous, un bloc reste sans nom
MIN_SUB_VOTES = 2                 # un sous-bloc ne contredit son bloc qu'avec au moins ce score
MIXED = 0.5                       # part des voix du gagnant d'un bloc mêlé, au plus
CONFIRMED = 0.5                   # en dessous de cette part de répliques confirmées, un nom est incertain
UNKNOWN = "Unknown NPC"


@dataclass(frozen=True)
class Rules:
    """Ce qui est propre à un jeu dans le vote."""
    game: str                     # identifiant du jeu (games/<id>/speakers.json)
    title: str                    # nom du jeu, dans la source de speakers.json (« Dark Souls II »)
    wiki: str                     # nom du wiki dans les raisons d'incertitude (« The Dark Souls wiki confirms… »)
    pages: str                    # quelles pages, dans la source (« personnages, marchands et boss »)
    categories: tuple[str, ...]   # catégories du wiki dont les pages sont téléchargées
    rename: dict[str, str] = field(default_factory=dict)       # titre de page -> nom affiché
    manual: dict[str, str] = field(default_factory=dict)       # blocs qu'aucune page ne cite (ou mal)
    manual_sub: dict[str, str] = field(default_factory=dict)   # sous-blocs nommés à la main ; leur bloc n'a plus de nom
    sure: frozenset[str] = frozenset()                         # noms certains sans confirmation du wiki


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


def speakers(blocks: dict, subs: dict, rules: Rules) -> dict:
    """speakers.json : le gagnant de chaque bloc, et les sous-blocs qui en votent un autre."""
    def name(title):
        return rules.rename.get(title, title)
    out, mixed = {}, set()
    for b, c in sorted(blocks.items()):
        title, score = c.most_common(1)[0]
        if score <= MIXED * sum(c.values()):
            mixed.add(b)
        elif score >= MIN_VOTES:
            out[str(b)] = name(title)
    out.update(rules.manual)
    for s in rules.manual_sub:
        out.pop(str(int(s) // 100), None)                # le bloc mêlé n'a plus de nom à lui
    sub_blocks = dict(rules.manual_sub)
    for s, c in sorted(subs.items()):
        title, score = c.most_common(1)[0]
        if s // 100 in mixed and score >= MIN_SUB_VOTES:
            sub_blocks[str(s)] = name(title)
    return {"source": f"darksouls.fandom.com, pages des {rules.pages} de {rules.title}, vote par réplique",
            "unknown": UNKNOWN, "blocks": out, "sub_blocks": sub_blocks}


def uncertain(talk: dict[int, str], data: dict, hits: dict[int, list[str]], rules: Rules) -> dict[str, str]:
    """{nom: raison} des interlocuteurs incertains, d'après les répliques cherchées (hits) : celles que
    le wiki cite sous ce nom sont confirmées."""
    total, confirmed = Counter(), Counter()
    for i in hits:
        who = speaker_for(i, data) or data["unknown"]
        total[who] += 1
        confirmed[who] += any(rules.rename.get(t, t) == who for t in hits[i])
    out = {}
    for who, n in total.items():
        if who in rules.sure:
            continue
        if who == data["unknown"]:
            out[who] = "No source says who speaks these lines."
        elif who in {*rules.manual.values(), *rules.manual_sub.values()} and not confirmed[who]:
            out[who] = "Named from what the lines say; no source confirms it."
        elif confirmed[who] < CONFIRMED * n:
            out[who] = (f"The {rules.wiki} wiki confirms {confirmed[who]} of {n} lines; "
                        "the others are attributed by where they sit in the game files.")
    return out


def download(out: Path, categories: tuple[str, ...]) -> None:
    """Le texte source des pages de ces catégories du wiki, une requête par seconde."""
    def get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "lore-map (fan project)"})
        return json.load(urllib.request.urlopen(req, timeout=30))
    titles = set()
    for cat in categories:
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


def main(rules: Rules, description: str, add_args: Callable[[argparse.ArgumentParser], None],
         load_talk: Callable[[argparse.Namespace], dict[int, str]]) -> None:
    """La ligne de commande d'un jeu : --download, ou --wiki et les arguments du jeu (add_args), avec
    lesquels load_talk lit ses répliques anglaises."""
    p = argparse.ArgumentParser(description=description)
    p.add_argument("--download", type=Path, help="télécharge les pages du wiki dans ce fichier, puis s'arrête")
    p.add_argument("--wiki", type=Path, help="pages téléchargées par --download")
    add_args(p)
    a = p.parse_args()
    if a.download:
        download(a.download, rules.categories)
        return
    talk = load_talk(a)
    blocks, subs, hits = vote(talk, json.loads(a.wiki.read_text(encoding="utf-8")))
    data = speakers(blocks, subs, rules)
    data["uncertain"] = uncertain(talk, data, hits, rules)
    (GAMES / rules.game / "speakers.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n",
                                                      encoding="utf-8")
    lines = Counter(i // 10000 for i in talk)
    for b in sorted(lines):
        c = blocks.get(b, Counter())
        print(f"{b:6} {lines[b]:4} répliques  {data['blocks'].get(str(b), UNKNOWN):40} "
              + "; ".join(f"{t} {v:.0f}" for t, v in c.most_common(2)))
    print("exceptions :", data["sub_blocks"])
    print("incertains :", json.dumps(data["uncertain"], ensure_ascii=False, indent=1))
