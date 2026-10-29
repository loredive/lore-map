# Lore Map

An interactive map of the texts in Elden Ring and Bloodborne: item descriptions, weapons, armor,
NPC dialogue. Each star is a text, and texts about the same things sit close together. You can
search by meaning, follow guided tours, or browse by category. Everything runs in the browser.
Ambient music follows the part of the sky you are looking at; the tracks are CC0, credited in
`web/music/CREDITS.md`.

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
of the game, then `prepare.py --game bloodborne` builds the map.

## Tests

```bash
uv run pytest
node --test tests/*.test.mjs
```

Game texts and images © FromSoftware. Non-commercial fan project.
