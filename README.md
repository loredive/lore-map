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
git clone https://github.com/EldenRingExplorer/EldenRingTextExplorer ../EldenRingTextExplorer
uv sync
uv run python prepare.py --source ../EldenRingTextExplorer/elden_ring_text.json
```

Quelques minutes sur CPU, moins d'une sur GPU. Le script télécharge
`intfloat/multilingual-e5-small` et écrit dans `web/data/` :

- `lore.json` : textes, positions 2D, clusters et leurs noms, 8 « échos » par texte
- `emb.bin` : les embeddings en int8 (~1,2 Mo), pour la recherche par sens
- `meta.json` : le modèle à utiliser côté navigateur

Avec ces données, la recherche devient hybride : mots-clés (BM25) et sens (le même modèle e5,
chargé dans le navigateur par transformers.js au premier usage, ~120 Mo mis en cache), fusionnés
par Reciprocal Rank Fusion, les mots-clés comptant moitié moins que le sens (voir *Évaluer la
recherche*). On peut alors chercher en français (« qui a assassiné Godwyn ») dans des textes anglais.

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

Le résultat tient sur 5 graines (`uv run python eval/projection_seeds.py`) : voisins gardés
0,543 ± 0,001 pour t-SNE contre 0,467 ± 0,003 pour UMAP, t-SNE devant à chaque graine, et plus
stable d'une graine à l'autre ; accord des groupes 0,812 ± 0,004 contre 0,792 ± 0,009.

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

Deux options pour les noms trop présents : `"body_only": true` ignore les mentions dans le nom
du texte (« Erdtree Greatshield » ne parle pas de l'Erdtree) ; `"broad": true` garde la fiche de
l'entité mais la retire des pastilles « Mentionne » et des listes « Liés à » (Erdtree, Entre-terre,
Seigneur d'Elden, présents partout).

Sur une fiche, les textes sont classés par pertinence : nombre de mentions dans le corps du texte,
plus un demi-point si son nom la contient ; ceux qui ne la nomment que dans leur titre passent en
dernier. « Liés à » liste les entités citées dans les mêmes textes (au moins deux), classées par
affinité (textes en commun divisés par la racine du produit des deux tailles), pour que les noms très
fréquents ne l'emportent pas partout.

`prepare.py` écrit `web/data/entities.md` : pour chaque entrée, le nombre de textes et les groupes où
elle revient le plus, puis les noms propres fréquents que la liste ne couvre pas encore.

## Utiliser la carte

- Molette ou pincement pour zoomer, glisser pour se déplacer, double-clic pour zoomer.
- Chaque groupe se dessine en constellation : ses étoiles sont reliées par l'arbre couvrant minimal de
  leurs positions. Une étoile est d'autant plus grosse que d'autres textes la comptent parmi leurs
  échos ; les grands groupes sont nommés en capitales, les petits apparaissent en zoomant.
  `?style=a` affiche la carte sans cet habillage, `?style=b` sans halos ni nébuleuses.
- Au doigt, toucher un endroit où plusieurs étoiles se serrent zoome sur lui, puis propose la liste
  de leurs noms (et du groupe, si un nom de groupe est dessous) : on choisit au lieu d'ouvrir une
  voisine par erreur.
- Cliquer une étoile ouvre sa fiche : texte complet, version japonaise, et ses **échos**,
  les textes les plus proches par le sens, reliés à elle sur la carte.
- Cliquer le nom d'un groupe ouvre sa fiche : titre, description, mots clés et liste de ses textes.
  Un fin pointillé marque le contour des groupes, comme les frontières des constellations sur les
  atlas anciens ; celui du groupe ouvert ou survolé passe en or et englobe tous ses textes.
- La fiche d'un texte indique son groupe ; pour un texte hors groupe, celui de la plupart de ses
  échos (« Hors groupe · le plus proche : … »).
- « Tracer un chemin vers un autre texte », sur la fiche d'un texte, puis un clic sur une étoile
  ou une recherche pour choisir l'arrivée : la carte trace le plus court chemin d'écho en écho entre
  les deux (de Ranni à l'icône de Radagon : 5 échos, en passant par Miriel qui parle de Rennala).
- « Comment lire cette carte », sous le titre, rappelle comment lire la carte et ce qu'on peut y faire.
- « Personnages et lieux » ouvre l'index des personnages, lieux, factions et notions. Chaque fiche
  liste les textes qui en parlent, les fait briller sur la carte et indique les groupes où ils se
  trouvent. La fiche d'un texte liste aussi ce qu'il mentionne, et chercher un nom connu
  (« Godwyn », « Lord of Blood ») propose sa fiche en tête des résultats.
- « Carte : principale · autre agencement », en bas à droite, passe de la carte t-SNE à la carte UMAP
  (la méthode est indiquée dans l'infobulle) : mêmes textes, mêmes
  groupes, autre façon d'aplatir. Ce qui reste proche dans les deux vues l'est vraiment.
- **Recherche précise** : `"Destined Death"` pour une expression exacte, `Ranni + Blaidd` (ou
  `+Blaidd`) pour exiger un terme, `-Malenia` pour l'exclure, `dans:armes` pour une catégorie.
  Un nom connu (personnage, lieu…) désigne les textes qui le mentionnent, alias compris ; un autre
  mot, les textes qui le contiennent. La tête des résultats dit comment la requête a été comprise ;
  le reste de la requête classe les textes retenus, par mots-clés puis par sens.
- **Dialogues** : tout ce que dit un personnage, passage après passage, depuis la fiche d'un passage
  (« Lire tout le dialogue »), la fiche du personnage ou l'index (`#dialogue=Ranni the Witch`). Sur la
  carte, un fil pointillé relie les passages dans l'ordre : on voit le dialogue passer d'un groupe
  à l'autre.
