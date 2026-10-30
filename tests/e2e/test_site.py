"""La page dans un vrai navigateur : chaque jeu se charge sans erreur ni ressource bloquée, la barre
reste compacte, les nuages des groupes sont là même si les données arrivent lentement, et le menu du
téléphone montre les catégories, chaque adresse ouvre sa page et Retour mène où il faut. Lancé par la CI avant chaque déploiement.

    uv run --no-project --with pytest --with playwright==1.64.0 pytest tests/e2e
    (PLAYWRIGHT_CHROMIUM=<chemin d'un chromium> pour réutiliser un navigateur déjà installé)
"""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

WEB = Path(__file__).resolve().parents[2] / "web"
GAMES = ["bloodborne", "dark-souls-3", "elden-ring"]
DESKTOP = {"viewport": {"width": 1280, "height": 800}}
PHONE = {"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True}


@pytest.fixture(scope="module")
def site():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "-d", str(WEB)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}/"
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    yield url
    server.terminate()
    server.wait()


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM") or None)
        yield b
        b.close()


def open_page(browser, url, device, slow_data=False):
    """La page chargée, avec la liste de ce qui a mal tourné : erreurs JavaScript, ressources refusées par
    la politique de sécurité, requêtes en échec (sauf les icônes, absentes avant le déploiement)."""
    context = browser.new_context(**device)
    page = context.new_page()
    problems = []
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    page.on("console", lambda m: "Content Security Policy" in m.text and problems.append(f"CSP: {m.text}"))
    page.on("response", lambda r: r.status >= 400 and "/img/" not in r.url and problems.append(f"{r.status} {r.url}"))
    if slow_data:
        def slow(route):
            time.sleep(1.0)
            route.continue_()
        page.route("**/lore.json", slow)
    page.goto(url)
    page.wait_for_function("() => document.querySelector('#status').textContent === ''", timeout=20000)
    page.wait_for_timeout(500)
    return page, problems


@pytest.mark.parametrize("game", GAMES)
@pytest.mark.parametrize("device", [DESKTOP, PHONE], ids=["desktop", "phone"])
def test_page_loads_cleanly(browser, site, game, device):
    page, problems = open_page(browser, f"{site}?game={game}", device)
    assert problems == []
    assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "the page scrolls sideways"
    bar = page.evaluate("() => document.querySelector('.topbar').getBoundingClientRect().height")
    assert bar < 130, f"the top bar is {bar}px tall"


@pytest.mark.parametrize("game", GAMES)
def test_clouds_survive_slow_data(browser, site, game):
    page, problems = open_page(browser, f"{site}?game={game}", DESKTOP, slow_data=True)
    assert problems == []
    assert page.evaluate("async () => (await import('./nebula.js')).cloudCount()") > 0


@pytest.mark.parametrize("game", GAMES)
@pytest.mark.parametrize("device", [DESKTOP, PHONE], ids=["desktop", "phone"])
def test_pressing_things_while_the_data_loads(browser, site, game, device):
    """lore.json retenu pendant qu'on agit sur la page : redimensionner, des touches, un clic sur la
    carte, une autre adresse puis Retour, le menu sur téléphone. Une fois les données là : aucune erreur,
    les nuages sont dessinés, la page du lien collé s'ouvre, et les commandes répondent."""
    lore = json.loads((WEB / "data" / game / "lore.json").read_text(encoding="utf-8"))
    first, second = (c["label"] for c in sorted(lore["clusters"], key=lambda c: -c["n"])[:2])
    context = browser.new_context(**device)
    page = context.new_page()
    problems = []
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    held = []
    page.route("**/lore.json", lambda route: held.append(route))   # retenu jusqu'à ce qu'on le laisse passer
    page.goto(f"{site}?game={game}#group={quote(first, safe="")}")
    page.wait_for_function("() => document.querySelector('#status').textContent !== ''")
    while not held:
        page.wait_for_timeout(20)
    # pendant le chargement : seuls le menu et les liens des jeux répondent
    assert page.evaluate("() => document.querySelector('.seek').inert && document.querySelector('.drawer .links').inert")
    if device is PHONE:
        page.click(".menu-btn")
        assert page.evaluate("() => document.querySelector('.topbar').classList.contains('open')")
        page.click(".menu-btn")
    page.set_viewport_size({"width": device["viewport"]["width"] - 40, "height": device["viewport"]["height"] - 30})
    for key in ["ArrowLeft", "+", "/", "Escape"]:
        page.keyboard.press(key)
    page.mouse.click(100, 400)
    page.evaluate(f"() => {{ location.hash = {json.dumps('#group=' + quote(second, safe=""))}; }}")
    page.evaluate("() => history.back()")
    page.wait_for_function(f"() => location.hash === {json.dumps('#group=' + quote(first, safe=""))}")
    held[0].continue_()
    page.wait_for_function("() => document.querySelector('#status').textContent === ''", timeout=20000)
    wait_shown(page, ["cluster", first])
    assert problems == []
    assert page.evaluate("async () => (await import('./nebula.js')).cloudCount()") > 0
    assert page.evaluate("() => !document.querySelector('.seek').inert && !document.querySelector('#q').disabled")
    context.close()


