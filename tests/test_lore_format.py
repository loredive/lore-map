import json
from pathlib import Path

import numpy as np
import pytest

import layouts
import prepare
from lore_format import read_lore, write_lore

DATA = Path(__file__).resolve().parent.parent / "web" / "data"


def old_export_lore(docs, views, labels, names, titles, entities, nbrs, out):
    """Copie figée de l'écriture de lore.json dans export() avant lore_format : la référence octet pour octet."""
    cats = sorted({d["cat"] for d in docs})
    coords = np.hstack([xy for _, xy in views]).astype(float).round(4)
    rows = [[d["name"], cats.index(d["cat"]), d["text"], d["jp"], d["jp_name"],
             coords[i].tolist(), int(labels[i]), nbrs[i].tolist()] for i, d in enumerate(docs)]
    has_alt = any("alt" in d for d in docs)
    if has_alt:
        for row, d in zip(rows, docs):
            row += [d.get("alt", ""), d.get("alt_name", "")]
    has_dlc = any(d.get("dlc") for d in docs)
    if has_dlc:
        for row, d in zip(rows, docs):
            row.append(int(d.get("dlc", False)))
    cohesions = [layouts.cohesion(xy, labels) for _, xy in views]
    clusters = []
    for c, keywords in names.items():
        m = labels == c
        t = titles.get(c, {})
        at = [{"x": round(float(np.median(xy[m, 0])), 4), "y": round(float(np.median(xy[m, 1])), 4),
               "cohesion": round(coh[int(c)], 3)} for (_, xy), coh in zip(views, cohesions)]
        clusters.append({"id": int(c), "label": t.get("title") or keywords,
                         "description": t.get("description", ""), "keywords": keywords,
                         "n": int(m.sum()), "views": at})
        if t.get("alt_title"):
            clusters[-1].update(altLabel=t["alt_title"], altDescription=t.get("alt_description", ""))
    fields = (["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"] + (["alt", "altName"] if has_alt else [])
              + (["dlc"] if has_dlc else []))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "lore.json", "w", encoding="utf-8") as f:
        json.dump({"fields": fields, "views": [n for n, _ in views], "categories": cats,
                   "clusters": clusters, "entities": entities, "docs": rows},
                  f, ensure_ascii=False, separators=(",", ":"))


def synthetic(alt, dlc, n=24):
    """Une petite carte : deux vues, deux groupes et du bruit, du texte non ASCII."""
    rng = np.random.default_rng(7)
    cats = ["Armes", "Dialogues", "Objets"]
    docs = []
    for i in range(n):
        d = {"name": f"Texte {i} — « é »", "cat": cats[i % 3], "text": f"Ligne\n{i} \"citée\"", "jp": f"テキスト{i}",
             "jp_name": f"名前{i}"}
        if alt and i % 5:                      # certains textes sans seconde langue : colonne vide
            d.update(alt=f"Alt {i}", alt_name=f"Nom alt {i}")
        if dlc and i % 4 == 0:
            d["dlc"] = True
        docs.append(d)
    labels = np.array([i % 3 - 1 for i in range(n)])     # -1 (hors groupe), 0, 1
    xy1 = rng.normal(size=(n, 2)) + labels[:, None] * 3
    xy2 = rng.normal(size=(n, 2)) * 0.3
    xy1[0] = [0.11249999999, -1.0]                          # arrondis délicats
    views = [("t-SNE", xy1), ("UMAP", xy2)]
    names = {0: "lame, sang", 1: "chasse, lune"}
    titles = {0: {"title": "Lames", "description": "Des armes."}}
    if alt:
        titles[1] = {"title": "Lune", "description": "", "alt_title": "月", "alt_description": "夜"}
    entities = [{"name": "Gehrman", "label": "Gehrman", "kind": "character", "aliases": [], "docs": [1, 2],
                 "broad": False, "related": [["Maria", 2]]}]
    nbrs = np.array([[(i + 1) % n, (i + 2) % n] for i in range(n)])
    return docs, views, labels, names, titles, entities, nbrs


@pytest.mark.parametrize("alt,dlc", [(False, False), (True, False), (False, True), (True, True)])
def test_export_writes_the_same_bytes_as_before(tmp_path, alt, dlc):
    docs, views, labels, names, titles, entities, nbrs = synthetic(alt, dlc)
    old_export_lore(docs, views, labels, names, titles, entities, nbrs, tmp_path / "old")
    emb = np.zeros((len(docs), 4), dtype=np.float32)
    prepare.export(docs, emb, views, labels, names, titles, entities, nbrs, "tfidf", tmp_path / "new")
    assert (tmp_path / "new" / "lore.json").read_bytes() == (tmp_path / "old" / "lore.json").read_bytes()


def rewrite(lore, path):
    """Réécrit avec write_lore ce que read_lore a lu."""
    write_lore(path, views=lore["views"], categories=lore["categories"], clusters=lore["clusters"],
               entities=lore["entities"], docs=lore["docs"])


@pytest.mark.parametrize("game", ["bloodborne", "elden-ring"])
def test_committed_maps_read_and_rewritten_are_identical(tmp_path, game):
    src = DATA / game / "lore.json"
    rewrite(read_lore(src), tmp_path / "lore.json")
    assert (tmp_path / "lore.json").read_bytes() == src.read_bytes()


def test_read_lore_keys_docs_by_field_name(tmp_path):
    docs, views, labels, names, titles, entities, nbrs = synthetic(alt=True, dlc=True)
    prepare.export(docs, np.zeros((len(docs), 4)), views, labels, names, titles, entities, nbrs, "tfidf", tmp_path)
    lore = read_lore(tmp_path / "lore.json")
    assert lore["fields"] == ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes", "alt", "altName", "dlc"]
    assert lore["views"] == ["t-SNE", "UMAP"] and lore["categories"] == ["Armes", "Dialogues", "Objets"]
    first = lore["docs"][0]
    assert first == {"name": "Texte 0 — « é »", "cat": 0, "text": "Ligne\n0 \"citée\"", "jp": "テキスト0", "jpName": "名前0",
                     "xy": first["xy"], "cluster": -1, "echoes": [1, 2], "alt": "", "altName": "", "dlc": 1}
    assert first["xy"][:2] == [0.1125, -1.0] and len(first["xy"]) == 4
    assert lore["docs"][1]["dlc"] == 0 and lore["docs"][1]["alt"] == "Alt 1"
    moon = next(c for c in lore["clusters"] if c["id"] == 1)
    assert (moon["altLabel"], moon["altDescription"], len(moon["views"])) == ("月", "夜", 2)
    assert lore["entities"] == entities


def test_optional_columns_only_when_used(tmp_path):
    doc = {"name": "a", "cat": 0, "text": "", "jp": "", "jpName": "", "xy": [0.0, 0.0], "cluster": -1, "echoes": []}
    write_lore(tmp_path / "lore.json", views=["t-SNE"], categories=["Armes"], clusters=[], entities=[],
               docs=[doc, {**doc, "dlc": False}])
    lore = read_lore(tmp_path / "lore.json")
    assert lore["fields"] == ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"]
    assert lore["docs"][1] == doc
