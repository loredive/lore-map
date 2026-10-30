"""Découpe des dialogues en passages (prepare.dialog_docs)."""
from types import SimpleNamespace

from prepare import dialog_docs

GAME = SimpleNamespace(speaker_names={}, text_lang="en", alt_lang=None, junk=(), min_chars=1,
                       dialog_label="Dialogue")


def record(name, lines):
    """Un dialogue du dump : une conversation par bloc de mille identifiants."""
    info = "<br/><br/>".join(f"[{1000 * k}] {t}" for k, t in enumerate(lines))
    return {"name_en": f"{name} dialog", "info_en": info}


def test_passages_of_a_speaker_are_numbered_across_its_dialogue_files():
    # deux fichiers du dump pour un même interlocuteur : la numérotation ne repart pas de 1
    data = {"dialog": {"a": record("Rennala", ["Come, sweetings.", "Where did ye flee?"]),
                       "b": record("Melina", ["Hello."]),
                       "c": record("Rennala", ["Who's that?"])}}
    docs = dialog_docs(data, GAME)
    assert [d["name"] for d in docs] == ["Rennala — passage 1", "Rennala — passage 2",
                                         "Melina — passage 1", "Rennala — passage 3"]


def test_embedding_names_keep_the_numbering_of_each_file():
    # les embeddings ne bougent pas : la carte reste où elle est
    data = {"dialog": {"a": record("Rennala", ["Come, sweetings."]),
                       "c": record("Rennala", ["Who's that?"])}}
    assert [d["embed_name"] for d in dialog_docs(data, GAME)] == ["Rennala — passage 1",
                                                                  "Rennala — passage 1"]