@pytest.mark.parametrize("game", GAMES)
def test_broken_data_names_the_missing_field(browser, site, game):
    """Un lore.json sans le champ obligatoire « xy » : la ligne d'état le nomme, et la page ne plante pas."""
    lore = json.loads((WEB / "data" / game / "lore.json").read_text(encoding="utf-8"))
    k = lore["fields"].index("xy")
    broken = {**lore, "fields": [f for i, f in enumerate(lore["fields"]) if i != k],
              "docs": [[v for i, v in enumerate(r) if i != k] for r in lore["docs"]]}
    context = browser.new_context(**DESKTOP)
    page = context.new_page()
    problems = []
    page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
    page.route("**/lore.json", lambda route: route.fulfill(content_type="application/json", body=json.dumps(broken)))
    page.goto(f"{site}?game={game}")
    page.wait_for_function("() => document.querySelector('#status').textContent.includes('xy')", timeout=20000)
    page.wait_for_timeout(300)
    message = page.locator("#status").text_content()
    assert 'missing required field "xy"' in message and "prepare.py" in message
    assert problems == []
    # sans données, l'interface reste inerte, mais on peut encore changer de jeu
    assert page.evaluate("() => document.querySelector('.seek').inert")
    page.set_viewport_size(PHONE["viewport"])
    page.click(".menu-btn")
    assert page.evaluate("() => document.querySelector('.topbar').classList.contains('open')")
    context.close()


def test_phone_menu_names_the_categories(browser, site):
    page, _ = open_page(browser, site, PHONE)
    assert not page.is_visible("#legend")
    page.click(".menu-btn")
    labels = page.eval_on_selector_all("#legend .label", "xs => xs.map(x => x.offsetParent ? x.textContent : '')")
    assert labels and all(labels), labels


def test_views_and_language_switch(browser, site):
    page, problems = open_page(browser, site, DESKTOP)
    page.click("#views button[data-v='1']")
    page.wait_for_timeout(1500)
    page.click("#lang button[data-alt='1']")
    title = page.evaluate("async () => { const { S, groupName } = await import('./state.js'); return groupName(S.clusters[0]); }")
    english = page.evaluate("async () => (await import('./state.js')).S.clusters[0].label")
    assert title != english
    assert problems == []


# ------------------------------------------------------------------ adresses et Retour
# Ce que montre chaque adresse d'aujourd'hui, et où mène Retour : le filet de sécurité avant de
# déplacer le code des pages. Les noms viennent des données de chaque jeu (web/data/<jeu>/).
ADDRESSES = {
    "bloodborne": [
        ("text", "#Hunter's%20Mark", "doc", "Hunter's Mark"),
        ("group", "#group=Valtr%20and%20the%20League", "cluster", "Valtr and the League"),
        ("old-french-group", "#groupe=Valtr%20and%20the%20League", "cluster", "Valtr and the League"),
        ("entity", "#entity=Gehrman", "entity", "Gehrman"),
        ("path", "#path=Hunter's%20Mark&Bold%20Hunter's%20Mark", "path", "Hunter's Mark → Bold Hunter's Mark"),
        ("dialogue", "#dialogue=Chapel%20Dweller", "dialogue", "Chapel Dweller"),
        ("tour", "#tour=paleblood/3", "tour", "Paleblood and the Moon"),
        ("old-french-entity", "#entite=Gehrman", "entity", "Gehrman"),
    ],
    "dark-souls-3": [
        ("text", "#Coiled%20Sword", "doc", "Coiled Sword"),
        ("group", "#group=Shields", "cluster", "Shields"),
        ("old-french-group", "#groupe=Shields", "cluster", "Shields"),
        ("entity", "#entity=Aldrich", "entity", "Aldrich"),
        ("path", "#path=Coiled%20Sword&Firelink%20Greatsword", "path", "Coiled Sword → Firelink Greatsword"),
        ("dialogue", "#dialogue=Yuria%20of%20Londor", "dialogue", "Yuria of Londor"),
        ("tour", "#tour=londor/3", "tour", "Londor and the Lord of Hollows"),
        ("old-french-entity", "#entite=Aldrich", "entity", "Aldrich"),
    ],
    "elden-ring": [
        ("text", "#Tarnished's%20Furled%20Finger", "doc", "Tarnished's Furled Finger"),
        ("group", "#group=Bell%20Bearings%20of%20the%20departed", "cluster", "Bell Bearings of the departed"),
        ("old-french-group", "#groupe=Bell%20Bearings%20of%20the%20departed", "cluster", "Bell Bearings of the departed"),
        ("entity", "#entity=Marika", "entity", "Marika"),
        ("path", "#path=Tarnished's%20Furled%20Finger&About%20Cooperative%20Multiplayer", "path",
         "Tarnished's Furled Finger → About Cooperative Multiplayer"),
        ("dialogue", "#dialogue=Ranni%20the%20Witch", "dialogue", "Ranni the Witch"),
        ("tour", "#tour=story/3", "tour", "The story of the Lands Between"),
        ("old-french-entity", "#entite=Marika", "entity", "Marika"),
    ],
}
TOURS = {"bloodborne": ("paleblood", "Paleblood and the Moon"), "dark-souls-3": ("londor", "Londor and the Lord of Hollows"),
         "elden-ring": ("story", "The story of the Lands Between")}
ENTITIES = {"bloodborne": "Gehrman", "dark-souls-3": "Aldrich", "elden-ring": "Marika"}
FIRST_TEXT = {"bloodborne": "Hunter's Mark", "dark-souls-3": "Coiled Sword", "elden-ring": "Tarnished's Furled Finger"}


def shown(page):
    """La page du panneau : [sorte de page, titre], ou None quand le panneau est fermé."""
    return page.evaluate("""() => { const p = document.querySelector('#panel');
        return p.hidden ? null : [p.dataset.page, p.querySelector('h2')?.textContent.trim() ?? null]; }""")


