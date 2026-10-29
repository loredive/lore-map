"""
Le format de web/data/<id>/lore.json, écrit et lu à un seul endroit (bibliothèque standard seulement).

Le fichier : {"fields", "views", "categories", "clusters", "entities", "docs"}. Chaque texte est une
ligne positionnelle décrite par `fields` : name, cat (indice dans categories), text, jp, jpName,
xy (x, y de chaque vue à la suite), cluster (-1 : hors groupe), echoes (indices des textes voisins),
puis alt, altName (seconde langue) et dlc (0/1), présents seulement si au moins un texte s'en sert.
La page le décode dans web/lore.js.
"""
import json

FIELDS = ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"]
ALT_FIELDS = ["alt", "altName"]


def write_lore(path, *, views, categories, clusters, entities, docs):
    """Écrit lore.json, compact (les accents tels quels).

    views : noms des vues ; categories : noms des catégories ;
    docs : un dict par texte, clés = noms des champs (cat en indice, xy en liste de flottants déjà arrondis,
    alt / altName / dlc facultatifs : colonne alt si un texte a « alt », colonne dlc si un texte est du DLC) ;
    clusters : dicts id, label, description, keywords, n, views ([{x, y, cohesion}] par vue),
    et altLabel / altDescription (seconde langue, gardés seulement si altLabel n'est pas vide) ;
    entities : écrites telles quelles."""
    has_alt = any("alt" in d for d in docs)
    has_dlc = any(d.get("dlc") for d in docs)
    fields = FIELDS + (ALT_FIELDS if has_alt else []) + (["dlc"] if has_dlc else [])
    rows = []
    for d in docs:
        row = [d[k] for k in FIELDS]
        if has_alt:
            row += [d.get("alt", ""), d.get("altName", "")]
        if has_dlc:
            row.append(int(bool(d.get("dlc", False))))
        rows.append(row)
    groups = []
    for c in clusters:
        g = {k: c[k] for k in ("id", "label", "description", "keywords", "n", "views")}
        if c.get("altLabel"):
            g.update(altLabel=c["altLabel"], altDescription=c.get("altDescription", ""))
        groups.append(g)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"fields": fields, "views": views, "categories": categories,
                   "clusters": groups, "entities": entities, "docs": rows},
                  f, ensure_ascii=False, separators=(",", ":"))


def read_lore(path):
    """Lit lore.json : le fichier tel quel, sauf docs, un dict par texte avec les noms des champs pour clés."""
    with open(path, encoding="utf-8") as f:
        lore = json.load(f)
    fields = lore["fields"]
    lore["docs"] = [dict(zip(fields, row)) for row in lore["docs"]]
    return lore
