# Ergonomics and accessibility audit — La carte du lore

Date: 2026-10-24 · Branch: `feature/pre-llm` (35caf0d) · Batches 1 and 2 fixed on `feature/ergonomics` (see Status).

Method: scripted browser measurements (Playwright, Chromium) at 375, 390, 768, 1280, 1400 and
1920 px wide; task walkthroughs counting actions and dead ends; Nielsen's 10 heuristics;
WCAG 2.2 AA. Scripts: `scratchpad/audit/measure.py`, `tasks.py` (not committed).

## Summary

| | |
|---|---|
| Issues found | 18 (6 P1, 8 P2, 4 P3) |
| Biggest problems | navigation history, keyboard and screen reader use, tapping stars on mobile |
| Works well | text contrast, search relevance, rendering speed, no console errors |

## Status

| # | Issue | Status | Measured after the fix |
|---|---|---|---|
| 2 | Keyboard use | ✅ batches 1 and 2 | Tab from search to first result: 11 → 1; Enter → first result; focus on the card title; focus kept when results are replaced |
| 3 | Live region | ✅ batch 1 | characters read on each change: 4,400 → a short message; `<main>` added |
| 4 | Tablet: title / search | ✅ batch 1 | no overlap at 761–1400 px (9 widths, both states) |
| 6 | Search with a card open | ✅ batch 1 | results always shown, « Retour à … » back to the card, card restored when the search is cleared |
| 7 | Touch targets | ✅ batch 1 | targets under 24 px on mobile: 15 → 0 |
| 8 | Contrast | ✅ batch 1 | placeholder, credit, legend off: 4.53:1; field boundary 3.01:1; legend off also struck through |
| 10 | Jargon | ✅ batch 1 | « Carte : principale · autre agencement », method in the tooltip |
| 12 | Projection loses the text | ✅ batch 1 | selected star recentred (490, 430) instead of under the search field |
| 13 | Tablet: credit / switch | ✅ batch 1 | credit wraps, hidden when the panel is open below 1360 px |
| 1 | « Back » | ✅ batch 2 | panel history in step with the browser (nav.js): « Retour » from an echo goes to the text read before (was: jumped to the character card); browser Back goes to the previous card (was: left the page); Back from the first card closes the panel; « Fermer » button; `#chemin=` links |
| 2 (rest) | Stars not reachable by keyboard | ✅ batch 2 | Tab reaches the map (first stop): a sight at the centre names the aimed star, arrows / + / − move, Enter opens |
| 5 | Mobile taps | ✅ batch 2 | 20 random targets, 6 px finger error: right star 1–2/20 before → 17/20 (8/8 for stars not hidden under a group name), 3.1 taps on average; a crowded tap zooms ×4, then offers the names (and the group under the finger) |
| 9 | Results reshuffling | ✅ batch 2 | once the list is touched (scroll, click, key), refined results wait behind a « afficher » button; otherwise replaced with a note |
| 11 | Hidden features | ✅ batch 2 | help gains « Ce qu'on peut faire » (8 lines), the 4 original lines unchanged |
| 14–18 | | later | |

Also fixed along the way: the mobile legend overlapped the credit (pre-existing).

New finding: on mobile with the CPU slowed 4×, the overview takes 14 to 23 ms per frame (median
about 20 ms over 3 runs, same before and after batch 1), at or over the 16 ms budget of 60 fps.
Worth optimising later (draw only visible outlines, cache the star layer).

## P1: blocks or misleads

### 1. "Back" doesn't go back (Nielsen 3, user control and freedom)
- The page only ever calls `history.replaceState`, so it never adds a history entry. After
  character → text → echo, the browser's Back button leaves the whole session state
  (measured: back to `/`).
- The in-panel « Retour » only remembers one context: from an echo it jumps back to the
  character card and skips the text read just before (measured: Fia passage 12 → echo Fia
  passage 11 → « Retour » → Godwyn).
- **Fix:** keep a stack of panel states with `pushState`, handle `popstate`, and point
  « Retour » at the previous entry.

### 2. Keyboard use (WCAG 2.1.1, 2.4.3)
- The stars can't be reached by keyboard (the canvas isn't focusable).
- Enter in the search field does nothing.
- From the search field it takes **11 Tab presses** to reach the first result, because the
  8 legend buttons and 2 projection buttons sit in between in the DOM order.
- When a card opens, **focus is lost** (it goes back to `body`).
- **Fix:** on opening, move focus to the card title (`tabindex="-1"`); Enter in search moves to
  the first result; put the panel before the legend in the DOM (or add a skip link). Longer
  term: arrow-key navigation from one echo to the next on the map.

### 3. Screen reader: the whole panel is a live region (WCAG 4.1.3)
- `#panel` has `aria-live="polite"`, so every change reads out the whole card (measured: up to
  4,400 characters for Godwyn). There's no `<main>` landmark.
- **Fix:** remove `aria-live` from the panel; add a short live status message (« Fiche
  ouverte : Godwyn, 22 textes ») and a `<main>` element.

### 4. Tablet: title overlaps the search field (layout)
- From 761 to roughly 900 px wide, the desktop layout applies: the centred search field
  covers "La carte du lore" (seen at 768 px).
- **Fix:** an intermediate breakpoint, with the search field under the title below about
  1000 px.

### 5. Mobile: tapping a star is a lottery
- At the initial zoom, **100 %** of on-screen stars have a neighbour within the 22 px touch
  radius. In 5 taps, 4 opened some text near the finger and 1 opened a group.
