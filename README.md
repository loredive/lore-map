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
`--reducer tsne` (sans umap-learn), `--min-cluster 15` et `--min-samples 5` (réglages de HDBSCAN :
taille minimale d'un groupe, et à quel point il doit être dense).

Les groupes sont calculés sur la carte 2D elle-même : ils restent d'un seul tenant à l'écran. Un
clustering sur une projection UMAP en 10 dimensions a été essayé ; il colle à peine mieux au sens
(+0,5 point de voisins communs) mais déborde nettement sur la carte (−6 points de contiguïté).

## Titres des groupes

Les titres sont écrits à la main dans `labels.json`, une liste d'entrées :

```json
{"title": "Pots à lancer", "description": "…", "members": ["Fire Pot", "Poison Pot", "…"]}
```

`members` liste les textes les plus centraux du groupe. À chaque `prepare.py`, un titre va au groupe
qui contient au moins la moitié de ses `members` (les meilleurs recouvrements d'abord, un titre
par groupe) : il suit donc son groupe même si les numéros de clusters changent.

`prepare.py` écrit aussi `web/data/clusters.md`, de quoi écrire les titres : pour chaque groupe son
titre actuel, ses mots clés, sa taille et ses 15 textes les plus centraux ; pour un groupe sans
titre, une entrée prête à copier dans `labels.json` ; et à la fin les titres dont le groupe s'est
dispersé. Les groupes sans titre gardent leurs mots clés sur la carte.

Quand un groupe change peu à peu, `--refresh-labels` réécrit `labels.json` en remplaçant les
`members` de chaque titre retrouvé par les textes centraux actuels. Après une scission, relire le
titre : il suit la plus grande part du groupe, mais son sens a pu se resserrer.

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
labels.py         rattachement des titres de labels.json aux clusters
labels.json       titres et descriptions des groupes
tests/            tests (uv run pytest)
web/index.html    la page
web/app.js        rendu canvas, caméra, recherche, fiche
web/search.js     BM25, similarité int8, fusion RRF (fonctions pures)
web/style.css
```

## Limites connues

- Le dump de textes date du jeu de base : **pas de textes du DLC Shadow of the Erdtree**.
  Pour l'ajouter, extraire les fichiers `msg` de son propre jeu (WitchyBND / Smithbox) et
  adapter `item_docs()` dans `prepare.py`.
- Environ 19 % des textes n'appartiennent à aucun groupe (bruit de HDBSCAN) : on les trouve par
  la recherche ou en cliquant leur étoile, pas par la fiche d'un groupe.
- Les grands groupes homogènes (armes, compétences, armures) ne se laissent pas découper en
  sous-groupes utiles ; ce sont les noms des petits groupes, affichés en zoomant, qui donnent le détail.
- Les groupes de dialogues se forment souvent autour d'un personnage plutôt que d'un sujet.
- Les dialogues sont découpés en passages de quelques répliques ; l'identité de l'interlocuteur
  n'est pas toujours connue.

Textes d'Elden Ring © FromSoftware / Bandai Namco. Projet de fan, non commercial.
