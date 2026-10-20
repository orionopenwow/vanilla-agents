"""Sealing for browser access (V-054). The same steps run in the browser with WebCrypto (app/web/remote.html), so both sides agree:

    shared  = X25519(this side's private key, the other side's public key)
    key_dir = HKDF-SHA256(shared, salt = pair id bytes, info = "va-remote v1 " + dir + " " + device public key b64url)   dir = "d2p" or "p2d"
    frame   = b64url(nonce 12 random bytes || AES-256-GCM(key_dir, nonce, json bytes, aad = pair id + "|" + device id))

One key per direction, so a nonce can never repeat across the two senders. Pairing proof = HMAC-SHA256(invite secret, device public
key raw || pair id) - the invite secret only travels in the link's address fragment, so the relay cannot fake a device.
This is the one module that needs `cryptography` (allowed for browser access only); without it, browser access says it is missing.
"""
import base64
import hashlib
import hmac
import json
import os

INFO = b"va-remote v1 "


def b64e(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def b64d(s):
    if not isinstance(s, str) or len(s) > 8_000_000:
        raise ValueError("bad base64")
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def available():
    try:
        import cryptography.hazmat.primitives.asymmetric.x25519  # noqa: F401
        return True
    except ImportError:
        return False


def _x():
    from cryptography.hazmat.primitives.asymmetric import x25519
    from cryptography.hazmat.primitives import serialization
    return x25519, serialization


def new_keypair():
    """(private raw 32 bytes, public raw 32 bytes)."""
    x25519, ser = _x()
    sk = x25519.X25519PrivateKey.generate()
    raw = sk.private_bytes(ser.Encoding.Raw, ser.PrivateFormat.Raw, ser.NoEncryption())
    return raw, public_of(raw)


def public_of(sk_raw):
    x25519, ser = _x()
    return x25519.X25519PrivateKey.from_private_bytes(sk_raw).public_key().public_bytes(ser.Encoding.Raw, ser.PublicFormat.Raw)


def device_id(dev_pub_raw):
    """Short public name of a device: the first 16 characters of b64url(sha256(its public key))."""
    return b64e(hashlib.sha256(dev_pub_raw).digest())[:16]


def proof(invite_secret, dev_pub_raw, pair_id):
    return b64e(hmac.new(invite_secret, dev_pub_raw + pair_id.encode("ascii"), hashlib.sha256).digest())


def proof_ok(invite_secret, dev_pub_raw, pair_id, given):
    return isinstance(given, str) and hmac.compare_digest(proof(invite_secret, dev_pub_raw, pair_id), given)


def keys(my_sk_raw, their_pub_raw, pair_id, dev_pub_raw):
    """{'d2p': key, 'p2d': key} for one PC <-> device pair (either side computes the same two)."""
    x25519, _ = _x()
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    shared = x25519.X25519PrivateKey.from_private_bytes(my_sk_raw).exchange(x25519.X25519PublicKey.from_public_bytes(their_pub_raw))
    out = {}
    for d in ("d2p", "p2d"):
        out[d] = HKDF(algorithm=hashes.SHA256(), length=32, salt=pair_id.encode("ascii"), info=INFO + d.encode() + b" " + b64e(dev_pub_raw).encode()).derive(shared)
    return out


def _aad(pair_id, dev):
    return (pair_id + "|" + dev).encode("ascii")


def seal(key, obj, pair_id, dev):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    n = os.urandom(12)
    return b64e(n + AESGCM(key).encrypt(n, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), _aad(pair_id, dev)))


def unseal(key, data, pair_id, dev):
    """The object, or raises ValueError (wrong key, changed bytes, wrong pair/device)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    raw = b64d(data)
    if len(raw) < 12 + 16:
        raise ValueError("frame too short")
    try:
        plain = AESGCM(key).decrypt(raw[:12], raw[12:], _aad(pair_id, dev))
    except InvalidTag:
        raise ValueError("frame does not open with this key") from None
    obj = json.loads(plain.decode("utf-8"))
    if not isinstance(obj, dict):
        raise ValueError("frame is not an object")
    return obj
