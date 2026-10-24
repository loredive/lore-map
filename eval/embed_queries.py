"""
Embeddings des requêtes d'évaluation (eval/queries.json), avec le modèle e5 de prepare.py.

La page utilise la version quantifiée (q8) des mêmes poids dans le navigateur : les scores
diffèrent un peu, le classement presque pas.

Usage : uv run python eval/embed_queries.py
"""
import json
from pathlib import Path

from sentence_transformers import SentenceTransformer

HERE = Path(__file__).parent
MODEL_NAME = "intfloat/multilingual-e5-small"     # le même que prepare.py


def main():
    queries = [q["query"] for q in json.loads((HERE / "queries.json").read_text(encoding="utf-8"))["queries"]]
    model = SentenceTransformer(MODEL_NAME)
    vecs = model.encode(["query: " + q for q in queries], normalize_embeddings=True)
    out = {q: [round(float(x), 6) for x in v] for q, v in zip(queries, vecs)}
    (HERE / "query_vectors.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} requêtes encodées")


if __name__ == "__main__":
    main()
