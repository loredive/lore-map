"""
Les jeux de la carte : un dossier games/<id>/ par jeu.

game.json y décrit ce qui change d'un jeu à l'autre (catégories du texte source, couleurs, mots
vides, noms d'interlocuteurs, réglages des groupes, exemples de la page) ; entities.json,
labels.json et eval/ s'y trouvent aussi. prepare.py écrit les données dans web/data/<id>/ et
publish() y copie la partie de game.json que lit la page.
"""
import json
from dataclasses import dataclass
from pathlib import Path

from lore_format import read_lore

ROOT = Path(__file__).parent
GAMES = ROOT / "games"
WEB = ROOT / "web"
DEFAULT = "elden-ring"                  # jeu des scripts sans --game
FIRST = "bloodborne"                    # premier jeu de la page, celui qu'elle ouvre sans ?game=
PAGE_KEYS = ("id", "title", "colors", "ui", "images")     # ce que la page lit de game.json


@dataclass(frozen=True)
class Category:
    label: str
    text_fields: tuple[str, ...]     # champs du texte, dans la langue principale (caption_en…)
    jp_field: str


@dataclass(frozen=True)
class Game:
    id: str
    title: str
    categories: dict[str, Category]
    dialog_label: str
    junk: tuple[str, ...]
    extra_stop: tuple[str, ...]
    speaker_names: dict[str, str]
    min_cluster: int
    min_samples: int
    images: str | None
    text_lang: str          # langue des textes affichés et des embeddings (« en », « fr »)
    alt_lang: str | None    # seconde langue, montrée à la demande et cherchée par mots-clés
    min_chars: int          # en dessous, un texte est trop court pour la carte
    cfg: dict

    @property
    def dir(self) -> Path:
        return GAMES / self.id

    @property
    def data_dir(self) -> Path:
        return WEB / "data" / self.id

    @property
    def img_dir(self) -> Path:
        return WEB / "img" / self.id


def list_games() -> list[str]:
    return sorted(p.parent.name for p in GAMES.glob("*/game.json"))


def load_game(gid: str = DEFAULT) -> Game:
    path = GAMES / gid / "game.json"
    if not path.exists():
        raise SystemExit(f"jeu inconnu : {gid} (disponibles : {', '.join(list_games())})")
    c = json.loads(path.read_text(encoding="utf-8"))
    cats = {k: Category(v["label"], tuple(v["text_fields"]), v["jp_field"]) for k, v in c["categories"].items()}
    return Game(id=c["id"], title=c["title"], categories=cats, dialog_label=c["dialog_label"],
                junk=tuple(c.get("junk", [])), extra_stop=tuple(c.get("extra_stop", [])),
                speaker_names=c.get("speaker_names", {}), min_cluster=c.get("min_cluster", 15),
                min_samples=c.get("min_samples", 5), images=c.get("images"),
                text_lang=c.get("text_lang", "en"), alt_lang=c.get("alt_lang"),
                min_chars=c.get("min_chars", 40), cfg=c)


def publish(game: Game) -> None:
    """Écrit web/data/<id>/game.json (la partie lue par la page) et web/data/games.json,
    la liste des jeux dont les données sont prêtes (le sélecteur de la page)."""
    game.data_dir.mkdir(parents=True, exist_ok=True)
    page = {k: game.cfg[k] for k in PAGE_KEYS if k in game.cfg}
    page["tours"] = (game.dir / "tours.json").exists()     # la page ne demande tours.json que s'il existe
    speakers = game.dir / "speakers.json"                    # interlocuteurs incertains : marqués par la page
    if speakers.exists() and (unsure := json.loads(speakers.read_text(encoding="utf-8")).get("uncertain")):
        page["uncertain_speakers"] = unsure
    (game.data_dir / "game.json").write_text(json.dumps(page, ensure_ascii=False, indent=1), encoding="utf-8")
    publish_tours(game)
    ready = [g for g in list_games() if (WEB / "data" / g / "lore.json").exists()]
    ready.sort(key=lambda g: g != FIRST)            # le premier jeu de la page d'abord, puis les autres
    listing = [{"id": g.id, "title": g.title, "langs": [g.text_lang] + ([g.alt_lang] if g.alt_lang else [])}
               for g in map(load_game, ready)]          # langs : les langues des textes, pour le sélecteur
    (WEB / "data" / "games.json").write_text(json.dumps(listing, ensure_ascii=False), encoding="utf-8")


def publish_tours(game: Game) -> None:
    """Copie games/<id>/tours.json (visites guidées, écrites à la main) dans web/data/<id>/ ;
    chaque étape doit nommer un texte de la carte, sinon la publication s'arrête."""
    src, dst = game.dir / "tours.json", game.data_dir / "tours.json"
    if not src.exists():
        dst.unlink(missing_ok=True)
        return
    tours = json.loads(src.read_text(encoding="utf-8"))
    lore = read_lore(game.data_dir / "lore.json")
    names = {d["name"] for d in lore["docs"]}
    missing = [(t["id"], s["text"]) for t in tours for s in t["steps"] if s["text"] not in names]
    if missing:
        raise SystemExit(f"tours.json : étapes sans texte sur la carte : {missing}")
    dst.write_text(json.dumps(tours, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(tours)} visites guidées publiées")
