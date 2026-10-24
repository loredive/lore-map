"""
La carte du lore — préparation des données (V1, sans LLM).

Lit le JSON d'EldenRingTextExplorer, construit les documents (descriptions
d'objets + dialogues découpés), calcule les embeddings, la projection 2D, les
clusters et leurs étiquettes, puis exporte tout pour la page web dans web/data/.

Usage (chez toi) :
    pip install sentence-transformers umap-learn scikit-learn pandas numpy
    git clone https://github.com/EldenRingExplorer/EldenRingTextExplorer
    python prepare.py --source EldenRingTextExplorer/elden_ring_text.json

Options utiles :
    --embedder tfidf      sans réseau ni GPU (pas de recherche sémantique dans la page)
    --reducer tsne        si umap-learn n'est pas installé
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np

from entities import KINDS, candidate_names, find_mentions, load_entities
from labels import load_titles, match_titles, save_titles

MODEL_NAME = "intfloat/multilingual-e5-small"      # mêmes poids que Xenova/multilingual-e5-small (navigateur)
BROWSER_MODEL = "Xenova/multilingual-e5-small"
OUT = Path(__file__).parent / "web" / "data"

# catégorie du JSON -> (libellé affiché, champs EN concaténés, champ JP)
CATEGORIES = {
    "goods":       ("Objets",               ["caption_en"], "caption_jp"),
    "weapon":      ("Armes",                ["caption_en"], "caption_jp"),
    "protector":   ("Armures",              ["caption_en"], "caption_jp"),
    "accessories": ("Talismans",            ["caption_en"], "caption_jp"),
    "gems":        ("Cendres de guerre",    ["caption_en"], "caption_jp"),
    "arts":        ("Compétences",          ["caption_en"], "caption_jp"),
    "loading":     ("Écrans de chargement", ["caption_en"], "caption_jp"),
}
DIALOG_LABEL = "Dialogues"
JUNK = ("%null%", "(dummyText)", "[ERROR]", "dummy")

# Mots trop fréquents dans les descriptions pour nommer un cluster
EXTRA_STOP = """thou thee thy thine thyself hath doth art ye upon shall unto also used use uses
using increases increase increased boosts boost raises raise greatly slightly temporarily attack
attacks attacking damage fp hp stamina skill skills armament armaments effect effects equipped
wearer foes foe enemies enemy item items one two may can will would could said known
weapon weapons armor set sets ash war affinity following grants performs allows additional
input charge charged held hold time times well even still yet like whose within among
""".split()


# ---------------------------------------------------------------- nettoyage
def clean(text):
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"<\?[^>]*\?>", "", text)          # balises de touches <?keyicon@25?>
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_junk(text):
    return len(text) < 40 or any(j in text for j in JUNK)


# ---------------------------------------------------------------- documents
def item_docs(data):
    docs, seen = [], set()
    for key, (label, en_fields, jp_field) in CATEGORIES.items():
        for _id, rec in data.get(key, {}).items():
            name = clean(rec.get("name_en", ""))
            text = "\n\n".join(clean(rec.get(f, "")) for f in en_fields if rec.get(f))
            if not name or any(j in name for j in JUNK) or is_junk(text):
                continue
            # Les armes améliorées / infusées partagent la même description, et les
            # variantes numérotées ("... Bell Bearing [2]") ne diffèrent que par une liste
            name = re.sub(r"\s*\[\d+\]$", "", name)
            sig_text, sig_name = (key, text), (key, name)
            if sig_text in seen or sig_name in seen:
                continue
            seen.update([sig_text, sig_name])
            docs.append({"name": name, "cat": label, "text": text,
                         "jp": clean(rec.get(jp_field, "")),
                         "jp_name": clean(rec.get("name_jp", ""))})
    return docs


LINE_RE = re.compile(r"\[(\d+)\]\s*(.*?)(?=<br/><br/>\s*\[\d+\]|$)", re.S)


def dialog_docs(data, max_chars=550):
    """Découpe chaque dialogue de PNJ en passages de quelques répliques consécutives."""
    docs, seen = [], set()      # certains dialogues (didascalies) répètent les mêmes passages
    for rec in data.get("dialog", {}).values():
        npc = re.sub(r"\s+dialog$", "", rec.get("name_en", "").strip(), flags=re.I)
        lines = [(int(i), clean(t)) for i, t in LINE_RE.findall(rec.get("info_en", ""))]
        lines = [(i, t) for i, t in lines if t and not any(j in t for j in JUNK)]
        chunk, last_id, part = [], None, 1

        def flush():
            nonlocal chunk, part
            text = "\n".join(chunk).strip()
            if len(text) >= 40 and text not in seen:
                seen.add(text)
                docs.append({"name": f"{npc} — passage {part}", "cat": DIALOG_LABEL,
                             "text": text, "jp": "", "jp_name": ""})
                part += 1
            chunk = []

        for i, t in lines:
            # une nouvelle conversation commence quand l'identifiant saute d'un bloc
            new_conv = last_id is not None and i // 1000 != last_id // 1000
            if chunk and (new_conv or sum(map(len, chunk)) + len(t) > max_chars):
                flush()
            chunk.append(t)
            last_id = i
        if chunk:
            flush()
    return docs


# ---------------------------------------------------------------- embeddings
def embed(docs, embedder):
    texts = [f"{d['name']}. {d['text']}" for d in docs]
    if embedder == "e5":
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(MODEL_NAME)
        # e5 attend le préfixe "passage: " pour les documents et "query: " pour les requêtes
        emb = model.encode(["passage: " + t for t in texts], batch_size=64,
                           normalize_embeddings=True, show_progress_bar=True)
        return np.asarray(emb, dtype=np.float32)
    # Repli sans réseau : TF-IDF + SVD (sert à tester la carte, pas à la recherche sémantique)
    from sklearn.decomposition import TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import normalize
    tfidf = TfidfVectorizer(sublinear_tf=True, stop_words="english", min_df=2,
                            ngram_range=(1, 2), max_features=60000).fit_transform(texts)
    emb = TruncatedSVD(256, random_state=0).fit_transform(tfidf)
    return normalize(emb).astype(np.float32)


def reduce_2d(emb, reducer):
    if reducer == "umap":
        try:
            import umap
            return umap.UMAP(n_neighbors=15, min_dist=0.08, metric="cosine",
                             random_state=42).fit_transform(emb)
        except ImportError:
            print("umap-learn absent -> repli sur t-SNE")
    from sklearn.manifold import TSNE
    return TSNE(n_components=2, perplexity=30, init="pca", metric="cosine",
                random_state=42).fit_transform(emb)


def neighbors(emb, k=8, block=2048):
    """Les k voisins les plus proches de chaque texte (les « échos »)."""
    out = np.empty((len(emb), k), dtype=np.int32)
    for s in range(0, len(emb), block):
        sims = emb[s:s + block] @ emb.T
        for r in range(sims.shape[0]):
            sims[r, s + r] = -1                      # pas soi-même
        idx = np.argpartition(-sims, k, axis=1)[:, :k]
        order = np.take_along_axis(sims, idx, axis=1).argsort(axis=1)[:, ::-1]
        out[s:s + block] = np.take_along_axis(idx, order, axis=1)
    return out


# ---------------------------------------------------------------- clusters
def cluster(xy, min_size, min_samples):
    """HDBSCAN sur la carte 2D elle-même : les groupes restent d'un seul tenant à l'écran
    (un clustering en 10D colle à peine mieux au sens, mais déborde sur la carte)."""
    from sklearn.cluster import HDBSCAN
    return HDBSCAN(min_cluster_size=min_size, min_samples=min_samples, copy=True).fit_predict(xy)


def label_clusters(docs, labels, top=3):
    """Étiquettes par c-TF-IDF : les mots les plus distinctifs de chaque cluster."""
    from sklearn.feature_extraction.text import CountVectorizer, ENGLISH_STOP_WORDS
    ids = sorted(set(labels) - {-1})
    corpus = [" ".join(f"{docs[i]['name']} {docs[i]['text']}"
                       for i in np.where(labels == c)[0]) for c in ids]
    cv = CountVectorizer(stop_words=list(ENGLISH_STOP_WORDS) + EXTRA_STOP,
                         token_pattern=r"(?u)\b[A-Za-z][A-Za-z'-]{2,}\b", min_df=2)
    counts = cv.fit_transform(corpus).toarray().astype(float)
    tf = counts / counts.sum(axis=1, keepdims=True)
    idf = np.log(1 + counts.sum(axis=1).mean() / counts.sum(axis=0))
    scores = tf * idf
    vocab = np.array(cv.get_feature_names_out())
    return {c: ", ".join(w.capitalize() for w in vocab[np.argsort(-scores[j])[:top]])
            for j, c in enumerate(ids)}


def central_texts(emb, labels, names, k=15):
    """Les k textes les plus proches du centroïde (embeddings) de chaque cluster."""
    out = {}
    for c in names:
        idx = np.where(labels == c)[0]
        out[c] = idx[np.argsort(-(emb[idx] @ emb[idx].mean(axis=0)))[:k]]
    return out


def write_cluster_digest(docs, labels, names, central, titles, stale, chars=200):
    """clusters.md : pour chaque cluster, son titre (ou une entrée labels.json à compléter),
    ses mots clés et ses textes les plus centraux ; puis les titres qui n'ont plus de cluster."""
    lines = ["# Clusters\n",
             ("Pour chaque cluster : titre actuel, mots clés c-TF-IDF, taille, et les textes "
              "les plus proches du centroïde (embeddings). Un titre suit son groupe tant "
              "qu'on y retrouve au moins la moitié de ses « members ».\n")]
    for c, keywords in names.items():
        title = titles[c]["title"] if c in titles else "(sans titre)"
        lines.append(f"## Cluster {c} — {title} ({int((labels == c).sum())} textes)\n")
        lines.append(f"Mots clés : {keywords}\n")
        if c not in titles:
            entry = {"title": "", "description": "",
                     "members": [docs[i]["name"] for i in central[c]]}
            lines += ["```json", json.dumps(entry, ensure_ascii=False) + ",", "```\n"]
        for i in central[c]:
            text = re.sub(r"\s+", " ", docs[i]["text"])[:chars]
            lines.append(f"- **{docs[i]['name']}** ({docs[i]['cat']}) : {text}")
        lines.append("")
    if stale:
        lines.append("# Titres sans cluster\n")
        lines.append("Leurs groupes se sont dispersés : à réattribuer ou à supprimer de labels.json.\n")
        lines += [f"- {e['title']}" for e in stale]
        lines.append("")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "clusters.md").write_text("\n".join(lines), encoding="utf-8")


