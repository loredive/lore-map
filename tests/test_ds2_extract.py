"""Textes de Dark Souls II (Scholar of the First Sin) : les règles de l'extracteur, sur de petites tables."""
from lore_map.sources.dark_souls_2 import extract as ds2

SPEAKERS = {"blocks": {"7050": "Firekeepers"}, "sub_blocks": {}, "unknown": "Unknown NPC"}


def test_the_category_is_read_on_the_item_id():
    assert ds2.category_of(1000000) == "weapon"                # Dagger
    assert ds2.category_of(11000000) == "shield"
    assert ds2.category_of(21010100) == "protector"
    assert ds2.category_of(31010000) == "magic"                # Soul Arrow
    assert ds2.category_of(40010000) == "ring"
    assert ds2.category_of(50600000) == "key"
    assert ds2.category_of(64000000) == "goods"                # une âme de boss
    assert ds2.category_of(892001000) is None                  # autre version d'une armure
    assert ds2.category_of(900008400) is None                  # brouillon des textes d'armes


def test_talk_maps_come_from_the_english_file_list():
    files = ["/menu/text/english/talk/m10_02_00_00.fmg", "/menu/text/english/talk/charaname.fmg",
             "/menu/text/french/talk/m10_04_00_00.fmg", "/menu/text/english/talk/m50_35_00_00.fmg"]
    assert ds2.talk_maps(files) == ["m10_02_00_00", "m50_35_00_00"]


def lang_tables(text, line):
    return {"names": {1000000: "Dagger", 21010100: "Pate's Helm", 900008400: "Dagger", 60010000: "Lifegem"},
            "lore": {1000000: f"{text} dagger", 21010100: f"{text} helm", 900008400: "Weapon type: Dagger",
                     60010000: "Lifegem"},
            ds2.TALK: {70500000: f"{line} curse", 70500050: f"{line} accursed", 75810000: f"{line} Loyce"},
            ds2.SUBTITLES: {99900000: f"{line} dream"}}


def test_build_keeps_game_items_in_both_languages_and_marks_dlc_lines():
    tables = {"en": lang_tables("A", "Ooh, my!"), "fr": lang_tables("Une", "Oh !")}
    out = ds2.build(tables, {75810000}, SPEAKERS)
    assert out["weapon"] == {"1000000": {"name_en": "Dagger", "caption_en": "A dagger",
                                         "name_fr": "Dagger", "caption_fr": "Une dagger"}}
    assert set(out["protector"]) == {"21010100"}
    assert out["goods"] == {}                                  # rien que le nom
    fire = out["dialog"]["Firekeepers"]
    # la réplique +50 est une autre réplique, pas une variante de genre : gardée
    assert fire["info_en"] == "[70500000] Ooh, my! curse<br/><br/>[70500050] Ooh, my! accursed"
    assert fire["info_fr"].startswith("[70500000] Oh ! curse")
    assert out["dialog"]["Unknown NPC"]["dlc_lines"] == [75810000]
    assert out["dialog"]["Cutscenes"]["info_en"] == "[99900000] Ooh, my! dream"


def test_junk_entries_are_dropped():
    assert ds2.clean(" no text ") == ""
    assert ds2.clean("none text") == ""
    assert ds2.clean("(no line)") == "" and ds2.clean("(N/A)") == "" and ds2.clean("(deleted)") == ""
    assert ds2.clean("A murky, forgotten land. ") == "A murky, forgotten land."


def test_an_item_without_an_icon_is_never_shown():
    tables = {"en": lang_tables("A", "Ooh"), "fr": lang_tables("Une", "Oh")}
    out = ds2.build(tables, set(), SPEAKERS, icons={1000000: 21, 21010100: 0})
    assert set(out["weapon"]) == {"1000000"}
    assert out["protector"] == {}                              # icône 0 : un objet coupé


def test_an_item_named_in_the_dlc_list_is_marked_dlc():
    tables = {"en": lang_tables("A", "Ooh"), "fr": lang_tables("Une", "Oh")}
    out = ds2.build(tables, set(), SPEAKERS, dlc_items={"Pate's Helm"})
    assert out["protector"]["21010100"]["dlc"] is True
    assert "dlc" not in out["weapon"]["1000000"]


def test_an_icon_is_cropped_to_what_shows_and_centred_in_a_square():
    from PIL import Image

    from lore_map.sources.dark_souls_2 import icons
    im = Image.new("RGBA", (128, 256))
    im.paste((200, 50, 50, 255), (40, 100, 60, 180))          # 20 × 80 visibles
    out = icons.square(im, size=160)
    assert out.size == (80, 80)                                # pas agrandie
    assert out.getchannel("A").getbbox() == (30, 0, 50, 80)    # centrée
    assert icons.square(Image.new("RGBA", (128, 256)), size=64).size == (64, 64)
