"""La page dans un vrai navigateur : chaque jeu se charge sans erreur ni ressource bloquée, la barre
reste compacte, les nuages des groupes sont là même si les données arrivent lentement, et le menu du
téléphone montre les catégories. Lancé par la CI avant chaque déploiement.

    uv run --no-project --with pytest --with playwright==1.64.0 pytest tests/e2e
    (PLAYWRIGHT_CHROMIUM=<chemin d'un chromium> pour réutiliser un navigateur déjà installé)
"""
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
