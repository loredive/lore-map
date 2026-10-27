"""
Embeddings des requêtes d'évaluation (games/<id>/eval/queries.json), avec le modèle e5 de prepare.py.

La page utilise la version quantifiée (q8) des mêmes poids dans le navigateur : les scores
diffèrent un peu, le classement presque pas.

Usage : uv run python eval/embed_queries.py [--game elden-ring]
"""
import argparse
import json
import sys
from pathlib import Path

from sentence_transformers import SentenceTransformer

HERE = Path(__file__).parent


def main():
    sys.path.insert(0, str(HERE.parent))
    from games import DEFAULT, load_game
    from prepare import MODEL_NAME  # le même modèle que pour les textes

    p = argparse.ArgumentParser()
    p.add_argument("--game", default=DEFAULT)
    folder = load_game(p.parse_args().game).dir / "eval"
    queries = [q["query"] for q in json.loads((folder / "queries.json").read_text(encoding="utf-8"))["queries"]]
    model = SentenceTransformer(MODEL_NAME)
    vecs = model.encode(["query: " + q for q in queries], normalize_embeddings=True)
    out = {q: [round(float(x), 6) for x in v] for q, v in zip(queries, vecs)}
    (folder / "query_vectors.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} requêtes encodées")


if __name__ == "__main__":
    main()
