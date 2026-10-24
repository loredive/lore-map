from labels import match_titles


def entry(title, members):
    return {"title": title, "description": "", "members": members}


def test_title_follows_its_members_when_cluster_ids_change():
    pots = entry("Pots à lancer", ["Fire Pot", "Poison Pot", "Oil Pot", "Magic Pot"])
    arrows = entry("Flèches en os", ["Bone Arrow", "Firebone Arrow", "Coldbone Arrow"])
    # Les mêmes groupes, recalculés avec d'autres identifiants
    clusters = {
        7: {"Bone Arrow", "Firebone Arrow", "Coldbone Arrow", "Rotbone Arrow"},
        2: {"Fire Pot", "Poison Pot", "Oil Pot", "Magic Pot", "Cracked Pot"},
    }
    matched, stale = match_titles([pots, arrows], clusters)
    assert matched == {2: pots, 7: arrows}
    assert stale == []


def test_title_is_stale_when_its_group_has_dissolved():
    # 1 seul des 4 textes de « Pots à lancer » reste ensemble : le titre ne vaut plus
    pots = entry("Pots à lancer", ["Fire Pot", "Poison Pot", "Oil Pot", "Magic Pot"])
    clusters = {0: {"Fire Pot", "Herba", "Cave Moss"}, 1: {"Longsword", "Estoc"}}
    matched, stale = match_titles([pots], clusters)
    assert matched == {}
    assert stale == [pots]


def test_merged_cluster_keeps_the_best_covered_title_only():
    bolts = entry("Carreaux", ["Bone Bolt", "Fire Bolt", "Ice Bolt", "Rot Bolt"])
    arrows = entry("Flèches en os", ["Bone Arrow", "Fire Arrow", "Ice Arrow", "Rot Arrow"])
    # Les deux groupes ont fusionné ; tous les carreaux, 3 flèches sur 4
    clusters = {5: {"Bone Bolt", "Fire Bolt", "Ice Bolt", "Rot Bolt",
                    "Bone Arrow", "Fire Arrow", "Ice Arrow"},
                6: {"Longsword", "Rot Arrow"}}
    matched, stale = match_titles([arrows, bolts], clusters)
    assert matched == {5: bolts}
    assert stale == [arrows]


def test_title_without_members_is_stale_instead_of_crashing():
    orphan = entry("Sans membres", [])
    matched, stale = match_titles([orphan], {0: {"Herba"}})
    assert matched == {}
    assert stale == [orphan]