- **Fix:** when several stars are under the finger, zoom in towards the tap instead of
  opening one, or show a small list of the nearby texts to choose from.

### 6. Searching with a card open shows no list (Nielsen 1, visibility of system status)
- Typing a query while a card is open lights up 150 stars on the map, but the panel keeps
  showing the old card. It looks as if the search did nothing (already hit during the path
  work).
- **Fix:** a query always shows the results; the card stays one « Retour » away.

## P2: degrades the experience

### 7. Touch targets under 24 px (WCAG 2.5.8), measured at 390 px
- Legend buttons: 21×14 px (coloured dots only).
- « Comment lire cette carte » / « Personnages et lieux »: 17 px tall.
- Card links (group, copy link, path): 20 px tall.
- t-SNE / UMAP: 23 px tall.
- **Fix:** more padding; a target of at least 24 px, ideally 44 px.

### 8. Contrast below WCAG (1.4.3, 1.4.11)
- Search placeholder `#6b7390`: 3.8:1 (4.5 required).
- Credit line and switched-off legend items `#5d6580`: 3.1:1. The legend items are still
  active buttons, so they're covered.
- Search field underline `--rim`: 1.7:1. It's the only visible boundary of the field
  (3:1 required for a control).
- Body text, gold and secondary text pass (5.9 to 13.8:1).

### 9. Results reshuffle while being read (Nielsen 1)
- The keyword results show at once, then the meaning-based results **replace the list**
  a few seconds later (measured on « la mort de Godwyn »: Fia passage 16 first, then Finger
  Reader Crone first).
- **Fix:** only swap the list if the user hasn't clicked or scrolled yet, and say so
  (« résultats affinés par le sens »).

### 10. Jargon: « Projection t-SNE / UMAP » (Nielsen 2, match with the real world)
- The names mean nothing to a fan of the game.
- **Fix:** human labels (« Carte : principale · autre agencement »), with t-SNE/UMAP kept in
  the tooltip and the help.

### 11. Hidden features (Nielsen 6, recognition rather than recall)
- The path between two texts, « Liés à », the projection switch and the group outlines
  aren't mentioned anywhere on the first screen. The 4-line help (as specified) covers
  reading the map, not what you can do with it.
- **Fix:** a second short section in the help (« Ce qu'on peut faire »), or one-off
  contextual hints.

### 12. Changing projection loses the selected text
- With a text open, the map doesn't recentre after the switch. The selected star ended up
  under the search field (y = 64 px, measured).
- **Fix:** `focusDoc` on the selected text (or the open group or entity) at the end of the
  transition.

### 13. Tablet: credit line overlaps the projection switch
- Seen at 768 px.
- **Fix:** same intermediate breakpoint as #4.

### 14. No way to compare two characters or texts side by side
- Each card replaces the previous one. Comparing Ranni and Rennala means going back and
  forth (and Rennala isn't in Ranni's « Liés à »).
- **Fix (feature, to design):** pin a card, or a « comparer » mode.

## P3: worth doing when the time comes

15. **Mobile panel fixed at 56 % of the height:** you can't reduce it to see the map, or
    enlarge it to read. **Fix:** a drag handle with 2 or 3 positions.
16. **Weak focus indicator on the search field:** only the underline changes colour; there's
    no outline.
17. **Legend on mobile = dots without labels:** you have to know the colours. **Fix:** a
    legend that opens on tap.
18. **No list alternative to the canvas** for screen readers and keyboard users (the canvas
    only has an `aria-label`).

## Task walkthroughs

| Task | Result |
|---|---|
| What do the texts say about Godwyn's death? (desktop) | ✅ « la mort de Godwyn » brings up Black Knife and Fia in the top 5, but the list reshuffles (#9) |
| Read 3 texts of a group (mobile) | ✅ 7 taps; the group name is easy to tap, single stars aren't (#5) |
| Go back to the text read 2 clicks ago | ❌ impossible (#1) |
| Compare Ranni and Rennala | ⚠️ back and forth only (#14) |
| Trace a path Ranni → Radagon (mobile) | ✅ the button is visible without scrolling (302 px into a 448 px panel) |
| Search while a card is open | ❌ no list (#6) |
| Change projection while reading a text | ⚠️ the text leaves the view (#12) |
| First visit: what can you do without reading the help? | ⚠️ search, characters, groups; not paths or comparisons (#11) |

## What works well
- Body text contrast 13.4:1, gold 10.3:1, secondary text 5.9:1.
- Search relevance on natural French questions.
- Rendering: 2.9 ms per frame on desktop, 14 ms with the CPU slowed 4× (under the 16 ms of
  60 fps). Zoomed in: 0.6 ms and 3 ms.
- No JavaScript errors in the console on any of the tested pages.
- 375 and 1920 px layouts hold up.

## Proposed next steps
1. **Batch 1, quick fixes (about half a day):** #2 focus and Enter, #3 live region,
   #4/#13 breakpoint, #6 search, #7 targets, #8 contrast, #10 labels, #12 recentre.
2. **Batch 2, structural:** #1 history, #5 tapping on mobile, #9 stable results, #11 help.
3. **User tests:** 3 to 5 fans, thinking aloud, on the tasks above, after batch 1.
4. **Later, if the tests ask for it:** #14 comparison, #15 resizable panel, #18 list view.
