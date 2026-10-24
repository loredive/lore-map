# La carte du lore — V1

Une carte interactive de tous les textes d'Elden Ring (descriptions d'objets, d'armes,
d'armures, de talismans, compétences, écrans de chargement et dialogues des PNJ).
Chaque étoile est un texte ; les textes qui parlent des mêmes choses se regroupent.
Tout tourne en local, sans LLM ni serveur.

## Voir la carte tout de suite

Le dossier `web/data/` contient déjà une version de test (embeddings TF-IDF, projection t-SNE),
utilisable sans rien installer :

```bash
python -m http.server 8000 -d web
# puis ouvrir http://localhost:8000
```

Il faut passer par un serveur local : ouvrir `index.html` directement depuis le disque ne
marche pas, le navigateur bloque la lecture des fichiers de données.

## Générer la vraie version (embeddings sémantiques + UMAP)

```bash
pip install sentence-transformers umap-learn scikit-learn numpy
git clone https://github.com/EldenRingExplorer/EldenRingTextExplorer
python prepare.py --source EldenRingTextExplorer/elden_ring_text.json
```

Quelques minutes sur CPU, moins d'une sur GPU. Le script télécharge
`intfloat/multilingual-e5-small` et écrit dans `web/data/` :

- `lore.json` : textes, positions 2D, clusters et leurs noms, 8 « échos » par texte
- `emb.bin` : les embeddings en int8 (~1,2 Mo), pour la recherche par sens
- `meta.json` : le modèle à utiliser côté navigateur

Avec ces données, la recherche devient hybride : mots-clés (BM25) et sens (le même modèle e5,
chargé dans le navigateur par transformers.js au premier usage, ~120 Mo mis en cache), fusionnés
par Reciprocal Rank Fusion. On peut alors chercher en français (« la mère de Miquella ») dans des
textes anglais.

Options : `--embedder tfidf` (sans réseau ni GPU, pas de recherche par sens),
`--reducer tsne` (sans umap-learn), `--min-cluster 25` (taille minimale d'un cluster).

## Utiliser la carte

- Molette ou pincement pour zoomer, glisser pour se déplacer, double-clic pour zoomer.
- Cliquer une étoile ouvre sa fiche : texte complet, version japonaise, et ses **échos**,
  les textes les plus proches par le sens, reliés à elle sur la carte.
- Cliquer le nom d'un groupe ouvre sa fiche : titre, description, mots clés et liste de ses textes.
- « Comment lire cette carte », sous le titre, rappelle comment lire la carte.
- La légende masque ou réaffiche une catégorie.
- Clavier : `/` pour chercher, `Échap` pour fermer, `+`/`-` et flèches, `0` pour recentrer.
- L'adresse de la page change avec le texte ouvert : on peut copier un lien vers une fiche.

## Fichiers

```
prepare.py        données -> documents -> embeddings -> UMAP -> clusters -> export
web/index.html    la page
web/app.js        rendu canvas, caméra, recherche, fiche
web/search.js     BM25, similarité int8, fusion RRF (fonctions pures)
web/style.css
```

## Limites connues

- Le dump de textes date du jeu de base : **pas de textes du DLC Shadow of the Erdtree**.
  Pour l'ajouter, extraire les fichiers `msg` de son propre jeu (WitchyBND / Smithbox) et
  adapter `item_docs()` dans `prepare.py`.
- Les noms des clusters viennent de `labels.json` (`{"<id>": {"title", "description"}}`), écrits
  à la main à partir de `web/data/clusters.md` (mots clés c-TF-IDF, taille et 15 textes proches du
  centroïde de chaque cluster, régénéré à chaque `prepare.py`). Les clusters sans entrée gardent
  leurs mots clés. Les identifiants changent si les données ou les options changent : relire
  `clusters.md` et mettre `labels.json` à jour dans ce cas.
- Les dialogues sont découpés en passages de quelques répliques ; l'identité de l'interlocuteur
  n'est pas toujours connue.

Textes d'Elden Ring © FromSoftware / Bandai Namco. Projet de fan, non commercial.
