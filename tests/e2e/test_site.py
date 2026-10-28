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

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

WEB = Path(__file__).resolve().parents[2] / "web"
GAMES = ["bloodborne", "elden-ring"]
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


def open_page(browser, url, device, slow_data=False, storage=None):
    """La page chargée, avec la liste de ce qui a mal tourné : erreurs JavaScript, ressources refusées par
    la politique de sécurité, requêtes en échec (sauf les icônes, absentes avant le déploiement)."""
    context = browser.new_context(**device)
    if storage:     # localStorage du site avant tout chargement (une History enregistrée lors d'une visite passée)
        context.add_init_script("".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});"
                                        for k, v in storage.items()))
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
    ],
}
FIRST_TEXT = {"bloodborne": "Hunter's Mark", "elden-ring": "Tarnished's Furled Finger"}


def shown(page):
    """La page du panneau : [sorte de page, titre], ou None quand le panneau est fermé."""
    return page.evaluate("""() => { const p = document.querySelector('#panel');
        return p.hidden ? null : [p.dataset.view, p.querySelector('h2')?.textContent.trim() ?? null]; }""")


def wait_shown(page, expected):
    """Attend que le panneau montre `expected` (Retour et la recherche sont asynchrones), puis le vérifie."""
    want = list(expected) if expected else None
    try:
        page.wait_for_function("""w => { const p = document.querySelector('#panel');
            return w === null ? p.hidden
                 : !p.hidden && p.dataset.view === w[0] && p.querySelector('h2')?.textContent.trim() === w[1]; }""",
                               arg=want, timeout=5000)
    except sync_api.TimeoutError:
        pass
    assert shown(page) == want


@pytest.mark.parametrize("game", GAMES)
@pytest.mark.parametrize("kind", range(7), ids=[a[0] for a in ADDRESSES["bloodborne"]])
def test_address_opens_its_page(browser, site, game, kind):
    _, address, view, title = ADDRESSES[game][kind]
    page, problems = open_page(browser, f"{site}?game={game}{address}", DESKTOP)
    assert shown(page) == [view, title]
    if view == "tour":
        assert "step 3 of" in page.text_content("#panel .cat")
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
    page.click("#history")
    wait_shown(page, ("history", "History"))
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
def test_typing_a_search_is_one_step(browser, site, game):
    first = FIRST_TEXT[game]
    page, _ = open_page(browser, f"{site}?game={game}{ADDRESSES[game][0][1]}", DESKTOP)
    # la recherche par le sens téléchargerait un modèle : sans réseau, elle se rabat sur les mots
    page.route(lambda url: not url.startswith(site), lambda route: route.abort())
    page.click("#q")
    page.keyboard.type("blood", delay=300)          # plus lent que l'attente de la recherche : un rendu par lettre
    page.wait_for_function("() => document.querySelector('#panel').dataset.view === 'results'")
    page.wait_for_timeout(500)
    page.go_back()
    wait_shown(page, ("doc", first))
    assert page.input_value("#q") == ""


@pytest.mark.parametrize("game", GAMES)
def test_saved_history_reopens_its_steps(browser, site, game):
    first = FIRST_TEXT[game]
    # le format enregistré d'aujourd'hui, sous la même clé : une History d'une visite passée se relit telle quelle
    saved = json.dumps({"v": 2, "steps": [{"kind": "doc", "key": first}], "shown": False})
    page, problems = open_page(browser, f"{site}?game={game}", DESKTOP, storage={f"lore-map:trail:{game}": saved})
    page.click("#history")
    wait_shown(page, ("history", "History"))
    assert page.text_content("#panel .trail-list .name").strip() == first
    page.click("#panel .tcontinue")
    wait_shown(page, ("doc", first))
    assert page.text_content("#panel .panel-top .back").strip() == "Back to your history"
    page.go_back()
    wait_shown(page, ("history", "History"))
    assert problems == []


@pytest.mark.parametrize("game", GAMES)
def test_back_to_the_results(browser, site, game):
    page, _ = open_page(browser, f"{site}?game={game}", DESKTOP)
    page.route(lambda url: not url.startswith(site), lambda route: route.abort())
    page.fill("#q", "blood")
    page.wait_for_function("() => document.querySelector('#panel').dataset.view === 'results'")
    name = page.text_content("#panel .results button .name").strip()
    page.click("#panel .results button")
    wait_shown(page, ("doc", name))
    assert page.text_content("#panel .panel-top .back").strip() == "Back to the results for “blood”"
    page.click("#panel .panel-top .back")
    page.wait_for_function("() => document.querySelector('#panel').dataset.view === 'results'")
    assert page.input_value("#q") == "blood"