- La légende masque ou réaffiche une catégorie.
- Clavier : `/` pour chercher, Entrée pour aller au premier résultat, `Échap` pour fermer.
  Tab jusqu'à la carte affiche un viseur : flèches pour se déplacer, `+`/`-` pour zoomer, `0` pour
  recentrer, Entrée pour ouvrir l'étoile visée.
- « Retour » en haut du panneau, comme le bouton Retour du navigateur, revient à la fiche
  précédente ; « Fermer » ferme le panneau (et Retour le rouvre).
- La première liste de résultats vient des mots-clés ; celle « par sens » arrive ensuite. Si l'on a
  déjà commencé à lire, elle ne remplace pas la liste sous les yeux : un bouton propose de l'afficher.
- L'adresse de la page change avec le texte ou la fiche ouverte (`#entite=Godwyn`,
  `#groupe=Pots à lancer`, `#chemin=<texte>&<texte>`) : on peut copier un lien vers une fiche. Le lien d'un groupe passe par son
  titre ; un groupe sans titre (nommé par ses mots clés) n'a pas de lien stable d'une génération à
  l'autre.

## Tests et évaluation de la recherche

```bash
uv run pytest                                    # Python : titres, entités, projections
node --test tests/*.test.mjs                     # page : recherche, chemins d'échos, seuil d'évaluation
uv run python eval/embed_queries.py              # après un changement de requêtes ou de modèle
node eval/search_eval.mjs                        # détail requête par requête
```

`eval/queries.json` contient 42 questions et noms, avec les textes qui y répondent vraiment (vérifiés
dans le corpus : aucun texte ne dit par exemple que Marika est la mère de Miquella, la question n'y
figure donc pas). Une requête réussit si l'un de ces textes est dans les 10 premiers résultats.
Deux lots : `dev` (30 requêtes, qui ont servi à régler le poids de la fusion) et `test`
(12 requêtes écrites ensuite et jamais utilisées pour régler quoi que ce soit, pour juger les
changements à venir, dont les fonctions LLM). `node --test` échoue sous 78 % de réussite.

| | mots-clés | sens | fusion |
|---|---|---|---|
| `dev` : réussite@10 / MRR | 50 % / 0,378 | 83 % / 0,645 | 83 % / 0,601 |
| `test` : réussite@10 / MRR | 33 % / 0,198 | 75 % / 0,611 | 75 % / 0,514 |

À poids égaux, la fusion faisait moins bien que le sens seul sur `dev` (80 %, MRR 0,585) ; d'où le
poids 0,5 des mots-clés. Sur `test`, le sens seul garde un meilleur MRR : piste pour plus tard, à
régler sur `dev` seulement. Les embeddings des requêtes viennent du modèle complet ; la page utilise
sa version quantifiée (q8), aux scores très proches.

## Fichiers

```
prepare.py        données -> documents -> embeddings -> t-SNE (+ UMAP) -> clusters -> export
labels.py         rattachement des titres de labels.json aux clusters
labels.json       titres et descriptions des groupes
layouts.py        projections 2D, alignement de la vue alternative, cohésion des groupes
entities.py       textes qui mentionnent chaque entité de entities.json
entities.json     personnages, lieux, factions et notions
eval/             requêtes d'évaluation, leurs embeddings, évaluation, comparaison des projections
tests/            tests Python (pytest) et JavaScript (node --test)
web/index.html    la page
web/app.js        point d'entrée : chargement, souris, clavier, légende
web/state.js      état partagé, constantes, petits utilitaires
web/render.js     canvas : étoiles, contours, noms des groupes, chemins, caméra
web/views.js      bascule entre projections
web/search.js     BM25, similarité int8, fusion RRF, recherche précise (fonctions pures)
web/search-ui.js  champ de recherche, modèle, liste des résultats
web/panel.js      fiches d'un texte et d'un groupe, chemins, aide, liens (#…)
web/nav.js        historique de navigation du panneau (Retour, bouton du navigateur)
web/entities-ui.js  index et fiches des personnages, lieux…
web/graph.js      graphe des échos, plus court chemin (fonctions pures)
web/dialogue-ui.js  dialogue complet d'un personnage et son fil sur la carte
web/sky.js        habillage du ciel : constellations, halos, nébuleuses, style des noms
web/style.css
```

## Limites connues

- Le dump de textes date du jeu de base : **pas de textes du DLC Shadow of the Erdtree**.
  Pour l'ajouter, extraire les fichiers `msg` de son propre jeu (WitchyBND / Smithbox) et
  adapter `item_docs()` dans `prepare.py`.
- Environ 21 % des textes n'appartiennent à aucun groupe (bruit de HDBSCAN) : leur fiche indique le
  groupe le plus proche, mais ils n'apparaissent dans la liste d'aucun groupe.
- Les grands groupes homogènes (armes, compétences, armures) ne se laissent pas découper en
  sous-groupes utiles ; ce sont les noms des petits groupes, affichés en zoomant, qui donnent le détail.
- Les groupes de dialogues se forment souvent autour d'un personnage plutôt que d'un sujet.
- Les dialogues sont découpés en passages de quelques répliques ; l'identité de l'interlocuteur
  n'est pas toujours connue. Les libellés du dump qui ne sont pas des noms (« Narator »,
  « Stage Directions », « (cut npc) »…) sont traduits à l'affichage ; les embeddings gardent ceux
  du dump, pour que les corriger ne déplace pas les textes sur la carte.
- Pas de texte français officiel : le dump n'a que l'anglais et le japonais.

Textes d'Elden Ring © FromSoftware / Bandai Namco. Projet de fan, non commercial.
