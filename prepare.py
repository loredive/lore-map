"""
La carte du lore — préparation des données.

Lit le JSON d'EldenRingTextExplorer, construit les documents (descriptions
d'objets + dialogues découpés), calcule les embeddings, la projection 2D, les
clusters et leurs étiquettes, puis exporte tout pour la page web dans web/data/.

Ce qui dépend du jeu (catégories, mots vides, noms, réglages) est dans games/<id>/game.json ;
les données vont dans web/data/<id>/.

Usage (chez toi) :
    uv sync
    git clone https://github.com/EldenRingExplorer/EldenRingTextExplorer
    uv run python prepare.py --source EldenRingTextExplorer/elden_ring_text.json   # --game elden-ring

Options utiles :
    --embedder tfidf      sans réseau ni GPU (pas de recherche sémantique dans la page)
    --reducer umap        carte en UMAP plutôt qu'en t-SNE
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np

import layouts
from entities import KINDS, candidate_names, load_entities, rank_mentions, related_entities
from games import DEFAULT, list_games, load_game, publish
from labels import load_titles, match_titles, save_titles

MODEL_NAME = "intfloat/multilingual-e5-small"      # mêmes poids que Xenova/multilingual-e5-small (navigateur)
BROWSER_MODEL = "Xenova/multilingual-e5-small"


# ---------------------------------------------------------------- nettoyage
def clean(text):
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"<\?[^>]*\?>", "", text)          # balises de touches <?keyicon@25?>
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_junk(text, junk, min_chars=40):
    return len(text) < min_chars or any(j in text for j in junk)


# ---------------------------------------------------------------- documents
def in_lang(field, game, lang):
    """Le même champ dans une autre langue : caption_fr -> caption_en."""
    return field.removesuffix(f"_{game.text_lang}") + f"_{lang}"


def item_docs(data, game):
    """Descriptions d'objets ; game.categories : clé du JSON source -> libellé, champs du texte, champ JP.
    Avec game.alt_lang, chaque texte garde aussi son nom et son texte dans la seconde langue."""
    docs, seen = [], set()
    name_field = f"name_{game.text_lang}"
    for key, cat in game.categories.items():
        label, text_fields, jp_field = cat.label, cat.text_fields, cat.jp_field
        for _id, rec in data.get(key, {}).items():
            name = clean(rec.get(name_field, ""))
            text = "\n\n".join(clean(rec.get(f, "")) for f in text_fields if rec.get(f))
            if not name or any(j in name for j in game.junk) or is_junk(text, game.junk, game.min_chars):
                continue
            # Les armes améliorées / infusées partagent la même description, et les
            # variantes numérotées ("... Bell Bearing [2]") ne diffèrent que par une liste
            name = re.sub(r"\s*\[\d+\]$", "", name)
            sig_text, sig_name = (key, text), (key, name)
            if sig_text in seen or sig_name in seen:
                continue
            seen.update([sig_text, sig_name])
            doc = {"name": name, "cat": label, "text": text,
                   "jp": clean(rec.get(jp_field, "")),
                   "jp_name": clean(rec.get("name_jp", "")),
                   "dlc": bool(rec.get("dlc"))}
            if game.alt_lang:
                doc["alt"] = "\n\n".join(clean(rec.get(in_lang(f, game, game.alt_lang), "")) for f in text_fields).strip()
                doc["alt_name"] = clean(rec.get(in_lang(name_field, game, game.alt_lang), ""))
            docs.append(doc)
    return docs


def speaker_name(raw, names):
    """Nom affiché d'un interlocuteur (raw : nom du dump, sans le suffixe « dialog ») ;
    names : libellés du dump qui ne sont pas des noms (« Narator »…), traduits pour la page."""
    name = re.sub(r"\s*\(cut npc\)$", " (cut NPC)", raw, flags=re.I)
    return names.get(name, name)


LINE_RE = re.compile(r"\[(\d+)\]\s*(.*?)(?=<br/><br/>\s*\[\d+\]|$)", re.S)


def dialog_docs(data, game, max_chars=550):
    """Découpe chaque dialogue de PNJ en passages de quelques répliques consécutives."""
    docs, seen = [], set()      # certains dialogues (didascalies) répètent les mêmes passages
    for rec in data.get("dialog", {}).values():
        raw = re.sub(r"\s+dialog$", "", rec.get("name_en", "").strip(), flags=re.I)
        npc = speaker_name(raw, game.speaker_names)
        lines = [(int(i), clean(t)) for i, t in LINE_RE.findall(rec.get(f"info_{game.text_lang}", ""))]
        lines = [(i, t) for i, t in lines if t and not any(j in t for j in game.junk)]
        dlc_lines = set(rec.get("dlc_lines", []))     # répliques ajoutées par le DLC
        # les mêmes répliques dans la seconde langue, par identifiant
        alt = dict((int(i), clean(t)) for i, t in LINE_RE.findall(rec.get(f"info_{game.alt_lang}", ""))) \
            if game.alt_lang else {}
        chunk, ids, last_id, part = [], [], None, 1

        def flush():
            nonlocal chunk, ids, part
            text = "\n".join(chunk).strip()
            if len(text) >= game.min_chars and text not in seen:
                seen.add(text)
                # le nom affiché est nettoyé, mais les embeddings gardent celui du dump :
                # corriger un libellé ne doit pas déplacer les textes sur la carte
                doc = {"name": f"{npc} — passage {part}", "embed_name": f"{raw} — passage {part}",
                       "cat": game.dialog_label, "text": text, "jp": "", "jp_name": "",
                       # un passage vient du DLC quand la plupart de ses répliques en viennent
                       "dlc": 2 * sum(k in dlc_lines for k in ids) > len(ids)}
                if game.alt_lang:
                    doc["alt"] = "\n".join(alt.get(k, "") for k in ids).strip()
                    doc["alt_name"] = ""
                docs.append(doc)
                part += 1
            chunk, ids = [], []

        for i, t in lines:
            # une nouvelle conversation commence quand l'identifiant saute d'un bloc
            new_conv = last_id is not None and i // 1000 != last_id // 1000
            if chunk and (new_conv or sum(map(len, chunk)) + len(t) > max_chars):
                flush()
            chunk.append(t)
            ids.append(i)
            last_id = i
        if chunk:
            flush()
    return docs


# ---------------------------------------------------------------- embeddings
def embed(docs, embedder):
    texts = [f"{d.get('embed_name', d['name'])}. {d['text']}" for d in docs]
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
def cluster(xy, min_size, min_samples, max_size=None):
    """HDBSCAN sur la carte 2D elle-même : les groupes restent d'un seul tenant à l'écran
    (un clustering en 10D colle à peine mieux au sens, mais déborde sur la carte).
    max_size : sur un petit corpus, HDBSCAN peut préférer un groupe énorme qui en avale plusieurs."""
    from sklearn.cluster import HDBSCAN
    return HDBSCAN(min_cluster_size=min_size, min_samples=min_samples, max_cluster_size=max_size,
                   copy=True).fit_predict(xy)


def label_clusters(docs, labels, extra_stop=(), top=3, lang="en"):
    """Étiquettes par c-TF-IDF : les mots les plus distinctifs de chaque cluster.
    En anglais, mots vides de scikit-learn et lettres ASCII ; sinon, lettres accentuées comprises,
    et les mots vides viennent tous de game.json (extra_stop)."""
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, CountVectorizer
    ids = sorted(set(labels) - {-1})
    corpus = [" ".join(f"{docs[i]['name']} {docs[i]['text']}"
                       for i in np.where(labels == c)[0]) for c in ids]
    english = lang == "en"
    cv = CountVectorizer(stop_words=(list(ENGLISH_STOP_WORDS) if english else []) + list(extra_stop),
                         token_pattern=r"(?u)\b[A-Za-z][A-Za-z'-]{2,}\b" if english else r"(?u)\b[^\W\d_][\w-]{2,}\b",
                         min_df=2)
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


def write_cluster_digest(docs, labels, names, central, titles, stale, out, chars=200):
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
    out.mkdir(parents=True, exist_ok=True)
    (out / "clusters.md").write_text("\n".join(lines), encoding="utf-8")


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


def resolve_entities(docs, labels, titles, names, path, out):
    """Textes qui mentionnent chaque entité de entities.json, et entities.md pour compléter la liste."""
    entities = load_entities(path)
    ranked = rank_mentions(entities, docs)
    found = {n: [i for i, _ in r] for n, r in ranked.items()}      # les plus pertinents d'abord
    related = related_entities(entities, found)
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
    (out / "entities.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(entities)} entités dans {path.name}")
    return [{"name": e["name"], "label": e.get("label", e["name"]), "kind": e["kind"],
             "aliases": e.get("aliases", []), "docs": found[e["name"]], "broad": bool(e.get("broad")),
             "related": [[b, n] for b, n in related[e["name"]]],
             **({"exclude": e["exclude"]} if e.get("exclude") else {})}
            for e in entities if found[e["name"]]]


# ---------------------------------------------------------------- export
def export(docs, emb, views, labels, names, titles, entities, nbrs, embedder, out):
    """views : [(nom, xy)] ; la première est la carte principale, sur laquelle les groupes
    ont été calculés, les suivantes lui sont alignées."""
    out.mkdir(parents=True, exist_ok=True)
    cats = sorted({d["cat"] for d in docs})
    coords = np.hstack([xy for _, xy in views]).astype(float).round(4)   # float64 : pas de 0.11249999…
    rows = [[d["name"], cats.index(d["cat"]), d["text"], d["jp"], d["jp_name"],
             coords[i].tolist(), int(labels[i]), nbrs[i].tolist()] for i, d in enumerate(docs)]
    has_alt = any("alt" in d for d in docs)        # seconde langue (game.json : alt_lang)
    if has_alt:
        for row, d in zip(rows, docs):
            row += [d.get("alt", ""), d.get("alt_name", "")]
    has_dlc = any(d.get("dlc") for d in docs)      # textes ajoutés par un DLC (Bloodborne : extract.py --base)
    if has_dlc:
        for row, d in zip(rows, docs):
            row.append(int(d.get("dlc", False)))
    cohesions = [layouts.cohesion(xy, labels) for _, xy in views]
    clusters = []
    for c, keywords in names.items():
        m = labels == c
        t = titles.get(c, {})
        # position du nom et cohésion du groupe dans chaque vue
        at = [{"x": round(float(np.median(xy[m, 0])), 4), "y": round(float(np.median(xy[m, 1])), 4),
               "cohesion": round(coh[int(c)], 3)} for (_, xy), coh in zip(views, cohesions)]
        clusters.append({"id": int(c), "label": t.get("title") or keywords,
                         "description": t.get("description", ""), "keywords": keywords,
                         "n": int(m.sum()), "views": at})
        # titre et description dans la seconde langue du jeu (labels.json : alt_title, alt_description)
        if t.get("alt_title"):
            clusters[-1].update(altLabel=t["alt_title"], altDescription=t.get("alt_description", ""))
    fields = (["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"] + (["alt", "altName"] if has_alt else [])
              + (["dlc"] if has_dlc else []))
    with open(out / "lore.json", "w", encoding="utf-8") as f:
        json.dump({"fields": fields, "views": [n for n, _ in views], "categories": cats,
                   "clusters": clusters, "entities": entities, "docs": rows},
                  f, ensure_ascii=False, separators=(",", ":"))

    semantic = embedder == "e5"
    meta = {"n": len(docs), "dim": int(emb.shape[1]), "semantic": semantic,
            "model": BROWSER_MODEL if semantic else None, "queryPrefix": "query: "}
    if semantic:
        # int8 par vecteur normalisé : ~4x plus léger, classement quasi identique
        (np.clip(np.round(emb * 127), -127, 127).astype(np.int8)).tofile(out / "emb.bin")
    with open(out / "meta.json", "w") as f:
        json.dump(meta, f)
    print(f"Exporté dans {out} : {len(docs)} textes, {len(clusters)} clusters "
          f"({len(titles)} titrés), recherche sémantique {'activée' if semantic else 'désactivée'}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--source", required=True, help="texte source du jeu (elden_ring_text.json…)")
    p.add_argument("--game", default=DEFAULT, choices=list_games(), help="dossier games/<id>/")
    p.add_argument("--embedder", choices=["e5", "tfidf"], default="e5")
    p.add_argument("--reducer", choices=["tsne", "umap"], default="tsne",
                   help="carte principale, sur laquelle les groupes sont calculés")
    p.add_argument("--min-cluster", type=int, help="défaut : game.json")
    p.add_argument("--min-samples", type=int, help="défaut : game.json")
    p.add_argument("--labels", type=Path, help="titres des clusters (défaut : games/<id>/labels.json)")
    p.add_argument("--entities", type=Path,
                   help="personnages, lieux, factions et notions (défaut : games/<id>/entities.json)")
    p.add_argument("--refresh-labels", action="store_true",
                   help="réécrit labels.json avec les textes centraux actuels de chaque titre")
    a = p.parse_args()
    game = load_game(a.game)
    out = game.data_dir
    labels_path, entities_path = a.labels or game.dir / "labels.json", a.entities or game.dir / "entities.json"

    data = json.loads(Path(a.source).read_text(encoding="utf-8"))
    docs = item_docs(data, game) + dialog_docs(data, game)
    from collections import Counter
    print(f"{len(docs)} textes :", dict(Counter(d["cat"] for d in docs)))

    emb = embed(docs, a.embedder)
    print("Projection 2D…")
    xy = layouts.normalize(layouts.reduce_2d(emb, a.reducer))
    views = [(layouts.NAMES[a.reducer], xy)]
    labels = cluster(xy, a.min_cluster or game.min_cluster, a.min_samples or game.min_samples,
                     game.cfg.get("max_cluster"))
    names = label_clusters(docs, labels, game.extra_stop, lang=game.text_lang)
    print(f"{len(names)} clusters, {(labels == -1).mean():.0%} de points hors cluster")
    central = central_texts(emb, labels, names)
    titles, stale = resolve_titles(docs, labels, names, central, labels_path, a.refresh_labels)
    write_cluster_digest(docs, labels, names, central, titles, stale, out)
    entities = resolve_entities(docs, labels, titles, names, entities_path, out)
    export(docs, emb, views, labels, names, titles, entities, neighbors(emb), a.embedder, out)
    publish(game)


if __name__ == "__main__":
    main()
