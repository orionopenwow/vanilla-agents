import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
from make_icon import book_pngs, png_size, png_to_ico, pngs_to_ico   # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 64, 64) + b"\x08\x06\x00\x00\x00" + b"\0" * 8


class IconTests(unittest.TestCase):
    def test_ico_wraps_png(self):
        ico = png_to_ico(PNG)
        self.assertEqual(struct.unpack("<HHH", ico[:6]), (0, 1, 1))
        self.assertEqual(ico[22:], PNG)
        self.assertEqual(struct.unpack("<II", ico[14:22]), (len(PNG), 22))

    def test_the_book_icon_holds_every_size(self):
        pngs = book_pngs()
        self.assertEqual([png_size(p)[0] for p in pngs], [16, 32, 48, 64, 128, 256])
        ico = pngs_to_ico(pngs)
        self.assertEqual(struct.unpack("<HHH", ico[:6]), (0, 1, 6))
        for i, p in enumerate(pngs):          # each directory entry points at its own PNG
            size, off = struct.unpack("<II", ico[6 + 16 * i + 8:6 + 16 * i + 16])
            self.assertEqual(ico[off:off + size], p)

    def test_rejects_non_png(self):
        with self.assertRaises(ValueError):
            png_size(b"nope" * 10)


if __name__ == "__main__":
    unittest.main()
