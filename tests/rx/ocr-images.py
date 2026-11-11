"""テストセットの画像（data/rx-testset/images/*.png）を tesseract（jpn）で読み、行ごとの文字と色の印を JSON で出す。
tests/rx/images.test.cjs から呼ぶ（品質の検算用。採点には使わない）。

  python3 -I tests/rx/ocr-images.py <images のフォルダ> > out.json

画像の様式（scripts/make-rx-testset.cjs の HTML）に合わせた切り出し：
  Rp 番号の位置は全体の OCR から、薬品名・分量・日数・全量は列ごとに拡大して 1 行で読む。
  □コ は青（#2b6cd4）の画素、「○○も含めて一包化」は緑（#1b8a3a）の画素で見る。
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

COLS = {"name": (95, 690), "amount": (678, 806), "days": (804, 932), "total": (930, 1060)}


def ocr(img, psm, scale=1):
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        name = f.name
    try:
        r = subprocess.run(["tesseract", name, "-", "-l", "jpn", "--psm", str(psm)], capture_output=True, text=True)
        return r.stdout.strip()
    finally:
        os.unlink(name)


def ocr_tsv(img):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        img.save(f.name)
        name = f.name
    try:
        r = subprocess.run(["tesseract", name, "-", "-l", "jpn", "--psm", "6", "tsv"], capture_output=True, text=True)
    finally:
        os.unlink(name)
    rows = []
    for line in r.stdout.splitlines()[1:]:
        p = line.split("\t")
        if len(p) == 12 and p[11].strip():
            rows.append({"left": int(p[6]), "top": int(p[7]), "text": p[11].strip()})
    return rows


def color_mask(a, rgb, tol=45):
    return (np.abs(a[..., 0] - rgb[0]) < tol) & (np.abs(a[..., 1] - rgb[1]) < tol) & (np.abs(a[..., 2] - rgb[2]) < tol)


def page(path):
    img = Image.open(path).convert("RGB")
    a = np.asarray(img).astype(int)
    blue = color_mask(a, (0x2B, 0x6C, 0xD4))
    green = color_mask(a, (0x1B, 0x8A, 0x3A))
    words = ocr_tsv(img)
    rps = sorted({(w["top"], w["text"]) for w in words if w["left"] < 100 and re.fullmatch(r"\d{2}", w["text"]) and w["top"] > 120})
    footer_top = min([w["top"] for w in words if re.search(r"余白|次ページ|One|Dose", w["text"])] or [img.height - 200])
    out = []
    for i, (y, rp) in enumerate(rps):
        nxt = rps[i + 1][0] if i + 1 < len(rps) else footer_top
        band = (y - 12, y + 28)
        cell = {k: ocr(img.crop((x0, band[0], x1, band[1])), 7, 3 if k != "name" else 2) for k, (x0, x1) in COLS.items()}
        usage = ocr(img.crop((COLS["name"][0], y + 26, COLS["name"][1], nxt - 10)), 6, 2)
        out.append({
            "rp": rp, "y": y, **cell, "usage": usage,
            "blue_px": int(blue[y - 15:y + 30, 90:220].sum()),
        })
    top = ocr(img.crop((img.width // 2, 0, img.width, 90)), 7, 3)
    foot = ocr(img.crop((0, footer_top - 15, img.width, footer_top + 45)), 6, 2)
    return {
        "file": os.path.basename(path), "header": top, "text": "".join(w["text"] for w in words), "footer": foot, "rows": out,
        "blue_px_total": int(blue.sum()), "green_px_total": int(green.sum()),
        "fine_print": ocr(img.crop((0, footer_top + 40, img.width, footer_top + 120)), 6),
    }


def main():
    d = sys.argv[1]
    files = sorted(f for f in os.listdir(d) if f.endswith(".png"))
    json.dump([page(os.path.join(d, f)) for f in files], sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
