r"""Make the Windows .ico for the Desktop shortcut and the taskbar (PNGs embedded as they are; Windows Vista and later accept that).
Usage: python scripts/make_icon.py [png] [ico]
Default: the Vanilla Agents book (app/web/icons/vanilla-agents-*.png, 16-256 px, all in one .ico) -> ~\.vanilla-agents\assets\vanilla-agents.ico.
With a png: just that picture (the old way, e.g. a baked game icon)."""
import struct
import sys

import os

ASSETS = os.path.expanduser(os.path.join("~", ".vanilla-agents", "assets"))
SRC = os.path.join(ASSETS, "interface", "icons", "inv_misc_gear_01.png")
DST = os.path.join(ASSETS, "vanilla-agents.ico")
ICONS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "web", "icons")
SIZES = (16, 32, 48, 64, 128, 256)


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    return struct.unpack(">II", data[16:24])


def png_to_ico(data):
    return pngs_to_ico([data])


def pngs_to_ico(pngs):
    """One .ico holding every PNG (smallest first), so Windows picks the sharp one for each place it shows the icon."""
    head, body, offset = [], b"", 6 + 16 * len(pngs)
    for data in pngs:
        w, h = png_size(data)
        if w > 256 or h > 256:
            raise ValueError("icon larger than 256x256")
        head.append(struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(data), offset + len(body)))
        body += data
    return struct.pack("<HHH", 0, 1, len(pngs)) + b"".join(head) + body


def book_pngs(folder=ICONS):
    out = []
    for n in SIZES:
        p = os.path.join(folder, "vanilla-agents-%d.png" % n)
        if os.path.exists(p):
            with open(p, "rb") as f:
                out.append(f.read())
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1:
        src, dst = (sys.argv[1:3] + [SRC, DST][len(sys.argv[1:3]):])[:2]
        with open(src, "rb") as f:
            ico = png_to_ico(f.read())
    else:
        dst, pngs = DST, book_pngs()
        if not pngs:
            with open(SRC, "rb") as f:
                pngs = [f.read()]
        ico = pngs_to_ico(pngs)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(ico)
    print("wrote", dst)