def wait_shown(page, expected):
    """Attend que le panneau montre `expected` (Retour et la recherche sont asynchrones), puis le vérifie."""
    want = list(expected) if expected else None
    try:
        page.wait_for_function("""w => { const p = document.querySelector('#panel');
            return w === null ? p.hidden
                 : !p.hidden && p.dataset.page === w[0] && p.querySelector('h2')?.textContent.trim() === w[1]; }""",
                               arg=want, timeout=5000)
    except sync_api.TimeoutError:
        pass
    assert shown(page) == want


@pytest.mark.parametrize("game", GAMES)
@pytest.mark.parametrize("kind", range(len(ADDRESSES["bloodborne"])), ids=[a[0] for a in ADDRESSES["bloodborne"]])
def test_address_opens_its_page(browser, site, game, kind):
    _, address, view, title = ADDRESSES[game][kind]
    page, problems = open_page(browser, f"{site}?game={game}{address}", DESKTOP)
    assert shown(page) == [view, title]
    if view == "tour":
        assert "step 3 of" in page.text_content("#panel .cat")
    # Retour depuis une autre page rouvre celle de l'adresse ; Retour depuis elle quitte le site (voulu)
    page.click("#help")
    wait_shown(page, ("help", "How to read this map"))
    page.go_back()
    wait_shown(page, (view, title))
    if view == "tour":
        assert "step 3 of" in page.text_content("#panel .cat")
    english = address.replace("#groupe=", "#group=").replace("#entite=", "#entity=")   # réécrite en anglais
    assert page.url.endswith(english.replace("'", "%27")) or page.url.endswith(english)
    page.go_back()
    page.wait_for_url("about:blank")
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_back_label_names_the_previous_page(browser, site, game):
    first = FIRST_TEXT[game]
    page, _ = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    assert shown(page) == ["doc", first]
    assert page.query_selector("#panel .panel-top .back") is None      # premier pas : pas de Retour
    echo = page.text_content("#panel .echoes button .name").strip()
    page.click("#panel .echoes button")
    wait_shown(page, ("doc", echo))
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{first}”"
    page.go_back()
    wait_shown(page, ("doc", first))
    page.go_forward()
    wait_shown(page, ("doc", echo))
    page.click("#panel .panel-top .back")                               # « Retour à … » fait pareil
    wait_shown(page, ("doc", first))


@pytest.mark.parametrize("game", GAMES)
def test_back_from_the_first_page_closes_the_panel(browser, site, game):
    page, _ = open_page(browser, f"{site}?game={game}", DESKTOP)
    assert shown(page) is None
    page.click("#help")
    wait_shown(page, ("help", "How to read this map"))
    page.go_back()
    wait_shown(page, None)
    assert page.url.startswith(site), page.url                         # toujours sur le site


@pytest.mark.parametrize("game", GAMES)
def test_back_to_and_from_help(browser, site, game):
    first = FIRST_TEXT[game]
    page, problems = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    page.click("#help")
    wait_shown(page, ("help", "How to read this map"))
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{first}”"
    page.click("#index")
    wait_shown(page, ("index", "Characters and places"))
    assert page.text_content("#panel .panel-top .back").strip() == "Back to help"
    page.click("#panel .panel-top .back")
    wait_shown(page, ("help", "How to read this map"))
    page.go_back()
    wait_shown(page, ("doc", first))
    page.go_forward()
    wait_shown(page, ("help", "How to read this map"))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_back_after_closing_reopens_the_page(browser, site, game):
    first = FIRST_TEXT[game]
    page, _ = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    page.click("#panel .panel-top .close")
    wait_shown(page, None)
    page.go_back()
    wait_shown(page, ("doc", first))


@pytest.mark.parametrize("game", GAMES)
def test_back_from_a_tour_step_names_the_step(browser, site, game):
    tour, title = TOURS[game]
    page, problems = open_page(browser, f"{site}?game={game}#tour={tour}/3", DESKTOP)
    page.click("#panel .tnext")
    page.wait_for_function("() => document.querySelector('#panel .cat').textContent.includes('step 4 of')")
    assert page.url.endswith(f"#tour={tour}/4")
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{title}”, step 3"
    page.go_back()
    page.wait_for_function("() => document.querySelector('#panel .cat').textContent.includes('step 3 of')")
    assert problems == []


# ------------------------------------------------------------------ caméra
# Les deux seuls endroits du fichier qui lisent ou écrivent la caméra : quand elle change de module,
# on ne repointe qu'eux.
def camera(page, stars=()):
    """La caméra une fois immobile (le vol en cours fini : dix images de suite sans bouger), en nombres :
    { x, y, s, k, width, height, cy, top }, k = s * base (pixels par unité du monde). Avec `stars`
    (des indices de textes), aussi `screen` : la position à l'écran de chacune, par toScreen."""
    return page.evaluate("""async stars => {
        const { S } = await import('./state.js'), { camera, toScreen } = await import('./camera.js');
        const at = () => { const { x, y, s } = camera(); return [x, y, s]; };
        let last = at(), calm = 0;
        for (const t0 = performance.now(); calm < 10 && performance.now() - t0 < 10000;) {
            await new Promise(r => requestAnimationFrame(r));
            const now = at();
            calm = now.every((v, i) => v === last[i]) ? calm + 1 : 0;
            last = now;
        }
        const { x, y, s, k, width, height, cy, top } = camera(), c = { x, y, s, k, width, height, cy, top };
        if (stars.length) c.screen = stars.map(i => toScreen(S.docs[i].x, S.docs[i].y));
        return c; }""", list(stars))


