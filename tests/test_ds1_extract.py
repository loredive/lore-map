"""Textes de Dark Souls (Prepare to Die Edition) : les règles de l'extracteur, sur de petites tables."""
import importlib.util
from pathlib import Path

# extract.py existe dans chaque dossier de jeu : celui-ci est chargé sous un nom à lui
_path = Path(__file__).parent.parent / "games" / "dark-souls-1" / "extract.py"
_spec = importlib.util.spec_from_file_location("ds1_extract", _path)
ds1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds1)

SPEAKERS = {"blocks": {"1000": "Oscar of Astora"}, "sub_blocks": {}, "unknown": "Unknown NPC"}


def test_patch_tables_correct_the_base_game_and_add_the_dlc():
    files = {"アイテムうんちく": {1: "Old text", 2: "Kept"}, "アイテムうんちくパッチ": {1: "Fixed text", 3: "Abyss"}}
    tables, dlc = ds1.merge_patch(files)
    assert tables["アイテムうんちく"] == {1: "Fixed text", 2: "Kept", 3: "Abyss"}
    assert dlc["アイテムうんちく"] == {3}                      # 1 n'est qu'une correction


def test_weapon_type_lines_are_not_lore():
    text = "Weapon type: Curved Greatsword\nAttack type: Slash\n\nA curved greatsword forged from a demon."
    assert ds1.lore_only(text) == "A curved greatsword forged from a demon."
    assert ds1.lore_only("\nMask worn by spooks.") == "Mask worn by spooks."


def lang_tables(text, line):
    return {"アイテム名": {1: "Estus Flask", 2: "Soul Arrow", 3: "Test"},
            "アイテムうんちく": {1: f"{text} estus", 2: f"{text} arrow", 3: "For Test"},
            "武器名": {10: "Dagger", 11: ""},
            "武器うんちく": {10: f"Weapon type: Dagger\nAttack type: Thrust\n\n{text} dagger", 11: f"{text} nameless"},
            "防具名": {}, "防具うんちく": {}, "アクセサリ名": {}, "アクセサリうんちく": {},
            "魔法名": {3000: "Soul Arrow"}, "魔法うんちく": {3000: f"{text} arrow"},
            "会話": {10000000: line, 10000001: f"{line} again"}, "ムービー字幕": {}}


def test_build_writes_each_category_in_three_languages_lore_only():
    tables = {"en": lang_tables("lore", "Hello."), "jp": lang_tables("知", "やあ"), "fr": lang_tables("savoir", "Salut.")}
    data = ds1.build(tables, {}, SPEAKERS)
    assert set(data) == {"goods", "weapon", "protector", "accessory", "magic", "dialog"}
    assert data["weapon"]["10"]["caption_en"] == "lore dagger" and data["weapon"]["10"]["caption_fr"] == "savoir dagger"
    assert "11" not in data["weapon"]                       # sans nom : une variante, pas un objet
    assert sorted(data["goods"]) == ["1"]                   # le sort n'est montré qu'en sort ; « For Test » est vide
    assert data["dialog"]["Oscar of Astora"]["info_en"] == "[10000000] Hello.<br/><br/>[10000001] Hello. again"


def test_texts_only_in_the_patch_are_marked_dlc():
    tables = {lang: lang_tables(t, "Hello.") for lang, t in [("en", "lore"), ("jp", "知"), ("fr", "savoir")]}
    data = ds1.build(tables, {"武器うんちく": {10}, "会話": {10000001}}, SPEAKERS)
    assert data["weapon"]["10"]["dlc"] is True and "dlc" not in data["goods"]["1"]
    assert data["dialog"]["Oscar of Astora"]["dlc_lines"] == [10000001]
