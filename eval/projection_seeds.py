"""
Compare les projections t-SNE et UMAP de prepare.py sur plusieurs graines : part des vrais
voisins gardés sur la carte, structure globale, et groupes HDBSCAN obtenus (nombre, bruit,
accord avec les vrais voisins, contiguïté sur la carte). C'est ce qui a fait choisir t-SNE.

Usage : uv run python eval/projection_seeds.py [--seeds 5]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
K = 10


def measure(emb, xy, true, pairs):
    from scipy.stats import spearmanr
    from sklearn.cluster import HDBSCAN
    from sklearn.neighbors import NearestNeighbors
    nn = NearestNeighbors(n_neighbors=K + 1).fit(xy).kneighbors(xy, return_distance=False)
    kept = np.mean([len(set(a) & set(b)) / K for a, b in zip(true, nn[:, 1:])])
    i, j = pairs
    glob = spearmanr(1 - (emb[i] * emb[j]).sum(1), np.linalg.norm(xy[i] - xy[j], axis=1)).statistic
    lab = HDBSCAN(min_cluster_size=15, min_samples=5, copy=True).fit_predict(xy)
    m = lab >= 0
    return {"voisins": kept, "global": glob, "groupes": len(set(lab) - {-1}), "bruit": float(np.mean(~m)),
            "accord": float((lab[true[m, :8]] == lab[m, None]).mean()),
            "contiguïté": float((lab[nn[m, 1:9]] == lab[m, None]).mean())}


def main():
    sys.path.insert(0, str(HERE.parent))
    import umap
    from sklearn.manifold import TSNE
    from sklearn.neighbors import NearestNeighbors

    from prepare import dialog_docs, embed, item_docs

    p = argparse.ArgumentParser()
    p.add_argument("--source", default=str(HERE.parent.parent / "EldenRingTextExplorer" / "elden_ring_text.json"))
    p.add_argument("--seeds", type=int, default=5)
    a = p.parse_args()
    data = json.loads(Path(a.source).read_text(encoding="utf-8"))
    emb = embed(item_docs(data) + dialog_docs(data), "e5")
    true = NearestNeighbors(n_neighbors=K + 1, metric="cosine").fit(emb).kneighbors(emb, return_distance=False)[:, 1:]
    rng = np.random.default_rng(0)
    pairs = (rng.integers(0, len(emb), 4000), rng.integers(0, len(emb), 4000))
    runs = {"UMAP": lambda s: umap.UMAP(n_neighbors=15, min_dist=0.08, metric="cosine", random_state=s),
            "t-SNE": lambda s: TSNE(perplexity=30, init="pca", metric="cosine", random_state=s)}
    for name, make in runs.items():
        res = [measure(emb, make(s).fit_transform(emb), true, pairs) for s in range(a.seeds)]
        print(name, " · ".join(f"{k}={np.mean([r[k] for r in res]):.3f}±{np.std([r[k] for r in res]):.3f}"
                              for k in res[0]))


if __name__ == "__main__":
    main()
