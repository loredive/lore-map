"""
Archives des jeux FromSoftware : DCX « DFLT » (zlib), conteneurs BND4 et BND3, index BHD5 des archives
dvdbnd de Dark Souls (fichiers listés par le hash de leur chemin), et l'index chiffré de Dark Souls II
(RSA avec la clé publique livrée par le jeu, puis des plages chiffrées en AES).
"""
import struct
import zlib


def read_dcx(raw: bytes) -> bytes:
    """DCX « DFLT » : en-tête de 0x4C octets puis un flux zlib."""
    if raw[:4] != b"DCX\0" or raw[0x28:0x2C] != b"DFLT":
        raise ValueError("DCX DFLT attendu")
    size, = struct.unpack_from(">I", raw, 0x1C)
    data = zlib.decompress(raw[0x4C:])
    if len(data) != size:
        raise ValueError(f"DCX : {len(data)} octets décompressés, {size} annoncés")
    return data


def read_bnd4(data: bytes) -> dict[str, bytes]:
    """BND4 (petit-boutiste) : {nom de fichier sans chemin: contenu}. Noms en UTF-16, ou en Shift-JIS
    si l'octet 0x30 est nul ; entrées de 0x24 octets (taille, position, identifiant, nom), ou de 0x18
    sans identifiant (paramètres de Dark Souls II)."""
    if data[:4] != b"BND4":
        raise ValueError("BND4 attendu")
    count, = struct.unpack_from("<i", data, 0x0C)
    entry_size, = struct.unpack_from("<q", data, 0x20)
    unicode = data[0x30] != 0
    files = {}
    for k in range(count):
        o = 0x40 + k * entry_size
        size, = struct.unpack_from("<q", data, o + 8)
        if entry_size == 0x18:
            offset, name_at = struct.unpack_from("<II", data, o + 16)
        else:
            offset, _id, name_at = struct.unpack_from("<Iii", data, o + 24)
        name = utf16_at(data, name_at) if unicode else data[name_at:data.index(b"\0", name_at)].decode("shift_jis")
        files[name.split("\\")[-1]] = data[offset:offset + size]
    return files


def read_bnd3(data: bytes) -> dict[str, bytes]:
    """BND3 au format 0x74 (Dark Souls ; noms Shift-JIS) : {nom de fichier sans chemin: contenu}."""
    if data[:4] != b"BND3" or data[0x0C] != 0x74:
        raise ValueError("BND3 au format 0x74 attendu")
    count, = struct.unpack_from("<i", data, 0x10)
    files = {}
    for k in range(count):
        size, offset, _id, name_at = struct.unpack_from("<IIiI", data, 0x20 + 0x18 * k + 4)
        name = data[name_at:data.index(b"\0", name_at)].decode("shift_jis")
        files[name.split("\\")[-1]] = data[offset:offset + size]
    return files


def path_hash(path: str) -> int:
    """Hash d'un chemin dans l'index BHD5 de Dark Souls : h = h * 37 + caractère, en minuscules."""
    h = 0
    for c in path.lower().replace("\\", "/"):
        h = (h * 37 + ord(c)) & 0xFFFFFFFF
    return h


def read_bhd5(b: bytes) -> dict[int, tuple[int, int]]:
    """Index BHD5 d'une archive dvdbnd<n>.bdt (Dark Souls, non chiffré) : {hash du chemin: (taille, position)}."""
    if b[:4] != b"BHD5":
        raise ValueError("BHD5 attendu")
    buckets, at = struct.unpack_from("<ii", b, 0x10)
    out = {}
    for k in range(buckets):
        count, entries_at = struct.unpack_from("<ii", b, at + 8 * k)
        for j in range(count):
            h, size, offset, _ = struct.unpack_from("<IIII", b, entries_at + 16 * j)
            out[h] = (size, offset)
    return out


def rsa_public_decrypt(raw: bytes, pem: bytes) -> bytes:
    """Index chiffré de Dark Souls II (GameDataEbl.bhd) : RSA « nu » avec la clé publique livrée à côté
    (GameDataKeyCode.pem), par blocs de la taille de la clé ; chaque bloc rend un octet de moins."""
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    key = load_pem_public_key(pem).public_numbers()
    k = (key.n.bit_length() + 7) // 8
    return b"".join(pow(int.from_bytes(raw[i:i + k], "big"), key.e, key.n).to_bytes(k, "big")[1:]
                    for i in range(0, len(raw), k))


def read_bhd5_ds2(b: bytes) -> dict[int, tuple[int, int, bytes | None, list[tuple[int, int]]]]:
    """Index BHD5 de Dark Souls II, déchiffré : {hash du chemin: (taille, position, clé AES ou None,
    plages chiffrées)}. Entrées de 32 octets : hash, taille, position, SHA, clé AES (positions sur 64 bits)."""
    if b[:4] != b"BHD5":
        raise ValueError("BHD5 attendu")
    buckets, at = struct.unpack_from("<ii", b, 0x10)
    out = {}
    for k in range(buckets):
        count, entries_at = struct.unpack_from("<ii", b, at + 8 * k)
        for j in range(count):
            h, size, offset, _sha, aes_at = struct.unpack_from("<Iiqqq", b, entries_at + 32 * j)
            key, ranges = None, []
            if aes_at:
                key = b[aes_at:aes_at + 16]
                n, = struct.unpack_from("<i", b, aes_at + 16)
                ranges = [struct.unpack_from("<qq", b, aes_at + 20 + 16 * r) for r in range(n)]
            out[h] = (size, offset, key, ranges)
    return out


def decrypt_ranges(data: bytes, key: bytes | None, ranges: list[tuple[int, int]]) -> bytes:
    """Un fichier d'une archive de Dark Souls II : seules les plages listées sont chiffrées (AES-128-ECB) ;
    une plage (-1, -1) n'est pas chiffrée."""
    if key is None:
        return data
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    out = bytearray(data)
    dec = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    for start, end in ranges:
        if start != -1 and end > start:
            out[start:end] = dec.update(data[start:end])
    return bytes(out)


def utf16_at(b: bytes, at: int) -> str:
    end = at
    while b[end:end + 2] != b"\0\0":
        end += 2
    return b[at:end].decode("utf-16-le")