def move_camera(page, dx=0.0, dy=0.0, zoom=1.0):
    """Déplace la caméra sans vol (flyTo en 0 ms saute), en unités du monde : x += dx, y += dy,
    s *= zoom. Rend la main une fois la carte redessinée."""
    page.evaluate("""async ([dx, dy, zoom]) => { const { camera, flyTo } = await import('./camera.js');
        const { x, y, s } = camera();
        flyTo(x + dx, y + dy, s * zoom, 0);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }""", [dx, dy, zoom])


@pytest.mark.parametrize("game", GAMES)
def test_back_to_a_tour_from_another_page_shows_the_whole_tour(browser, site, game):
    tour, title = TOURS[game]
    page, problems = open_page(browser, f"{site}?game={game}#tour={tour}/3", DESKTOP)
    whole = camera(page)                            # après le vol d'ouverture : toute la visite à l'écran
    page.click("#help")
    wait_shown(page, ("help", "How to read this map"))
    move_camera(page, 3, -2, 6)
    page.go_back()
    wait_shown(page, ("tour", title))
    back = camera(page)
    assert back == pytest.approx(whole, rel=1e-3, abs=1e-3)
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_links_between_characters_index_and_dialogues(browser, site, game):
    name = ENTITIES[game]
    page, problems = open_page(browser, f"{site}?game={game}#entity={name}", DESKTOP)
    page.click("#panel .to-index")
    wait_shown(page, ("index", "Characters and places"))
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{name}”"
    speaker = page.get_attribute("#panel button[data-sp]", "data-sp")
    page.click("#panel button[data-sp]")
    wait_shown(page, ("dialogue", speaker))
    assert page.text_content("#panel .panel-top .back").strip() == "Back to characters and places"
    passage = page.get_attribute("#panel .pnum", "data-i")
    page.click("#panel .pnum")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'doc'")
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to the dialogue of {speaker}"
    page.click("#panel button.tdial")                  # le dialogue du passage, celui-ci mis en avant
    wait_shown(page, ("dialogue", speaker))
    assert page.get_attribute(f"#panel #p{passage}", "class") == "here"
    page.go_back()
    page.go_back()
    wait_shown(page, ("dialogue", speaker))
    page.go_back()
    wait_shown(page, ("index", "Characters and places"))
    page.go_back()
    wait_shown(page, ("entity", name))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_tour_list_and_steps(browser, site, game):
    tour, title = TOURS[game]
    page, problems = open_page(browser, f"{site}?game={game}", DESKTOP)
    page.click("#tours")
    wait_shown(page, ("tours", "Guided tours"))
    page.click(f"#panel button[data-t='{tour}']")
    wait_shown(page, ("tour", title))
    assert page.url.endswith(f"#tour={tour}/1")
    assert page.text_content("#panel .panel-top .back").strip() == "Back to the guided tours"
    text = page.text_content("#panel .tour-text h3").strip()
    page.click("#panel .topen")
    wait_shown(page, ("doc", text))
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{title}”, step 1"
    page.go_back()
    wait_shown(page, ("tour", title))
    page.go_back()
    wait_shown(page, ("tours", "Guided tours"))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_typing_a_search_is_one_step(browser, site, game):
    first = FIRST_TEXT[game]
    page, _ = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    # la recherche par le sens téléchargerait un modèle : sans réseau, elle se rabat sur les mots
    page.route(lambda url: not url.startswith(site), lambda route: route.abort())
    page.click("#q")
    page.keyboard.type("blood", delay=300)          # plus lent que l'attente de la recherche : un rendu par lettre
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'results'")
    page.wait_for_timeout(500)
    page.go_back()
    wait_shown(page, ("doc", first))
    assert page.input_value("#q") == ""


# ------------------------------------------------------------------ focus de la carte, chemin d'échos
ENTITY = {"bloodborne": "Gehrman", "dark-souls-3": "Aldrich", "elden-ring": "Marika"}
DIALOGUE = {"bloodborne": "Alfred, Hunter of Vilebloods", "dark-souls-3": "Yuria of Londor", "elden-ring": "Ranni the Witch"}


def focus(page):
    """Ce qui est allumé sur la carte : le groupe, l'entité et le texte ouvert."""
    return page.evaluate("""async () => { const { S } = await import('./state.js');
        return { group: S.cluster?.label ?? null, entity: S.entity?.name ?? null, selected: S.selected }; }""")


@pytest.mark.parametrize("game", GAMES)
def test_a_text_keeps_the_focus_and_a_group_starts_fresh(browser, site, game):
    _, address, _, group = ADDRESSES[game][1]
    page, problems = open_page(browser, f"{site}?game={game}{address}", DESKTOP)
    name = page.text_content("#panel .results button .name").strip()
    page.click("#panel .results button")
    wait_shown(page, ("doc", name))
    assert focus(page)["group"] == group                    # le groupe reste allumé sous le texte
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to the group “{group}”"
    entity = ENTITY[game]
    page.goto(f"{site}?game={game}#entity={entity}")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'entity'")
    page.click("#panel .results button")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'doc'")
    assert focus(page)["entity"] == entity                  # l'entité aussi
    page.click("#panel .glink")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'cluster'")
    f = focus(page)
    assert f["entity"] is None and f["selected"] == -1 and f["group"] is not None
    assert problems == []


def column(page):
    """La colonne à côté du panneau : visible ou non, son nombre de textes et le texte marqué."""
    return page.evaluate("""() => { const c = document.querySelector('#list-column');
        return { shown: c.getBoundingClientRect().width > 0, n: c.querySelectorAll('li').length,
                 current: c.querySelector('[aria-current] .name')?.textContent.trim() ?? null }; }""")


