"""Lecture des archives de messages de Bloodborne, sur de petits fichiers fabriqués ici
dans la même disposition que ceux du jeu (DCX DFLT -> BND4 -> FMG v2)."""
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "games" / "bloodborne"))
from extract import build, note_title, read_bnd4, read_dcx, read_fmg, speaker_for, unwrap, drop_repeated_runs  # noqa: E402


def make_fmg(entries):
    """FMG v2 : un groupe par suite d'identifiants consécutifs."""
    ids = sorted(entries)
    groups, start = [], 0
    for k in range(1, len(ids) + 1):
        if k == len(ids) or ids[k] != ids[k - 1] + 1:
            groups.append((start, ids[start], ids[k - 1]))
            start = k
    head = 0x28 + 16 * len(groups)
    offsets_at = head
    strings_at = offsets_at + 8 * len(ids)
    blobs, offsets, at = [], [], strings_at
    for i in ids:
        b = entries[i].encode("utf-16-le") + b"\0\0"
        offsets.append(at)
        blobs.append(b)
        at += len(b)
    out = bytearray(b"\0\0\x02\0") + struct.pack("<i", at) + b"\x01\xff\0\0"
    out += struct.pack("<iii", len(groups), len(ids), 0xFF) + struct.pack("<qq", offsets_at, 0)
    for index, first, last in groups:
        out += struct.pack("<iiii", index, first, last, 0)
    out += struct.pack(f"<{len(ids)}q", *offsets) + b"".join(blobs)
    return bytes(out)


def make_bnd4(files):
    entry_size = 0x24
    names_at = 0x40 + entry_size * len(files)
    names = b"".join(f"N:\\msg\\{n}".encode("utf-16-le") + b"\0\0" for n in files)
    data_at = names_at + len(names)
    head = bytearray(0x40)
    head[0:4] = b"BND4"
    struct.pack_into("<i", head, 0x0C, len(files))
    struct.pack_into("<q", head, 0x20, entry_size)
    head[0x30], head[0x31] = 1, 0x74
    entries, blobs, name_at, at = bytearray(), b"", names_at, data_at
    for n, content in files.items():
        entries += struct.pack("<B3xi", 0x40, -1) + struct.pack("<qq", len(content), len(content))
        entries += struct.pack("<Iii", at, 0, name_at)
        name_at += len(f"N:\\msg\\{n}".encode("utf-16-le")) + 2
        blobs += content
        at += len(content)
    return bytes(head + entries + names + blobs)


def make_dcx(data):
    head = bytearray(0x4C)
    head[0:4] = b"DCX\0"
    struct.pack_into(">I", head, 0x1C, len(data))
    head[0x28:0x2C] = b"DFLT"
    return bytes(head) + zlib.compress(data)


def test_reads_texts_through_dcx_bnd4_and_fmg():
    fmg = make_fmg({10: "Saw Cleaver", 11: "Saw Spear", 20: "Hunter's Mark", 21: ""})
    files = read_bnd4(read_dcx(make_dcx(make_bnd4({"武器名.fmg": fmg, "空.fmg": make_fmg({1: "x"})}))))
    assert set(files) == {"武器名.fmg", "空.fmg"}
    assert read_fmg(files["武器名.fmg"]) == {10: "Saw Cleaver", 11: "Saw Spear", 20: "Hunter's Mark"}


def test_sub_block_speaker_wins_over_its_block():
    speakers = {"blocks": {"1100": "Research Hall Patients"}, "sub_blocks": {"110003": "Yamamura"}, "unknown": "?"}
    assert speaker_for(11000300, speakers) == "Yamamura"
    assert speaker_for(11000400, speakers) == "Research Hall Patients"
    assert speaker_for(5000000, speakers) is None


def test_note_title_skips_the_scrawl_header():
    assert note_title("Handwritten scrawl:\n\nSeek Paleblood to transcend the hunt.") == "Seek Paleblood to transcend the hunt."
    assert note_title("Phrase griffonnée :\n\nRecherchez le Pâlesang pour transcender la chasse.") \
        == "Recherchez le Pâlesang pour transcender la…"


