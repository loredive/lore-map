from entities import find_mentions


def doc(name, text=""):
    return {"name": name, "text": text}


def ent(name, *aliases):
    return {"name": name, "kind": "personnage", "aliases": list(aliases)}


def test_mentions_match_whole_words_including_possessives():
    docs = [doc("Fia — passage 3", "Godwyn's rest, and Godwyn the Golden."),
            doc("Mohgwyn Palace", "A palace of blood."),
            doc("Mohg's Great Rune", "Wishing to raise a dynasty.")]
    found = find_mentions([ent("Godwyn"), ent("Mohg")], docs)
    assert found == {"Godwyn": [0], "Mohg": [2]}


def test_names_and_aliases_both_count():
    docs = [doc("Leyndell Knight Greaves", "Sworn to defend the capital."),
            doc("Map", "The Royal Capital lies beyond."),
            doc("Roads", "No capital here.")]
    found = find_mentions([ent("Leyndell", "Royal Capital")], docs)
    assert found == {"Leyndell": [0, 1]}


def test_matching_is_case_sensitive():
    docs = [doc("A", "Destined Death was stolen."), doc("B", "Death by poisoning, then death again.")]
    found = find_mentions([ent("Destined Death"), ent("Death")], docs)
    assert found == {"Destined Death": [0], "Death": [0, 1]}
    docs = [doc("C", "a slow death")]
    assert find_mentions([ent("Death")], docs) == {"Death": []}


def test_excluded_phrases_do_not_count_as_mentions():
    torrent = {"name": "Torrent", "kind": "personnage", "aliases": [], "exclude": ["Crystal Torrent"]}
    docs = [doc("Crystal Torrent", "Sorcery of the Crystalians."),
            doc("Spectral Steed Whistle", "Summon and ride Torrent."),
            doc("Notes", "A Crystal Torrent, then Torrent arrives.")]
    assert find_mentions([torrent], docs) == {"Torrent": [1, 2]}
