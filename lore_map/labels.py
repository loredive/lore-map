"""
Titres des clusters écrits à la main (labels.json), rattachés aux clusters par
leurs textes membres plutôt que par l'identifiant HDBSCAN, qui change dès que
les données ou les réglages changent.
"""
import json

MIN_SHARE = 0.5     # part minimale des membres d'un titre à retrouver dans le cluster


def match_titles(entries, clusters, min_share=MIN_SHARE):
    """Associe chaque titre au cluster qui contient le plus de ses textes membres.

    entries  : [{"title", "description", "members": [noms de textes]}]
    clusters : {id: ensemble des noms de textes du cluster}
    Renvoie ({id: entrée}, [entrées sans cluster]).
    """
    # paires (part retrouvée, titre, cluster), les meilleures attribuées d'abord,
    # chaque cluster et chaque titre au plus une fois
    pairs = sorted(((len(set(e["members"]) & members) / max(1, len(e["members"])), k, c)
                    for k, e in enumerate(entries) for c, members in clusters.items()),
                   key=lambda p: -p[0])
    matched, used = {}, set()
    for share, k, c in pairs:
        if share < min_share:
            break
        if k in used or c in matched:
            continue
        matched[c] = entries[k]
        used.add(k)
    stale = [e for k, e in enumerate(entries) if k not in used]
    return matched, stale


def load_titles(path):
    """labels.json : liste d'entrées {"title", "description", "members"} (optionnel)."""
    if not path.exists():
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise TypeError(f"{path.name} : ancien format indexé par identifiant de cluster ; "
                         "il faut une liste d'entrées avec leurs « members »")
    return entries


def save_titles(path, entries):
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
