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


def _count(pat, exclude, text):
    # les expressions exclues (« Crystal Torrent ») sont retirées avant la recherche
    for x in exclude:
        text = text.replace(x, " ")
    return len(pat.findall(text))


TITLE_WEIGHT = 0.5   # un nom dans le titre seul compte moins qu'une mention dans le texte


def rank_mentions(entities, docs):
    """{nom: [(indice, score)]} des textes qui mentionnent l'entité, les plus pertinents d'abord.

    Score : nombre de mentions dans le corps du texte, plus TITLE_WEIGHT si son nom la contient
    (sauf entités « body_only », dont le nom apparaît dans trop de noms d'objets)."""
    ranked = {}
    for e in entities:
        pat, exclude = _pattern(e), e.get("exclude", [])
        scored = []
        for i, d in enumerate(docs):
            score = _count(pat, exclude, d["text"])
            if not e.get("body_only") and _count(pat, exclude, d["name"]):
                score += TITLE_WEIGHT
            if score:
                scored.append((i, score))
        ranked[e["name"]] = sorted(scored, key=lambda p: -p[1])   # tri stable : ordre des textes à égalité
    return ranked


def find_mentions(entities, docs):
    """{nom de l'entité: [indices des textes qui la mentionnent]}, dans l'ordre des textes."""
    return {n: sorted(i for i, _ in r) for n, r in rank_mentions(entities, docs).items()}


def related_entities(entities, found, min_shared=2, top=6):
    """{nom: [(autre nom, textes en commun)]} : les entités les plus souvent citées ensemble.

    Classées par textes partagés / sqrt(taille de chacune), pour que les noms très fréquents ne
    l'emportent pas partout ; les entités « broad » n'entrent pas dans ces listes."""
    sets = {e["name"]: set(found[e["name"]]) for e in entities if not e.get("broad")}
    related = {}
    for e in entities:
        a = e["name"]
        if e.get("broad"):
            related[a] = []
            continue
        pairs = [(b, len(sets[a] & sb)) for b, sb in sets.items() if b != a]
        pairs = [(b, n) for b, n in pairs if n >= min_shared]
        pairs.sort(key=lambda p: -p[1] / (len(sets[a]) * len(sets[p[0]])) ** 0.5)
        related[a] = pairs[:top]
    return related


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
