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


def test_texts_naming_the_entity_often_in_their_body_rank_first():
    from entities import rank_mentions
    docs = [doc("Godwyn's Helm", "A helm."),                              # titre seulement
            doc("Note", "Godwyn fell. Godwyn the Golden was mourned."),  # deux fois dans le texte
            doc("Rumour", "They say Godwyn died first.")]                # une fois
    ranked = rank_mentions([ent("Godwyn")], docs)["Godwyn"]
    assert [i for i, _ in ranked] == [1, 2, 0]


def test_body_only_entities_ignore_mentions_in_titles():
    from entities import rank_mentions
    erdtree = {"name": "Erdtree", "kind": "notion", "aliases": [], "body_only": True}
    docs = [doc("Erdtree Greatshield", "A golden shield."), doc("Lore", "The Erdtree burns.")]
    assert [i for i, _ in rank_mentions([erdtree], docs)["Erdtree"]] == [1]
    assert find_mentions([erdtree], docs) == {"Erdtree": [1]}


def test_related_entities_favour_specific_co_mentions_and_skip_broad_ones():
    from entities import related_entities
    found = {"Godwyn": [1, 2, 3, 4], "Fia": [1, 2, 3, 9], "Erdtree": [1, 2, 3, 4, 5, 6, 7, 8],
             "Ranni": [3, 10, 11, 12]}
    entities = [ent("Godwyn"), ent("Fia"), ent("Ranni"),
                {"name": "Erdtree", "kind": "notion", "aliases": [], "broad": True}]
    rel = related_entities(entities, found, min_shared=2)
    assert rel["Godwyn"] == [("Fia", 3)]        # Ranni ne partage qu'un texte, Erdtree est trop large
    assert rel["Erdtree"] == []
