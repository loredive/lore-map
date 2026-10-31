"""Formats de Dark Souls II (Scholar of the First Sin), sur de petits fichiers fabriqués dans la même
disposition que ceux du jeu : index chiffré en RSA, index BHD5 à entrées de 32 octets, plages AES."""
import struct

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from souls_formats import decrypt_ranges, path_hash, read_bhd5_ds2, rsa_public_decrypt


def rsa_encrypt_like_the_game(plain: bytes, key) -> tuple[bytes, bytes]:
    """Chiffre comme l'éditeur : chaque bloc de 255 octets, précédé d'un zéro, élevé à la puissance privée.
    Rend (fichier chiffré, clé publique PEM)."""
    priv = key.private_numbers()
    n, k = priv.public_numbers.n, 256
    plain += bytes(-len(plain) % (k - 1))
    out = b"".join(pow(int.from_bytes(b"\0" + plain[i:i + k - 1], "big"), priv.d, n).to_bytes(k, "big")
                   for i in range(0, len(plain), k - 1))
    pem = key.public_key().public_bytes(Encoding.PEM, PublicFormat.PKCS1)
    return out, pem


def test_rsa_index_is_read_with_the_public_key_255_bytes_per_block():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    plain = b"BHD5" + bytes(range(256)) * 2
    raw, pem = rsa_encrypt_like_the_game(plain, key)
    assert len(raw) == 3 * 256
    assert rsa_public_decrypt(raw, pem)[:len(plain)] == plain


def make_bhd5_ds2(files):
    """Index BHD5 de Dark Souls II : {chemin: (taille, position, clé AES ou None, plages)}, en deux seaux."""
    buckets = [[], []]
    for path, entry in files.items():
        buckets[path_hash(path) % 2].append((path_hash(path), *entry))
    entries_at = 0x18 + 8 * len(buckets)
    keys_at = entries_at + 32 * len(files)
    head = bytearray(b"BHD5" + b"\xff\x01\0\0" + struct.pack("<iiii", 1, 0, len(buckets), 0x18))
    table, entries, keys, at = bytearray(), bytearray(), bytearray(), entries_at
    for b in buckets:
        table += struct.pack("<ii", len(b), at)
        for h, size, offset, key, ranges in b:
            aes_at = 0
            if key is not None:
                aes_at = keys_at + len(keys)
                keys += key + struct.pack("<i", len(ranges)) + b"".join(struct.pack("<qq", *r) for r in ranges)
            entries += struct.pack("<Iiqqq", h, size, offset, 0, aes_at)
        at += 32 * len(b)
    return bytes(head + table + entries + keys)


def test_bhd5_ds2_lists_size_position_and_aes_key_by_path_hash():
    key = bytes(range(16))
    index = read_bhd5_ds2(make_bhd5_ds2({"/menu/text/english/itemname.fmg": (61952, 4096, None, []),
                                         "/param/x.param": (64, 0, key, [(0, 32), (-1, -1)])}))
    assert index[path_hash("/menu/text/english/itemname.fmg")] == (61952, 4096, None, [])
    assert index[path_hash("/param/x.param")] == (64, 0, key, [(0, 32), (-1, -1)])


def test_only_the_listed_ranges_are_decrypted():
    key, plain = bytes(range(16)), bytes(range(64))
    enc = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    data = enc.update(plain[:32]) + plain[32:]               # seuls les 32 premiers octets chiffrés
    assert decrypt_ranges(data, key, [(0, 32), (-1, -1)]) == plain
    assert decrypt_ranges(plain, None, []) == plain           # pas de clé : le fichier tel quel
