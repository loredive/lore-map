"""Textes de Dark Souls III, sur de petites archives fabriquées dans la même disposition que celles du
jeu (item_dlc2 et menu_dlc2 par langue ; chaque table en trois parts : jeu de base, _dlc1, _dlc2)."""
import importlib.util
from pathlib import Path

from test_bloodborne_extract import make_bnd4, make_dcx, make_fmg

# extract.py existe dans chaque dossier de jeu : celui-ci est chargé sous un nom à lui
_path = Path(__file__).parent.parent / "games" / "dark-souls-3" / "extract.py"
_spec = importlib.util.spec_from_file_location("ds3_extract", _path)
ds3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds3)

SPEAKERS = {"blocks": {"20": "Fire Keeper"}, "sub_blocks": {}, "unknown": "Unknown NPC"}


def test_dlc_parts_merge_under_the_base_table_and_are_remembered():
    tables, dlc = ds3.merge_parts({"武器名": {1: "Dagger"}, "武器名_dlc1": {2: "Frayed Blade"},
                                   "武器名_dlc2": {3: "Ringed Knight Spear"}, "会話": {200000: "Welcome."}})
    assert tables["武器名"] == {1: "Dagger", 2: "Frayed Blade", 3: "Ringed Knight Spear"}
    assert dlc["武器名"] == {2, 3} and dlc["会話"] == set()


def lang_tables(text, line):
    """Tables d'une langue, déjà fusionnées (merge_parts)."""
    return {"アイテム名": {1: "Estus Flask", 2: "Soul Arrow", 3: "Ember"},
            "アイテムうんちく": {1: f"{text} estus", 2: f"{text} arrow", 3: f"{text} ember"},
            "武器名": {10: "Dagger", 11: ""}, "武器うんちく": {10: f"{text} dagger", 11: f"{text} nameless"},
            "防具名": {30: "No Travel Gear / Head"}, "防具うんちく": {30: "No Travel Gear / Head"},
            "アクセサリ名": {}, "アクセサリうんちく": {},
            "魔法名": {3000: "Soul Arrow", 1300000: "Soul Arrow", 3100: "Karmic Justice"},
            "魔法うんちく": {3000: f"{text} old arrow", 1300000: f"{text} arrow", 3100: f"{text} karma"},
            "会話": {200000: line, 200001: f"{line} again"}, "ムービー字幕": {}}


def test_build_writes_each_category_in_three_languages():
    tables = {"en": lang_tables("lore", "Welcome."), "jp": lang_tables("知", "ようこそ"), "fr": lang_tables("savoir", "Bienvenue.")}
    data = ds3.build(tables, {}, SPEAKERS)
    assert set(data) == {"goods", "weapon", "protector", "accessory", "magic", "dialog"}
    assert data["weapon"]["10"] == {"name_en": "Dagger", "caption_en": "lore dagger", "name_jp": "Dagger",
                                    "caption_jp": "知 dagger", "name_fr": "Dagger", "caption_fr": "savoir dagger"}
    assert "11" not in data["weapon"]                       # sans nom : une variante, pas un objet
    assert data["protector"] == {}                          # sa description n'est que son nom : un emplacement vide
    assert data["dialog"]["Fire Keeper"]["info_fr"] == "[200000] Bienvenue.<br/><br/>[200001] Bienvenue. again"


def test_a_spell_is_shown_once_under_spells_not_again_as_an_item():
    tables = {lang: lang_tables(t, "Welcome.") for lang, t in [("en", "lore"), ("jp", "知"), ("fr", "savoir")]}
    data = ds3.build(tables, {}, SPEAKERS)
    assert list(data["magic"]) == ["1300000"]                # les anciens sorts (< 1 000 000) : jamais en jeu
    assert sorted(data["goods"]) == ["1", "3"]               # « Soul Arrow » n'est plus un objet


def test_texts_from_the_dlc_tables_are_marked_dlc():
    tables = {lang: lang_tables(t, "Welcome.") for lang, t in [("en", "lore"), ("jp", "知"), ("fr", "savoir")]}
    dlc = {"アイテムうんちく": {3}, "会話": {200001}}
    data = ds3.build(tables, dlc, SPEAKERS)
    assert data["goods"]["3"]["dlc"] is True and "dlc" not in data["goods"]["1"]
    assert data["dialog"]["Fire Keeper"]["dlc_lines"] == [200001]


def test_load_tables_reads_the_dlc2_archives_of_each_language(tmp_path):
    for lang, folder in ds3.LANGS.items():
        item = {"武器名.fmg": make_fmg({10: f"Dagger {lang}"}), "武器名_dlc2.fmg": make_fmg({12: f"Spear {lang}"})}
        menu = {"会話.fmg": make_fmg({200000: f"Hello {lang}"}), "会話_dlc1.fmg": make_fmg({200001: f"Hi {lang}"})}
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "item_dlc2.msgbnd.dcx").write_bytes(make_dcx(make_bnd4(item)))
        (tmp_path / folder / "menu_dlc2.msgbnd.dcx").write_bytes(make_dcx(make_bnd4(menu)))
    tables, dlc = ds3.load_tables(tmp_path)
    assert tables["fr"]["武器名"] == {10: "Dagger fr", 12: "Spear fr"}
    assert tables["jp"]["会話"] == {200000: "Hello jp", 200001: "Hi jp"}
    assert dlc["武器名"] == {12} and dlc["会話"] == {200001}


_vpath = Path(__file__).parent.parent / "games" / "dark-souls-3" / "vote_speakers.py"
_vspec = importlib.util.spec_from_file_location("ds3_vote", _vpath)
vote = importlib.util.module_from_spec(_vspec)
_vspec.loader.exec_module(vote)