def resolve_titles(docs, labels, names, central, path, refresh):
    """Rattache les titres de labels.json aux clusters ; avec refresh, réécrit le fichier
    en remplaçant les « members » des titres retrouvés par les textes centraux actuels."""
    entries = load_titles(path)
    members = {c: {docs[i]["name"] for i in np.where(labels == c)[0]} for c in names}
    titles, stale = match_titles(entries, members)
    print(f"{len(entries)} titres dans {path.name} : {len(titles)} rattachés, "
          f"{len(stale)} sans cluster, {len(names) - len(titles)} clusters sans titre")
    if refresh and entries:
        for c, e in titles.items():
            e["members"] = [docs[i]["name"] for i in central[c]]
        save_titles(path, [titles[c] for c in names if c in titles] + stale)
        print(f"{path.name} mis à jour")
    return titles, stale


def resolve_entities(docs, labels, titles, names, path):
    """Textes qui mentionnent chaque entité de entities.json, et entities.md pour compléter la liste."""
    entities = load_entities(path)
    found = find_mentions(entities, docs)
    lines = ["# Personnages, lieux, factions et notions\n",
             "Pour chaque entrée de entities.json : nombre de textes qui la mentionnent et groupes "
             "où elle apparaît le plus. Puis les noms propres fréquents pas encore couverts.\n"]
    for kind in KINDS:
        lines.append(f"## {kind.capitalize()}s\n")
        for e in (e for e in entities if e["kind"] == kind):
            idx = found[e["name"]]
            groups = {}
            for i in idx:
                if labels[i] >= 0:
                    groups[labels[i]] = groups.get(labels[i], 0) + 1
            top = sorted(groups.items(), key=lambda g: -g[1])[:3]
            where = ", ".join(f"{titles[c]['title'] if c in titles else names[c]} ({k})" for c, k in top)
            lines.append(f"- **{e.get('label', e['name'])}** : {len(idx)} textes — {where}")
        lines.append("")
    lines.append("## Candidats\n")
    lines += [f"- {w} ({n} textes)" for w, n in candidate_names(entities, docs)]
    (OUT / "entities.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(entities)} entités dans {path.name}")
    return [{"name": e["name"], "label": e.get("label", e["name"]), "kind": e["kind"],
             "aliases": e.get("aliases", []), "docs": found[e["name"]]}
            for e in entities if found[e["name"]]]