@pytest.mark.parametrize("game", GAMES)
def test_a_text_opened_from_a_list_keeps_the_list_beside_it(browser, site, game):
    _, address, _, group = ADDRESSES[game][1]
    page, problems = open_page(browser, f"{site}?game={game}{address}", DESKTOP)
    n = page.locator("#panel .results li").count()
    first = page.text_content("#panel .results button .name").strip()
    page.click("#panel .results button")
    wait_shown(page, ("doc", first))
    assert column(page) == {"shown": True, "n": n, "current": first}
    assert page.text_content("#panel .pager .at").strip() == f"1 of {n}"
    # un autre texte de la colonne : le panneau change, la colonne reste, et son étoile n'est pas dessous
    third = page.locator("#list-column li button").nth(2)
    name = third.locator(".name").text_content().strip()
    third.click()
    wait_shown(page, ("doc", name))
    assert column(page) == {"shown": True, "n": n, "current": name}
    assert page.evaluate("() => document.activeElement.closest('#list-column') !== null")   # on continue d'y choisir
    i = page.evaluate("async () => (await import('./state.js')).S.selected")
    left = page.evaluate("() => document.querySelector('#panel').getBoundingClientRect().left")
    assert camera(page, [i])["screen"][0][0] < left
    # la liste reste à droite, le texte s'ouvre à sa gauche
    assert page.evaluate("""() => document.querySelector('#panel').getBoundingClientRect().right
        <= document.querySelector('#list-column').getBoundingClientRect().left + 1""")
    assert page.is_hidden("#panel .pager")               # la liste est là : pas de « suivant »
    page.locator("#list-column li button").nth(3).click()
    wait_shown(page, ("doc", page.locator("#list-column li button").nth(3).locator(".name").text_content().strip()))
    page.go_back()
    wait_shown(page, ("doc", name))
    assert column(page)["current"] == name               # Retour : la liste revient avec lui
    # suivre un écho garde la liste
    echo = page.text_content("#panel .echoes button .name").strip()
    page.click("#panel .echoes button")
    wait_shown(page, ("doc", echo))
    assert column(page)["n"] == n
    # × ferme la colonne, Retour la rouvre ; son lien ramène au groupe, sans colonne
    page.click("#list-column .list-close")
    page.wait_for_function("() => document.querySelector('#list-column').hidden")
    assert shown(page) == ["doc", echo]
    page.go_back()
    page.wait_for_function("() => !document.querySelector('#list-column').hidden")
    assert page.text_content("#list-column .list-back").strip() == group
    page.click("#list-column .list-back")
    wait_shown(page, ("cluster", group))
    assert column(page)["shown"] is False
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_on_a_phone_a_list_is_walked_with_previous_and_next(browser, site, game):
    page, problems = open_page(browser, f"{site}?game={game}#dialogue={quote(DIALOGUE[game])}", PHONE)
    first, second = page.evaluate("""async () => { const { S } = await import('./state.js');
        const l = S.dialogues.get(%s); return [S.docs[l[0]].name, S.docs[l[1]].name]; }""" % json.dumps(DIALOGUE[game]))
    page.click("#panel .pnum")
    wait_shown(page, ("doc", first))
    assert column(page)["shown"] is False                 # pas la place : la fiche a son « suivant »
    assert page.query_selector("#panel .pager button.prev") is None      # le premier passage : pas de « précédent »
    page.click("#panel .pager .next")
    wait_shown(page, ("doc", second))
    page.click("#panel .pager .prev")
    wait_shown(page, ("doc", first))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_back_to_the_results(browser, site, game):
    page, _ = open_page(browser, f"{site}?game={game}", DESKTOP)
    page.route(lambda url: not url.startswith(site), lambda route: route.abort())
    page.fill("#q", "blood")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'results'")
    name = page.text_content("#panel .results button .name").strip()
    page.click("#panel .results button")
    wait_shown(page, ("doc", name))
    assert page.text_content("#panel .panel-top .back").strip() == "Back to the results for “blood”"
    page.click("#panel .panel-top .back")
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'results'")
    assert page.input_value("#q") == "blood"


@pytest.mark.parametrize("game", GAMES)
def test_old_french_path_address(browser, site, game):
    _, address, view, title = ADDRESSES[game][4]
    page, problems = open_page(browser, f"{site}?game={game}{address.replace('#path=', '#chemin=')}", DESKTOP)
    assert shown(page) == [view, title]
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_tracing_a_path_from_a_text(browser, site, game):
    first = FIRST_TEXT[game]
    page, problems = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    echo = page.text_content("#panel .echoes button .name").strip()
    page.click("#panel .tpath")
    assert page.is_visible("#pathbar")
    page.click("#panel .echoes button")
    wait_shown(page, ("path", f"{first} → {echo}"))
    assert page.is_hidden("#pathbar")
    assert page.text_content("#panel .panel-top .back").strip() == f"Back to “{first}”"
    page.go_back()
    wait_shown(page, ("doc", first))
    assert problems == []


# ------------------------------------------------------------------ réaffichage sur place
# Changer de langue ou masquer une catégorie réaffiche la page ouverte telle quelle : ni caméra qui
# bouge, ni focus clavier déplacé, ni entrée d'historique, ni défilement perdu.
def moved_aside(page):
    """Laisse finir le vol de l'ouverture, puis décale la caméra : un recadrage se verrait."""
    camera(page)
    move_camera(page, 40, -30)


def still(page):
    """Ce qu'un réaffichage sur place ne doit pas changer. Le défilement à 10 pixels près : une fois le
    panneau redessiné, le navigateur ajuste un peu la position pour garder le même passage à l'écran."""
    rest = page.evaluate("""() => ({ length: history.length, url: location.href,
                 scroll: Math.round(document.querySelector('#panel').scrollTop / 10) })""")
    return {"cam": camera(page), **rest}