def test_each_block_takes_the_page_quoting_most_of_its_lines_and_sub_blocks_can_differ():
    pages = {"Fire Keeper (Dark Souls III)": "''Welcome to the bonfire, Unkindled One.'' [[Ashen One|Ashen]] one, farewell to thee. "
                                             "Speak with the Fire Keeper, she awaiteth thee.",
             "Oceiros, the Consumed King": "Ahh, you ignorant slaves. Of the power of my beloved Ocelotte.",
             "Ludleth of Courland": "Welcome to the bonfire, Unkindled One. I may be but small, but I will die a colossus. "
                                    "Five lords for five thrones, all is planned. A transposing kiln in thy possession.",
             "Nestling": "Me, me, pickle-pee, pump-a-rum."}
    talk = {2000000: "Welcome to the bonfire, Unkindled One.", 2000001: "Ashen one, farewell to thee.",
            2000002: "Ashen one, farewell to thee.", 2000003: "Ashen one, farewell to thee.",
            500: "Ahh, you ignorant slaves.", 501: "Of the power of my beloved Ocelotte.", 502: "Hmm...",
            503: "Of the power of my beloved Ocelotte.",
            1950: "Ashen one, farewell to thee.", 1951: "Ashen one, farewell to thee.", 1952: "Ashen one, farewell to thee.",
            3000000: "I may be but small, but I will die a colossus.", 3000001: "Five lords for five thrones, all is planned.",
            3000002: "A transposing kiln in thy possession.",
            3001800: "Speak with the Fire Keeper, she awaiteth thee.", 3001801: "Speak with the Fire Keeper, she awaiteth thee.",
            29000000: "Me, me, pickle-pee, pump-a-rum.", 29000001: "Me, me, pickle-pee, pump-a-rum.",
            29000002: "Me, me, pickle-pee, pump-a-rum.", 57000000: "Ahh, you ignorant slaves."}
    blocks, subs, _hits = vote.vote(talk, pages)
    assert blocks[200]["Fire Keeper (Dark Souls III)"] == 3.5      # une réplique sur deux pages : ½ voix chacune
    data = vote.speakers(blocks, subs)
    assert data["blocks"]["200"] == "Fire Keeper"                    # RENAME
    assert data["blocks"]["2900"] == "Pickle Pee, Pump-a-Rum Crow"
    assert data["blocks"]["7500"] == "Darkdiver Grandahl"            # MANUAL
    assert "0" not in data["blocks"]                        # bloc mêlé : pas de nom par défaut
    assert "5700" not in data["blocks"]                             # une seule voix : sans nom
    # le bloc 0 est mêlé (3 voix contre 3) : chacun de ses sous-blocs a son personnage, et un sous-bloc
    # sans voix restera sans nom ; le bloc 300 ne l'est pas (3 voix contre 2) : le sous-bloc 30018, qui
    # parle de la Gardienne du feu, reste à Ludleth
    assert data["sub_blocks"] == {"5": "Oceiros, the Consumed King", "19": "Fire Keeper"}


def test_only_a_true_gendered_twin_is_dropped():
    def tables(lang):
        t = lang_tables("lore", "x")
        t["会話"] = {200003: "A Lord himself Unkindled.", 200053: "A Lord herself Unkindled.",
                    200005: "Let him grant death...", 200055: "To the old gods of Lordran, deliverers of the First Flame.",
                    200007: "(dummyText)", 200057: "Ahh, Unkindled One."}
        return t
    data = ds3.build({lang: tables(lang) for lang in ds3.LANGS}, {}, SPEAKERS)
    info = data["dialog"]["Fire Keeper"]["info_en"]
    assert "[200053]" not in info                          # « herself » au lieu de « himself » : la même réplique
    assert "[200055] To the old gods" in info              # +50, mais une autre réplique
    assert "[200057] Ahh, Unkindled One." in info and "dummyText" not in info


def test_speakers_with_few_confirmed_lines_are_marked_uncertain():
    pages = {"Yuria of Londor": "Link the fire, our Lord of Hollows. The Age of Fire was founded by the old gods.",
             "Slave Knight Gael": "Ashen one, hearest thou my voice, still?"}
    talk = {4000000: "Link the fire, our Lord of Hollows.", 4000001: "The Age of Fire was founded by the old gods.",
            4000002: "Hmm...",                                        # trop court : ne compte pas
            51000000: "Ashen one, hearest thou my voice, still?", 51000001: "A line no page quotes at all.",
            51000002: "Another line no page quotes at all.",
            75000000: "Fear not, the dark, my friend.", 27000500: "Another nana disappeared",
            1000000: "It is called Lothric, where the lands converge."}
    blocks, subs, hits = vote.vote(talk, pages)
    data = {"unknown": "Unknown NPC", "sub_blocks": {},
            "blocks": {"400": "Yuria of Londor", "5100": "Slave Knight Gael", "7500": "Darkdiver Grandahl", "100": "Narrator"}}
    unsure = vote.uncertain(talk, data, hits)
    assert "Yuria of Londor" not in unsure                           # 2 répliques sur 2
    assert unsure["Slave Knight Gael"].startswith("The Dark Souls wiki confirms 1 of 3 lines")
    assert unsure["Darkdiver Grandahl"] == "Named from what the lines say; no source confirms it."
    assert unsure["Unknown NPC"] == "No source says who speaks these lines."
    assert "Narrator" not in unsure                                  # SURE : ses répliques suffisent
