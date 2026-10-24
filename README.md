# La carte du lore — V1

Une carte interactive de tous les textes d'Elden Ring (descriptions d'objets, d'armes,
d'armures, de talismans, compétences, écrans de chargement et dialogues des PNJ).
Chaque étoile est un texte ; les textes qui parlent des mêmes choses se regroupent.
Tout tourne en local, sans LLM ni serveur.

## Voir la carte tout de suite

Le dossier `web/data/` contient déjà les données générées (embeddings e5, cartes t-SNE et UMAP,
groupes titrés), utilisables sans rien installer :

```bash
python -m http.server 8000 -d web
# puis ouvrir http://localhost:8000
```

Il faut passer par un serveur local : ouvrir `index.html` directement depuis le disque ne
marche pas, le navigateur bloque la lecture des fichiers de données.

## Régénérer les données (embeddings sémantiques, t-SNE et UMAP)

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
`--reducer` (carte principale, `tsne` par défaut, ou `umap`), `--alt-reducer` (vue alternative
proposée dans la page, `umap` par défaut, `none` pour s'en passer), `--min-cluster 15` et
`--min-samples 5` (réglages de HDBSCAN : taille minimale d'un groupe, et à quel point il doit être
dense).

### Pourquoi t-SNE pour la carte principale

Mesuré sur les 3 049 textes : part des 10 vrais voisins (dans l'espace des embeddings) retrouvés
parmi les 10 plus proches sur la carte, corrélation de rang entre distances d'origine et distances
sur la carte, puis les groupes de HDBSCAN (15/5) calculés sur chaque carte.

| | UMAP (nn 15) | t-SNE (perplexité 30) |
|---|---|---|
| Voisins gardés | 0,470 | **0,542** |
| Structure globale | 0,386 | **0,421** |
| Groupes / textes hors groupe | 69 / 19 % | 64 / 21 % |
| Contiguïté des groupes sur la carte | 0,976 | 0,972 |
| Accord des groupes avec les vrais voisins | 0,793 | **0,811** |

Des UMAP plus « globaux » (nn 30 ou 50) gardent moins de voisins, et à nn 50 HDBSCAN ne trouve plus
que deux masses. Une carte en 3D gagnerait environ 4 points de voisins pour beaucoup de complexité
(WebGL, noms qui se cachent, sélection en profondeur) : écartée.

Les groupes sont calculés sur la carte principale elle-même, pour rester d'un seul tenant à l'écran.
Un clustering sur une projection UMAP en 10 dimensions colle à peine mieux au sens (+0,5 point de
voisins communs) mais déborde nettement sur la carte (−6 points de contiguïté).

### La vue alternative

La page propose aussi la carte UMAP, avec **les mêmes groupes** : on bascule de l'une à l'autre et
les étoiles glissent jusqu'à leur nouvelle place. La vue alternative est alignée sur la principale
(Procrustes : rotation, miroir, échelle) pour que seul bouge ce qui diffère vraiment. Les groupes
qui s'y éparpillent (cohésion sous 0,6 : moins de 60 % des voisins d'un texte sur la carte sont de
son groupe) n'y affichent pas leur nom.

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

## Personnages, lieux, factions et notions

`entities.json` liste à la main les noms qui traversent les textes, avec leur type (`personnage`,
`lieu`, `faction`, `notion`), d'éventuels `aliases` (variantes du même nom seulement), un `label`
français facultatif et des expressions à `exclude` (« Crystal Torrent » n'est pas Torrent) :

```json
{"name": "Mohg", "kind": "personnage", "aliases": ["Lord of Blood"]}
```

Un texte mentionne une entité si son nom ou son corps contient l'un de ses noms, en mot entier et
en respectant la casse : « Mohg » ne prend pas « Mohgwyn », « Death » (la notion) ne prend pas
« death ». Les identités qui relèvent de la théorie (Godfrey et Hoarah Loux, par exemple) restent
deux entrées distinctes.

`prepare.py` écrit `web/data/entities.md` : pour chaque entrée, le nombre de textes et les groupes où
elle revient le plus, puis les noms propres fréquents que la liste ne couvre pas encore.

## Utiliser la carte

- Molette ou pincement pour zoomer, glisser pour se déplacer, double-clic pour zoomer.
- Cliquer une étoile ouvre sa fiche : texte complet, version japonaise, et ses **échos**,
  les textes les plus proches par le sens, reliés à elle sur la carte.
- Cliquer le nom d'un groupe ouvre sa fiche : titre, description, mots clés et liste de ses textes.
- « Comment lire cette carte », sous le titre, rappelle comment lire la carte.
- « Personnages et lieux » ouvre l'index des personnages, lieux, factions et notions. Chaque fiche
  liste les textes qui en parlent, les fait briller sur la carte et indique les groupes où ils se
  trouvent. La fiche d'un texte liste aussi ce qu'il mentionne, et chercher un nom connu
  (« Godwyn », « Lord of Blood ») propose sa fiche en tête des résultats.
- « Projection », en bas à droite, passe de la carte t-SNE à la carte UMAP : mêmes textes, mêmes
  groupes, autre façon d'aplatir. Ce qui reste proche dans les deux vues l'est vraiment.
- La légende masque ou réaffiche une catégorie.
- Clavier : `/` pour chercher, `Échap` pour fermer, `+`/`-` et flèches, `0` pour recentrer.
- L'adresse de la page change avec le texte ou la fiche ouverte (`#entite=Godwyn`) : on peut copier
  un lien vers une fiche.

## Fichiers

```
prepare.py        données -> documents -> embeddings -> t-SNE (+ UMAP) -> clusters -> export
labels.py         rattachement des titres de labels.json aux clusters
labels.json       titres et descriptions des groupes
layouts.py        projections 2D, alignement de la vue alternative, cohésion des groupes
entities.py       textes qui mentionnent chaque entité de entities.json
entities.json     personnages, lieux, factions et notions
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