# ---------------------------------------------------------------- export
def export(docs, emb, xy, labels, names, titles, entities, nbrs, embedder):
    OUT.mkdir(parents=True, exist_ok=True)
    xy = xy - xy.mean(axis=0)
    xy = xy / np.abs(xy).max()
    cats = sorted({d["cat"] for d in docs})
    rows = [[d["name"], cats.index(d["cat"]), d["text"], d["jp"], d["jp_name"],
             round(float(x), 4), round(float(y), 4), int(l), nb.tolist()]
            for d, (x, y), l, nb in zip(docs, xy, labels, nbrs)]
    clusters = []
    for c, keywords in names.items():
        m = labels == c
        t = titles.get(c, {})
        clusters.append({"id": int(c), "label": t.get("title") or keywords,
                         "description": t.get("description", ""), "keywords": keywords,
                         "n": int(m.sum()),
                         "x": round(float(np.median(xy[m, 0])), 4),
                         "y": round(float(np.median(xy[m, 1])), 4)})
    fields = ["name", "cat", "text", "jp", "jpName", "x", "y", "cluster", "echoes"]
    with open(OUT / "lore.json", "w", encoding="utf-8") as f:
        json.dump({"fields": fields, "categories": cats, "clusters": clusters,
                   "entities": entities, "docs": rows}, f, ensure_ascii=False, separators=(",", ":"))

    semantic = embedder == "e5"
    meta = {"n": len(docs), "dim": int(emb.shape[1]), "semantic": semantic,
            "model": BROWSER_MODEL if semantic else None, "queryPrefix": "query: "}
    if semantic:
        # int8 par vecteur normalisé : ~4x plus léger, classement quasi identique
        (np.clip(np.round(emb * 127), -127, 127).astype(np.int8)).tofile(OUT / "emb.bin")
    with open(OUT / "meta.json", "w") as f:
        json.dump(meta, f)
    print(f"Exporté dans {OUT} : {len(docs)} textes, {len(clusters)} clusters "
          f"({len(titles)} titrés), recherche sémantique {'activée' if semantic else 'désactivée'}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True, help="elden_ring_text.json")
    p.add_argument("--embedder", choices=["e5", "tfidf"], default="e5")
    p.add_argument("--reducer", choices=["umap", "tsne"], default="umap")
    p.add_argument("--min-cluster", type=int, default=15)
    p.add_argument("--min-samples", type=int, default=5)
    p.add_argument("--labels", type=Path, default=Path(__file__).parent / "labels.json",
                   help="titres des clusters (optionnel)")
    p.add_argument("--entities", type=Path, default=Path(__file__).parent / "entities.json",
                   help="personnages, lieux, factions et notions (optionnel)")
    p.add_argument("--refresh-labels", action="store_true",
                   help="réécrit labels.json avec les textes centraux actuels de chaque titre")
    a = p.parse_args()

    data = json.loads(Path(a.source).read_text(encoding="utf-8"))
    docs = item_docs(data) + dialog_docs(data)
    from collections import Counter
    print(f"{len(docs)} textes :", dict(Counter(d["cat"] for d in docs)))

    emb = embed(docs, a.embedder)
    print("Projection 2D…")
    xy = reduce_2d(emb, a.reducer)
    labels = cluster(xy, a.min_cluster, a.min_samples)
    names = label_clusters(docs, labels)
    print(f"{len(names)} clusters, {(labels == -1).mean():.0%} de points hors cluster")
    central = central_texts(emb, labels, names)
    titles, stale = resolve_titles(docs, labels, names, central, a.labels, a.refresh_labels)
    write_cluster_digest(docs, labels, names, central, titles, stale)
    entities = resolve_entities(docs, labels, titles, names, a.entities)
    export(docs, emb, xy, labels, names, titles, entities, neighbors(emb), a.embedder)


if __name__ == "__main__":
    main()