def test_build_keeps_named_texts_and_attributes_dialogue():
    def tables(text):
        return {"アイテム名": {1: "Item"}, "アイテムうんちく": {1: text}, "武器名": {7: "Saw Cleaver", 8: "*"},
                "武器うんちく": {7: text, 8: text, 9: text}, "防具名": {}, "防具うんちく": {},
                "魔石名": {11000000: "Moon", 5: "Gem"}, "魔石うんちく": {11000000: text, 5: text},
                "イベントテキスト": {10012000: "Handwritten scrawl:\n\nSeek Paleblood."},
                "会話": {500000: "Welcome.", 500001: "Welcome.", 500002: "Hunt.", 500052: "Hunt."},
                "ムービー字幕": {900000: "Paleblood..."}}
    speakers = {"blocks": {"50": "Gehrman"}, "sub_blocks": {}, "unknown": "?"}
    data = build({"en": tables("lore"), "fr": tables("savoir"), "jp": tables("知")}, speakers)
    assert list(data["weapon"]) == ["7"]                        # « * » et sans nom : écartés
    assert data["weapon"]["7"]["caption_fr"] == "savoir"
    assert list(data["rune"]) == ["11000000"] and list(data["gem"]) == ["5"]
    assert data["note"]["10012000"]["name_en"] == "Seek Paleblood."
    # la même réplique deux fois de suite, ou sa variante pour une chasseuse (+50), une seule fois
    assert data["dialog"]["Gehrman"]["info_en"] == "[500000] Welcome.<br/><br/>[500002] Hunt."
    assert "[500052]" not in data["dialog"]["Gehrman"]["info_fr"]
    assert "Cutscenes" in data["dialog"]


def test_unwrap_joins_hand_wrapped_lines_but_keeps_paragraphs():
    assert unwrap("One of the trick weapons, commonly \nused in the hunt.\n\nA saw.", "en") \
        == "One of the trick weapons, commonly used in the hunt.\n\nA saw."
    assert unwrap("獣狩りの夜、\n聖堂街", "jp") == "獣狩りの夜、聖堂街"


def test_repeated_runs_are_dropped_but_a_lone_repeat_stays():
    talk = {1: "Hello.", 2: "A safe place?", 3: "Be a dear.", 4: "Oh...", 5: "Hello.", 6: "A safe place?",
            7: "Be a dear.", 8: "New line.", 9: "Oh..."}
    tables = {"fr": {"会話": {}}, "en": {"会話": talk}}
    assert drop_repeated_runs(sorted(talk), tables) == [1, 2, 3, 4, 8, 9]


def test_texts_missing_from_the_base_game_are_marked_dlc():
    def tables(text):
        return {"アイテム名": {1: "Item", 2: "New Item"}, "アイテムうんちく": {1: text, 2: text},
                "武器名": {}, "武器うんちく": {}, "防具名": {}, "防具うんちく": {}, "魔石名": {}, "魔石うんちく": {},
                "イベントテキスト": {10012000: "Old note.", 10012001: "New note."},
                "会話": {500000: "Old line.", 500001: "New line."}, "ムービー字幕": {}}
    speakers = {"blocks": {"50": "Gehrman"}, "sub_blocks": {}, "unknown": "?"}
    base = {"アイテムうんちく": {1}, "イベントテキスト": {10012000}, "会話": {500000}}
    data = build({"en": tables("lore"), "fr": tables("savoir"), "jp": tables("知")}, speakers, base)
    assert "dlc" not in data["goods"]["1"] and data["goods"]["2"]["dlc"] is True
    assert "dlc" not in data["note"]["10012000"] and data["note"]["10012001"]["dlc"] is True
    assert data["dialog"]["Gehrman"]["dlc_lines"] == [500001]
    # sans jeu de base, rien n'est marqué
    plain = build({"en": tables("lore"), "fr": tables("savoir"), "jp": tables("知")}, speakers)
    assert not any("dlc" in r for r in plain["goods"].values()) and "dlc_lines" not in plain["dialog"]["Gehrman"]