def test_language_switch_redraws_the_text_in_place(browser, site):
    _, address, _, name = ADDRESSES["bloodborne"][0]
    page, problems = open_page(browser, f"{site}?game=bloodborne{address}", DESKTOP)
    french = page.evaluate("async () => (await import('./state.js')).S.docs.find(d => d.name === \"Hunter's Mark\").altName")
    assert french and french != name
    moved_aside(page)
    page.evaluate("() => { document.querySelector('#panel').scrollTop = 60; }")
    before = still(page)
    assert before["scroll"] > 0
    page.click("#lang button[data-alt='1']")
    wait_shown(page, ("doc", french))
    assert still(page) == before
    assert page.evaluate("() => document.activeElement.matches('#lang button[data-alt=\"1\"]')")
    page.click("#lang button[data-alt='0']")
    wait_shown(page, ("doc", name))
    assert still(page) == before
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_a_group_lists_each_speakers_passages_together_and_in_order(browser, site, game):
    """Le groupe où le plus d'interlocuteurs parlent : les passages de chacun se suivent, dans l'ordre
    du jeu, sous un en-tête, et la colonne d'un texte ouvert les garde dans ce même ordre."""
    lore = json.loads((WEB / "data" / game / "lore.json").read_text(encoding="utf-8"))
    name = lore["fields"].index("name")
    by = {}
    for r in lore["docs"]:
        if " — passage " in r[name]:
            by.setdefault(r[lore["fields"].index("cluster")], set()).add(r[name].split(" — passage ")[0])
    cid = max((c for c in by if c != -1), key=lambda c: len(by[c]))
    label = next(c["label"] for c in lore["clusters"] if c["id"] == cid)
    page, problems = open_page(browser, f"{site}?game={game}#group={quote(label)}", DESKTOP)
    page.wait_for_function("() => document.querySelector('#panel').dataset.page === 'cluster'")
    rows = page.evaluate("""() => [...document.querySelectorAll('#panel .results li')].map(li => ({
        name: li.querySelector('.name').textContent.trim(),
        head: li.querySelector('.speaker-head')?.textContent.trim() ?? null }))""")
    said = [(r["name"].split(" — passage ")[0], int(r["name"].split(" — passage ")[1]), r["head"])
            for r in rows if " — passage " in r["name"]]
    speakers = [s for s, _, _ in said]
    assert len(set(speakers)) > 1
    for s in set(speakers):
        at = [k for k, x in enumerate(speakers) if x == s]
        assert at == list(range(at[0], at[0] + len(at))), f"{s}'s passages are apart"
        parts = [said[k][1] for k in at]
        assert parts == sorted(parts)
        assert [said[k][2] for k in at] == ([f"{s} · {len(at)} passages"] + [None] * (len(at) - 1)
                                            if len(at) > 1 else [None])
    page.click("#panel .results button")
    assert column(page)["current"] == rows[0]["name"]
    assert page.evaluate("() => [...document.querySelectorAll('#list-column li .name')].map(n => n.textContent.trim())") \
        == [r["name"] for r in rows]
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_hiding_a_category_updates_the_open_group_in_place(browser, site, game):
    _, address, _, group = ADDRESSES[game][1]
    page, problems = open_page(browser, f"{site}?game={game}{address}", DESKTOP)
    rows = page.locator("#panel .results li").count()
    cat = page.evaluate("""async () => { const { S } = await import('./state.js');
        return S.cats[S.docs.find(d => d.cluster === S.cluster.id).cat]; }""")
    assert "of them shown" not in page.text_content("#panel .count")
    moved_aside(page)
    before = still(page)
    page.click(f"#legend button[title=\"{cat}\"]")
    page.wait_for_function("() => document.querySelector('#panel .count').textContent.includes('of them shown')")
    assert shown(page) == ["cluster", group]
    assert page.locator("#panel .results li").count() < rows
    assert still(page) == before
    page.click(f"#legend button[title=\"{cat}\"]")
    page.wait_for_function("() => !document.querySelector('#panel .count').textContent.includes('of them shown')")
    assert page.locator("#panel .results li").count() == rows
    assert still(page) == before
    assert problems == []


def open_by_click(page, site, kind):
    if kind == "results":
        # la recherche par le sens téléchargerait un modèle : sans réseau, elle se rabat sur les mots
        page.route(lambda url: not url.startswith(site), lambda route: route.abort())
        page.fill("#q", "blood")
    else:
        page.click(f"#{kind}")
    page.wait_for_function("k => document.querySelector('#panel').dataset.page === k", arg=kind)


@pytest.mark.parametrize("kind", ["entity", "path", "dialogue", "tour", "results", "index", "help", "tours", "none"])
def test_both_triggers_redraw_any_page_in_place(browser, site, kind):
    by_address = {}
    for _, address, page_kind, _ in ADDRESSES["bloodborne"]:
        by_address.setdefault(page_kind, address)
    page, problems = open_page(browser, f"{site}?game=bloodborne{by_address.get(kind, '')}", DESKTOP)
    if kind not in by_address and kind != "none":
        open_by_click(page, site, kind)
    expected = shown(page)
    moved_aside(page)
    before = still(page)
    query = page.input_value("#q")
    page.click("#lang button[data-alt='1']")
    page.wait_for_timeout(300)
    assert (shown(page) or [None])[0] == (expected or [None])[0]
    page.click("#legend button.dlc")
    page.wait_for_timeout(300)
    page.click("#legend button.dlc")
    page.click("#lang button[data-alt='0']")
    page.wait_for_timeout(300)
    assert shown(page) == expected
    assert still(page) == before
    assert page.input_value("#q") == query                  # la recherche n'est pas effacée
    assert problems == []


