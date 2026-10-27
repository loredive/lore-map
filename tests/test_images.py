from images import match, norm


def index(*names):
    return {norm(n): f"https://example/{n}.png" for n in names}


ITEMS = index("Crimson Amber Medallion", "Ash Of War: Torch Attack", "Rivers of Blood")
NPCS = index("Ranni the Witch")


def test_exact_name_matches_whatever_the_case_and_punctuation():
    assert match("Rivers of Blood", "Weapons", ITEMS, NPCS) == norm("Rivers of Blood")


def test_upgraded_talisman_uses_its_base_icon():
    assert match("Crimson Amber Medallion +2", "Talismans", ITEMS, NPCS) == norm("Crimson Amber Medallion")


def test_skill_reuses_the_icon_of_its_ash_of_war():
    assert match("Torch Attack", "Skills", ITEMS, NPCS) == norm("Ash of War: Torch Attack")
    assert match("Ash of War: Torch Attack", "Ashes of War", ITEMS, NPCS) == norm("Ash of War: Torch Attack")


def test_dialogue_passage_gets_its_speaker_portrait():
    assert match("Ranni the Witch — passage 20", "Dialogue", ITEMS, NPCS) == norm("Ranni the Witch")


def test_no_guess_when_nothing_matches():
    assert match("Crouching", "Loading Screens", ITEMS, NPCS) is None
    assert match("Narrator — passage 1", "Dialogue", ITEMS, NPCS) is None
    # un dialogue ne prend pas l'icône d'un objet homonyme, ni un objet le portrait d'un PNJ
    assert match("Rivers of Blood — passage 1", "Dialogue", ITEMS, NPCS) is None
    assert match("Ranni the Witch", "Items", ITEMS, NPCS) is None
