# Lore Map

An interactive map of the texts in Elden Ring, Bloodborne, Dark Souls and Dark Souls III: item descriptions, weapons, armor,
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
uv run python prepare.py --source ../EldenRingTextExplorer/elden_ring_text.json
uv run python images.py              # Elden Ring icons, from the Elden Ring Fan API
```

The Elden Ring text comes from [EldenRingTextExplorer](https://github.com/EldenRingExplorer/EldenRingTextExplorer).
Bloodborne has no public text dump: `games/bloodborne/extract.py` and `icons.py` read your own copy
of the game, then `prepare.py --game bloodborne` builds the map. Dark Souls III works the same way
from the Steam copy, once its `msg/` folder is unpacked with UXM: `games/dark-souls-3/extract.py`,
then `prepare.py --game dark-souls-3`, then `games/dark-souls-3/icons.py` for its icons. These read the game's
encrypted item tables with the key published by the modding community, and Paramdex for their layout.
Dark Souls (Prepare to Die Edition) needs no unpacking: `games/dark-souls-1/extract.py` and `icons.py` read
the Steam copy's archives in place, then `prepare.py --game dark-souls-1` builds the map.

## Tests

```bash
uv run pytest
node --test tests/*.test.mjs
```

Game texts and images © FromSoftware. Non-commercial fan project.