# ------------------------------------------------------------------ cadrage et commandes de la caméra
# Ce que fait la caméra aujourd'hui, sur grand écran et sur téléphone : le filet de sécurité avant de
# la déplacer dans son propre module. Les valeurs attendues sont calculées dans la page (toScreen, le
# bord du panneau), pas recopiées.
DEVICES = pytest.mark.parametrize("device", [DESKTOP, PHONE], ids=["desktop", "phone"])
GROUPS = {"bloodborne": "Valtr and the League", "dark-souls-3": "Shields", "elden-ring": "Bell Bearings of the departed"}


def visible_area(page):
    """La partie visible de la carte, mesurée dans la page : sous la barre du haut, à gauche du panneau
    ouvert (grand écran) ou au-dessus de lui (téléphone) ; avec son centre."""
    return page.evaluate("""() => {
        const p = document.querySelector('#panel'), r = p.getBoundingClientRect(), open = !p.hidden;
        const phone = matchMedia('(max-width: 760px)').matches;
        const a = { top: document.querySelector('.topbar').getBoundingClientRect().bottom,
                    right: open && !phone ? r.left : innerWidth, bottom: open && phone ? r.top : innerHeight };
        return { ...a, center: [a.right / 2, (a.top + a.bottom) / 2] }; }""")


def inside(point, area):
    x, y = point
    return 0 <= x <= area["right"] and area["top"] <= y <= area["bottom"]


def doc_index(page, name):
    return page.evaluate("async n => (await import('./state.js')).S.docs.findIndex(d => d.name === n)", name)


def paste_address(page, address):
    """Un lien collé dans la barre d'adresse, la page déjà ouverte."""
    page.evaluate("a => { location.hash = a; }", address)


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_opening_a_text_centres_its_star(browser, site, game, device):
    first = FIRST_TEXT[game]
    page, problems = open_page(browser, f"{site}?game={game}", device)
    i = doc_index(page, first)
    camera(page)
    move_camera(page, 3, -2, 6)                         # loin du texte : il faut voler jusqu'à lui
    assert not inside(camera(page, [i])["screen"][0], visible_area(page))
    paste_address(page, ADDRESSES[game][0][1])
    wait_shown(page, ("doc", first))
    star = camera(page, [i])["screen"][0]
    assert star == pytest.approx(visible_area(page)["center"], abs=2)
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_plus_and_minus_keep_the_centre_fixed(browser, site, game, device):
    page, problems = open_page(browser, f"{site}?game={game}", device)
    page.evaluate("() => document.activeElement?.blur()")
    stars = list(range(0, 400, 40))
    cx, cy = visible_area(page)["center"]               # panneau fermé : tout l'écran sous la barre
    for key, factor in [("+", 1.3), ("-", 1 / 1.3)]:
        before = camera(page, stars)
        page.keyboard.press(key)
        after = camera(page, stars)
        assert after["s"] == pytest.approx(before["s"] * factor)
        for (x0, y0), (x1, y1) in zip(before["screen"], after["screen"]):
            assert [x1 - cx, y1 - cy] == pytest.approx([(x0 - cx) * factor, (y0 - cy) * factor], abs=1e-6)
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_arrow_keys_pan_by_a_fixed_number_of_pixels(browser, site, game, device):
    page, problems = open_page(browser, f"{site}?game={game}", device)
    page.evaluate("() => document.activeElement?.blur()")
    move_camera(page, zoom=2)                           # le pas ne dépend pas du zoom
    for key, shift in [("ArrowLeft", (80, 0)), ("ArrowRight", (-80, 0)), ("ArrowUp", (0, 80)), ("ArrowDown", (0, -80))]:
        (x0, y0), = camera(page, [0])["screen"]
        page.keyboard.press(key)
        (x1, y1), = camera(page, [0])["screen"]
        assert [x1 - x0, y1 - y0] == pytest.approx(list(shift), abs=1e-6), key
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_the_map_focused_from_the_keyboard_aims_and_pans(browser, site, game, device):
    page, problems = open_page(browser, f"{site}?game={game}", device)
    page.evaluate("() => document.activeElement?.blur()")
    for _ in range(40):                                 # Tab jusqu'à la carte : le focus est « visible »
        page.keyboard.press("Tab")
        if page.evaluate("() => document.activeElement?.id === 'sky'"):
            break
    assert page.evaluate("async () => (await import('./state.js')).S.kbd")
    page.wait_for_function("() => /^(Aiming at: |No star at the center)/.test(document.querySelector('#announce').textContent)")
    (x0, y0), = camera(page, [0])["screen"]
    page.keyboard.press("ArrowLeft")
    (x1, y1), = camera(page, [0])["screen"]
    assert [x1 - x0, y1 - y0] == pytest.approx([80, 0], abs=1e-6)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")   # le viseur redessiné
    assert problems == []


