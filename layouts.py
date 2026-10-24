"""
Projections 2D des embeddings : la carte principale, une vue alternative alignée
sur elle, et la cohésion des groupes dans chaque vue.
"""
import numpy as np

NAMES = {"tsne": "t-SNE", "umap": "UMAP"}


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


def normalize(xy):
    """Centre la carte et la ramène dans [-1, 1]."""
    xy = xy - xy.mean(axis=0)
    return xy / np.abs(xy).max()


def align_to(xy, ref):
    """Rotation (ou miroir), échelle et translation qui superposent au mieux xy à ref
    (Procrustes orthogonal) : le passage d'une vue à l'autre ne bouge que ce qui diffère."""
    a, b = xy - xy.mean(axis=0), ref - ref.mean(axis=0)
    u, s, vt = np.linalg.svd(a.T @ b)
    r = u @ vt
    return (a @ r) * (s.sum() / (a ** 2).sum()) + ref.mean(axis=0)


def cohesion(xy, labels, k=8):
    """Pour chaque groupe : part des k voisins sur la carte de ses textes qui sont du même groupe."""
    from sklearn.neighbors import NearestNeighbors
    nn = NearestNeighbors(n_neighbors=k + 1).fit(xy).kneighbors(xy, return_distance=False)[:, 1:]
    same = labels[nn] == labels[:, None]
    return {int(c): float(same[labels == c].mean()) for c in set(labels) - {-1}}
