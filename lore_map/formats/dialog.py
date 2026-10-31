"""
Dialogues par interlocuteur. Les répliques (会話.fmg) sont rangées par blocs d'identifiants, un par
personnage, sans nom : speakers.json (propre à chaque jeu) nomme les blocs, et dialog() écrit les
répliques dans la forme du dump d'Elden Ring, que lit prepare.py.
"""
SUBTITLES_SPEAKER = "Cutscenes"
GENDER_OFFSET = 50                 # réplique adressée à une chasseuse : celle d'un chasseur + 50
GENDER_WORDS = 3                   # au plus autant de mots changés entre une réplique et sa jumelle (him/her…)


def speaker_for(i: int, speakers: dict) -> str | None:
    """Nom de l'interlocuteur d'une réplique : un sous-bloc de 100 identifiants l'emporte sur
    son bloc de 10 000 (dans les blocs du DLC, plusieurs personnages se partagent un bloc)."""
    return speakers["sub_blocks"].get(str(i // 100)) or speakers["blocks"].get(str(i // 10000))


def drop_repeated_runs(ids: list[int], tables: dict) -> list[int]:
    """Le jeu range certaines conversations plusieurs fois (une par situation) : une suite d'au
    moins deux répliques déjà dites par le même personnage est retirée ; une réplique isolée
    déjà dite (« Oh... ») reste à sa place. Comparées dans la langue affichée (l'anglais)."""
    def text(i):
        return tables["en"]["会話"][i]
    seen, repeat = set(), []
    for i in ids:
        repeat.append(text(i) in seen)
        seen.add(text(i))
    return [i for k, i in enumerate(ids)
            if not (repeat[k] and ((k > 0 and repeat[k - 1]) or (k + 1 < len(ids) and repeat[k + 1])))]


def gender_twin(first: str | None, other: str) -> bool:
    """La réplique +50 n'est que la variante de la première pour l'autre genre : même nombre de mots,
    au plus GENDER_WORDS changés (« himself » / « herself »). Sinon, c'est une autre réplique."""
    if first is None:
        return False
    a, b = first.split(), other.split()
    return len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= GENDER_WORDS


def dialog(tables: dict, speakers: dict, new=lambda table, i: False,
           twin=lambda first, other: first is not None) -> dict:
    """Répliques regroupées par interlocuteur, au format du dump d'Elden Ring
    (« [id] texte<br/><br/>[id] texte », info_en, info_fr…), que dialog_docs de prepare.py découpe
    en passages. L'interlocuteur se lit sur les identifiants anglais, les mêmes dans chaque langue."""
    by_speaker: dict[str, list[int]] = {}
    talk = tables["en"]["会話"]
    for i in sorted(talk):
        # chaque réplique existe pour un chasseur (…00–…49) et pour une chasseuse (+50) : en
        # français, « le nouveau chasseur » / « la nouvelle chasseuse » ; on garde la première
        # twin(première, +50) : par défaut (Bloodborne), toute réplique +50 dont la première existe ;
        # gender_twin, plus stricte, ne retire que celles qui n'en diffèrent que par quelques mots
        if i % 100 >= GENDER_OFFSET and twin(talk.get(i - GENDER_OFFSET), talk[i]):
            continue
        ids = by_speaker.setdefault(speaker_for(i, speakers) or speakers["unknown"], [])
        if not ids or talk[ids[-1]] != talk[i]:      # la même réplique enregistrée deux fois de suite
            ids.append(i)
    by_speaker = {name: drop_repeated_runs(ids, tables) for name, ids in by_speaker.items()}
    by_speaker[SUBTITLES_SPEAKER] = sorted(tables["en"]["ムービー字幕"])
    out = {}
    for name, ids in by_speaker.items():
        table = "ムービー字幕" if name == SUBTITLES_SPEAKER else "会話"
        out[name] = {"name_en": f"{name} dialog",
                     **{f"info_{lang}": "<br/><br/>".join(f"[{i}] {tables[lang][table][i]}"
                                                       for i in ids if i in tables[lang][table])
                        for lang in tables}}
        dlc = [i for i in ids if new(table, i)]
        if dlc:
            out[name]["dlc_lines"] = dlc
    return out
