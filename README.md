# Lore Map

An interactive map of the texts in Elden Ring, Bloodborne and Dark Souls I, II and III: item descriptions, weapons, armor,
NPC dialogue. Each star is a text, and texts about the same things sit close together. You can
search by meaning, follow guided tours, or browse by category. Everything runs in the browser.

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
