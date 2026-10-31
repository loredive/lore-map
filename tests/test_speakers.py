"""Le vote des interlocuteurs, commun aux jeux Souls (lore_map/speakers.py) : ce que les tests de Dark
Souls III ne couvrent pas, les sous-blocs nommés à la main (le bloc 0 de Dark Souls) et la source."""
from lore_map.speakers import Rules, speakers, uncertain, vote

RULES = Rules(game="g", title="Some Souls", wiki="Some Souls", pages="personnages", categories=("C",),
              manual={"300": "Snuggly the Crow"}, manual_sub={"10": "Narrator", "30": "Dark Sun Gwyndolin"},
              sure=frozenset({"Narrator"}))


def test_hand_named_sub_blocks_take_their_block_from_the_vote():
    pages = {"Gwyn": "The Lord of Sunlight waits in the kiln. The age of fire fades away."}
    talk = {1000: "The Lord of Sunlight waits in the kiln.", 1001: "The age of fire fades away.",
            1002: "The Lord of Sunlight waits in the kiln.", 3000: "Give me, warm. Give me, soft."}
    blocks, subs, hits = vote(talk, pages)
    data = speakers(blocks, subs, RULES)
    assert "0" not in data["blocks"]                      # le bloc 0 a ses sous-blocs nommés : plus de nom à lui
    assert data["sub_blocks"] == {"10": "Narrator", "30": "Dark Sun Gwyndolin"}
    assert data["blocks"]["300"] == "Snuggly the Crow"
    assert data["source"] == "darksouls.fandom.com, pages des personnages de Some Souls, vote par réplique"
    unsure = uncertain(talk, data, hits, RULES)
    assert "Narrator" not in unsure                       # sûr
    assert unsure["Dark Sun Gwyndolin"] == "Named from what the lines say; no source confirms it."
