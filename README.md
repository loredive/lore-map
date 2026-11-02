# Lore Map

An interactive map of the texts in Elden Ring, Bloodborne and Dark Souls I, II and III: item descriptions, weapons, armor,
NPC dialogue. Each star is a text, and texts about the same things sit close together. You can
search by meaning, follow guided tours, or browse by category. Everything runs in the browser.

## How it works

The map is computed once, ahead of time, and published as static files. There is no server behind the site.

**Ahead of time, in Python** (`lore_map/prepare.py`):

1. Each text, with its name, goes through a small multilingual model,
   [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), which turns it into an
   embedding: 384 numbers that describe what it is about.
2. t-SNE flattens these embeddings to 2D. That gives each star its place on the map.
3. Each text gets its 8 echoes: the texts with the closest embeddings. They are measured before flattening,
   so an echo can sit far away on the map.
4. HDBSCAN finds the groups on the 2D map. Their titles are written by hand (`games/<id>/labels.json`).
5. Mentions of characters and places are found by name, from a hand-edited list (`games/<id>/entities.json`).
6. Everything is written to `web/data/<id>/`: `lore.json` for the page, and `emb.bin` for the embeddings,
   rounded to one byte per number to make the file smaller.

**In the browser, when you search** (`web/search-ui.js`, `web/search.js`):

1. Keyword results (BM25) appear right away.
2. The first search also loads [Transformers.js](https://huggingface.co/docs/transformers.js) and the same
   model in a browser version (about 120 MB, once). The model turns your query into an embedding on your own device.
3. That embedding is compared to the stored ones to find the closest texts.
4. Both result lists are merged with Reciprocal Rank Fusion.

If the model can't load, search falls back to keywords only.

## Run it

```bash
python -m http.server 8000 -d web    # then open http://localhost:8000
```

The generated data is in `web/data/`. Icons are not versioned, and the page works without them.

## Rebuild the data

```bash
uv sync
uv run python -m lore_map.prepare --source ../EldenRingTextExplorer/elden_ring_text.json
uv run python -m lore_map.images     # Elden Ring icons, from the Elden Ring Fan API
```

The Elden Ring text comes from [EldenRingTextExplorer](https://github.com/EldenRingExplorer/EldenRingTextExplorer).
The other games have no public text dump: each one's `extract` and `icons` read your own copy of the
game, then `prepare --game <id>` builds the map. For example:

```bash
uv run python -m lore_map.sources.dark_souls_2.extract --game <…/Game> --dictionary <…> --out ../ds2_text.json
uv run python -m lore_map.prepare --game dark-souls-2 --source ../ds2_text.json
uv run python -m lore_map.sources.dark_souls_2.icons --game <…/Game> --text ../ds2_text.json
```

Bloodborne reads a PS4 dump. Dark Souls III needs its `msg/` folder unpacked with UXM first. Dark Souls
and Dark Souls II are read in place from the Steam copy. The Souls games' item tables are encrypted and
read with the keys published by the modding community, with Paramdex for their layout. Each script's
docstring has its exact arguments.

The code is in `lore_map/`: the pipeline (`prepare`, `entities`, `labels`, `layouts`…), the game file
formats in `formats/`, and one package per game in `sources/`. `games/<id>/` holds each game's hand-edited
data: settings, group titles, tours, characters and places, speakers.

## Tests

```bash
uv run pytest
node --test tests/*.test.mjs
```

Game texts and images © FromSoftware. Non-commercial fan project.
