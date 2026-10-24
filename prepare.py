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
    docs = []
    for rec in data.get("dialog", {}).values():
        npc = re.sub(r"\s+dialog$", "", rec.get("name_en", "").strip(), flags=re.I)
        lines = [(int(i), clean(t)) for i, t in LINE_RE.findall(rec.get("info_en", ""))]
        lines = [(i, t) for i, t in lines if t and not any(j in t for j in JUNK)]
        chunk, last_id, part = [], None, 1

        def flush():
            nonlocal chunk, part
            text = "\n".join(chunk).strip()
            if len(text) >= 40:
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
def cluster(xy, min_size):
    from sklearn.cluster import HDBSCAN
    return HDBSCAN(min_cluster_size=min_size, min_samples=8).fit_predict(xy)


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


def load_titles(path):
    """Titres écrits à la main (labels.json, optionnel) : {"<id>": {"title", "description"}}."""
    if not path.exists():
        return {}
    titles = {int(k): v for k, v in json.loads(path.read_text(encoding="utf-8")).items()}
    print(f"{len(titles)} titres lus dans {path.name}")
    return titles


def write_cluster_digest(docs, emb, labels, names, k=15, chars=200):
    """clusters.md : pour chaque cluster, ses mots clés et les textes les plus proches du
    centroïde, de quoi lui écrire un titre dans labels.json."""
    lines = ["# Clusters\n",
             ("Pour chaque cluster : mots clés c-TF-IDF, taille, et les "
              f"{k} textes les plus proches du centroïde (embeddings).\n")]
    for c, keywords in names.items():
        idx = np.where(labels == c)[0]
        centroid = emb[idx].mean(axis=0)
        closest = idx[np.argsort(-(emb[idx] @ centroid))[:k]]
        lines.append(f"## Cluster {c} — {keywords} ({len(idx)} textes)\n")
        for i in closest:
            text = re.sub(r"\s+", " ", docs[i]["text"])[:chars]
            lines.append(f"- **{docs[i]['name']}** ({docs[i]['cat']}) : {text}")
        lines.append("")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "clusters.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------- export
def export(docs, emb, xy, labels, names, titles, nbrs, embedder):
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
        t = titles.get(int(c), {})
        clusters.append({"id": int(c), "label": t.get("title") or keywords,
                         "description": t.get("description", ""), "keywords": keywords,
                         "n": int(m.sum()),
                         "x": round(float(np.median(xy[m, 0])), 4),
                         "y": round(float(np.median(xy[m, 1])), 4)})
    fields = ["name", "cat", "text", "jp", "jpName", "x", "y", "cluster", "echoes"]
    with open(OUT / "lore.json", "w", encoding="utf-8") as f:
        json.dump({"fields": fields, "categories": cats, "clusters": clusters,
                   "docs": rows}, f, ensure_ascii=False, separators=(",", ":"))

    semantic = embedder == "e5"
    meta = {"n": len(docs), "dim": int(emb.shape[1]), "semantic": semantic,
            "model": BROWSER_MODEL if semantic else None, "queryPrefix": "query: "}
    if semantic:
        # int8 par vecteur normalisé : ~4x plus léger, classement quasi identique
        (np.clip(np.round(emb * 127), -127, 127).astype(np.int8)).tofile(OUT / "emb.bin")
    with open(OUT / "meta.json", "w") as f:
        json.dump(meta, f)
    print(f"Exporté dans {OUT} : {len(docs)} textes, {len(clusters)} clusters "
          f"({sum(int(c) in titles for c in names)} titrés), recherche sémantique {'activée' if semantic else 'désactivée'}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True, help="elden_ring_text.json")
    p.add_argument("--embedder", choices=["e5", "tfidf"], default="e5")
    p.add_argument("--reducer", choices=["umap", "tsne"], default="umap")
    p.add_argument("--min-cluster", type=int, default=25)
    p.add_argument("--labels", type=Path, default=Path(__file__).parent / "labels.json",
                   help="titres des clusters (optionnel)")
    a = p.parse_args()

    data = json.loads(Path(a.source).read_text(encoding="utf-8"))
    docs = item_docs(data) + dialog_docs(data)
    from collections import Counter
    print(f"{len(docs)} textes :", dict(Counter(d["cat"] for d in docs)))

    emb = embed(docs, a.embedder)
    print("Projection 2D…")
    xy = reduce_2d(emb, a.reducer)
    labels = cluster(xy, a.min_cluster)
    names = label_clusters(docs, labels)
    print(f"{len(names)} clusters, {(labels == -1).mean():.0%} de points hors cluster")
    write_cluster_digest(docs, emb, labels, names)
    export(docs, emb, xy, labels, names, load_titles(a.labels), neighbors(emb), a.embedder)


if __name__ == "__main__":
    main()
