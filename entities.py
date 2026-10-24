"""
Personnages, lieux, factions et notions (entities.json, écrit à la main) et les
textes qui les mentionnent, dans leur nom ou leur corps.
"""
import json
import re


def _pattern(entity):
    # mots entiers et sensible à la casse : « Mohg » ne prend pas « Mohgwyn »,
    # « Death » (la notion) ne prend pas « death »
    names = sorted([entity["name"], *entity.get("aliases", [])], key=len, reverse=True)
    return re.compile(r"(?<![\w-])(?:" + "|".join(map(re.escape, names)) + r")(?![\w-])")


def _mentions(pat, exclude, text):
    # les expressions exclues (« Crystal Torrent ») sont retirées avant la recherche
    for x in exclude:
        text = text.replace(x, " ")
    return pat.search(text) is not None


def find_mentions(entities, docs):
    """{nom de l'entité: [indices des textes qui la mentionnent]}, dans l'ordre des textes."""
    found = {}
    for e in entities:
        pat, exclude = _pattern(e), e.get("exclude", [])
        found[e["name"]] = [i for i, d in enumerate(docs)
                            if _mentions(pat, exclude, d["name"]) or _mentions(pat, exclude, d["text"])]
    return found


KINDS = ["personnage", "lieu", "faction", "notion"]

# mots capitalisés fréquents qui ne sont pas des noms propres du lore
_COMMON = set("""The This That These Those When Use Can Once Though Craftable Skill Item Hold Deals
Charging Greatly Boosts Raises Restores Increases Creates Summons Fires Grants Ash War Armament
Sorcery Incantation Tarnished Lord Lady Sir Master Queen King God Lands Between I'm I've I'll I'd
You But One Ring Order Night Flame Fingers Finger Knight Witch Hunter Golden Magic Heavy Quality
Keen Sacred Tears Live Those Who Multiplayer Academy Roundtable""".split())
_CANDIDATE = re.compile(r"(?<![.!?\n\"“]\s)(?<!^)\b([A-Z][a-z'’-]{2,}(?:\s(?:of\s)?[A-Z][a-z'’-]{2,})?)")


def load_entities(path):
    """entities.json : [{"name", "kind", "aliases", "label"?, "exclude"?}] (optionnel)."""
    if not path.exists():
        return []
    entities = json.loads(path.read_text(encoding="utf-8"))
    bad = [e["name"] for e in entities if e.get("kind") not in KINDS]
    if bad:
        raise ValueError(f"{path.name} : type inconnu pour {bad} (attendu : {KINDS})")
    return entities


def candidate_names(entities, docs, min_texts=6):
    """Noms propres fréquents que entities.json ne couvre pas encore : [(nom, nb de textes)]."""
    known = {n for e in entities for n in [e["name"], *e.get("aliases", [])]}
    counts = {}
    for d in docs:
        for w in {re.sub(r"'s$", "", m.group(1).replace("’", "'")) for m in _CANDIDATE.finditer(d["text"])}:
            counts[w] = counts.get(w, 0) + 1

    def covered(w):
        return w in _COMMON or any(k in w or w in k for k in known)

    return sorted(((w, n) for w, n in counts.items() if n >= min_texts and not covered(w)),
                  key=lambda p: -p[1])