def group_stars(page, trim):
    """Les étoiles du groupe ouvert entre les quantiles trim et 1 - trim, comme les garde fitPoints, puis
    les quatre qui font les bords de cette boîte : [gauche, droite, bas, haut] (en indices de textes)."""
    return page.evaluate("""async trim => { const { S } = await import('./state.js');
        const ds = S.docs.map((d, i) => ({ x: d.x, y: d.y, i })).filter(d => S.docs[d.i].cluster === S.cluster.id);
        const q = (key, t) => [...ds].sort((a, b) => a[key] - b[key])[Math.min(ds.length - 1, Math.floor((ds.length - 1) * t))];
        const [x0, x1, y0, y1] = [q('x', trim), q('x', 1 - trim), q('y', trim), q('y', 1 - trim)];
        const kept = ds.filter(d => d.x >= x0.x && d.x <= x1.x && d.y >= y0.y && d.y <= y1.y).map(d => d.i);
        return [...kept, x0.i, x1.i, y0.i, y1.i]; }""", trim)


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_opening_a_group_puts_its_stars_on_screen(browser, site, game, device):
    group = GROUPS[game]
    page, problems = open_page(browser, f"{site}?game={game}", device)
    camera(page)
    move_camera(page, -3, 2, 6)
    paste_address(page, f"#group={group}")
    wait_shown(page, ("cluster", group))
    area = visible_area(page)

    def check(stars):
        """Toutes à l'écran, et le milieu de leur boîte au centre de la partie visible."""
        c = camera(page, stars)
        assert [p for p in c["screen"] if not inside(p, area)] == []
        (left, _), (right, _), (_, low), (_, high) = c["screen"][-4:]
        assert [(left + right) / 2, (low + high) / 2] == pytest.approx(area["center"], abs=2)
        return c

    assert check(group_stars(page, 0))["s"] <= 6        # à l'ouverture : toutes ses étoiles, sans zoomer
    # changer de carte recadre le groupe ouvert, entre les quantiles 0,1 et 0,9
    if device is PHONE:
        page.click(".menu-btn")                         # les cartes sont dans le menu
    page.click("#views button[data-v='1']")
    page.evaluate("""async () => { const { S } = await import('./state.js');      // la transition finie
        while (S.morphing) await new Promise(r => requestAnimationFrame(r)); }""")
    check(group_stars(page, 0.1))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
@DEVICES
def test_back_to_a_visible_text_keeps_the_camera(browser, site, game, device):
    first = FIRST_TEXT[game]
    page, problems = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", device)
    echo = page.text_content("#panel .echoes button .name").strip()
    page.click("#panel .echoes button")
    wait_shown(page, ("doc", echo))
    camera(page)
    move_camera(page, 0.04, -0.03)                      # un peu : les deux textes restent visibles
    before = camera(page, [doc_index(page, first), doc_index(page, echo)])
    area = visible_area(page)
    assert all(inside(p, area) for p in before["screen"])
    page.go_back()
    wait_shown(page, ("doc", first))
    assert camera(page) == {k: v for k, v in before.items() if k != "screen"}
    assert problems == []


# ------------------------------------------------------------------ ouverture dans le brouillard
def intro_active(page):
    return page.evaluate("async () => (await import('./render.js')).introActive()")


@pytest.mark.parametrize("game", GAMES)
def test_intro_plays_on_a_plain_load(browser, site, game):
    page, problems = open_page(browser, f"{site}?game={game}", DESKTOP)
    assert intro_active(page)                          # open_page attend 500 ms, l'ouverture en dure 7000
    page.mouse.click(100, 400)
    assert not intro_active(page)
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_link_to_a_page_skips_the_intro(browser, site, game):
    groups = [a for a in ADDRESSES[game] if a[0] == "group"]
    page, problems = open_page(browser, f"{site}?game={game}{groups[0][1]}", DESKTOP)
    assert shown(page) == ["cluster", groups[0][3]]
    assert not intro_active(page)
    entity = next(a for a in ADDRESSES[game] if a[0] == "entity")
    paste_address(page, entity[1])
    wait_shown(page, (entity[2], entity[3]))
    assert not intro_active(page)
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_click_during_intro_opens_the_star(browser, site, game):
    first = FIRST_TEXT[game]
    page, problems = open_page(browser, f"{site}?game={game}", DESKTOP)
    i = doc_index(page, first)
    c = camera(page)
    x, y = page.evaluate("async i => { const d = (await import('./state.js')).S.docs[i]; return [d.x, d.y]; }", i)
    move_camera(page, x - c["x"], y - c["y"], 8)        # de près : l'étoile seule sous le pointeur
    assert intro_active(page)
    sx, sy = camera(page, [i])["screen"][0]
    page.mouse.click(sx, sy)
    wait_shown(page, ("doc", first))
    assert not intro_active(page)
    assert problems == []


# ------------------------------------------------------------------ interlocuteurs incertains
def test_an_uncertain_speaker_is_marked_with_its_reason(browser, site):
    page, problems = open_page(browser, f"{site}?game=dark-souls-3#dialogue=Darkdiver%20Grandahl", DESKTOP)
    wait_shown(page, ("dialogue", "Darkdiver Grandahl ?"))
    mark = page.get_attribute("#panel h2 .unsure", "title")
    assert mark == "Named from what the lines say; no source confirms it."
    assert page.text_content("#panel .unsure-note").strip() == f"Uncertain speaker: {mark}"
    page.click("#panel .pnum")
    wait_shown(page, ("doc", "Darkdiver Grandahl — passage 1 ?"))
    assert page.get_attribute("#panel h2 .unsure", "title") == mark
    assert problems == []


@pytest.mark.parametrize("game, speaker", [("dark-souls-3", "Yuria of Londor"), ("bloodborne", "Gehrman")])
def test_a_confirmed_speaker_has_no_mark(browser, site, game, speaker):
    page, problems = open_page(browser, f"{site}?game={game}#dialogue={quote(speaker)}", DESKTOP)
    wait_shown(page, ("dialogue", speaker))
    assert page.query_selector("#panel .unsure") is None and page.query_selector("#panel .unsure-note") is None
    assert problems == []
