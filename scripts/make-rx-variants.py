"""
処方箋テストセットの画像を、印刷・撮影せずに「撮影で起こりがちな崩れ」に加工する（読み取りの強さを測るため）。

  python3 scripts/make-rx-variants.py                         既定：data/rx-testset/images → captures/rx-testset/variants
  python3 scripts/make-rx-variants.py --in <dir> --out <dir>  入出力を変える
  python3 scripts/make-rx-variants.py --only rotp8,blur        加工を選ぶ

必要なもの：Python 3 と Pillow（PIL）、numpy。乱数は画像ごとに固定（何度作っても同じ画像になる）。
出力のファイル名は撮影写真と同じ決まり（docs/rx-testset.md）：
  rx07-1__gen__pil__rotp8.jpg  ＝ 処方 rx07 の 1 ページ目、撮影者 gen（生成）、機器 pil、条件 rotp8
加工しない元画像も clean として同じフォルダに置く（ランナーにフォルダを 1 つ渡せば全部読めるように）。
出力は長辺 1600px 以下（アプリがブラウザで縮小する上限と同じ）。

加工の一覧（条件名：中身）
  clean   ：加工なし（PNG のまま）
  rotp8   ：時計回りに 8°回転（余白は机の色）
  rotm8   ：反時計回りに 8°回転
  skew    ：斜めから撮った台形のゆがみ（上辺を 12% 狭める＋左右非対称）
  dark    ：暗い部屋（明るさ 50%、コントラスト 80%、少し黄色み）
  blur    ：ピンぼけ（ガウスぼかし 半径 2.5px）
  jpeg15  ：JPEG 画質 15（ブロックノイズ）
  crop    ：はみ出し（右 10%・上 3% が写っていない。右端は「全量」の列で、採点する項目は残る）
  glare   ：照明の反射（紙を少し灰色にして、白い楕円のてかりで文字を薄くする。場所は上半分で画像ごとに乱数）
  phone   ：ふつうのスマホ撮影の合わせ技（3°回転＋弱い台形＋机の余白＋弱いぼかし＋縮小＋JPEG 70）
"""
import argparse
import hashlib
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

MAX_SIDE = 1600
DESK = (120, 110, 100)  # 机の色（回転・台形で出る余白）
VARIANTS = ["clean", "rotp8", "rotm8", "skew", "dark", "blur", "jpeg15", "crop", "glare", "phone"]


def rng_for(name, variant):
    seed = int(hashlib.sha1(f"{name}|{variant}".encode()).hexdigest()[:8], 16)
    return random.Random(seed)


def fit(img):
    w, h = img.size
    s = min(1.0, MAX_SIDE / max(w, h))
    if s < 1.0:
        img = img.resize((round(w * s), round(h * s)), Image.LANCZOS)
    return img


def perspective_coeffs(src, dst):
    """dst の 4 点 → src の 4 点 へ写す射影変換の係数（PIL の Image.transform 用）"""
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


def skew(img, top_shrink=0.12, asym=0.04, margin=0.06):
    w, h = img.size
    W, H = int(w * (1 + 2 * margin)), int(h * (1 + margin))
    canvas = Image.new("RGB", (W, H), DESK)
    ox, oy = int(w * margin), int(h * margin / 2)
    # 元画像の 4 隅（左上・右上・右下・左下）を、台形の 4 隅へ
    dst = [
        (ox + w * (top_shrink / 2 + asym), oy),
        (ox + w * (1 - top_shrink / 2 + asym), oy + h * 0.01),
        (ox + w, oy + h),
        (ox, oy + h),
    ]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = perspective_coeffs(src, dst)
    warped = img.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=DESK)
    mask = Image.new("L", img.size, 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=0)
    canvas.paste(warped, (0, 0), mask)
    return canvas


def glare(img, r):
    w, h = img.size
    cx, cy = r.uniform(0.25, 0.75) * w, r.uniform(0.12, 0.5) * h  # 文字のある上半分に当てる
    rx, ry = r.uniform(0.18, 0.28) * w, r.uniform(0.08, 0.14) * h
    yy, xx = np.mgrid[0:h, 0:w]
    d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    alpha = np.clip(1.2 - d, 0, 1) ** 1.2 * 0.95  # 中心ほど白く飛ぶ
    a = np.asarray(img, dtype=float) * 0.82  # 写真の紙は真っ白ではない（てかりが見えるように少し灰色に）
    out = a * (1 - alpha[..., None]) + 255 * alpha[..., None]
    return Image.fromarray(out.astype(np.uint8))


def apply(variant, img, r):
    """（加工した画像, 保存形式, JPEG 画質）を返す"""
    if variant == "clean":
        return img, "png", None
    if variant == "rotp8":
        return img.rotate(-8, resample=Image.BICUBIC, expand=True, fillcolor=DESK), "jpg", 90
    if variant == "rotm8":
        return img.rotate(8, resample=Image.BICUBIC, expand=True, fillcolor=DESK), "jpg", 90
    if variant == "skew":
        return skew(img), "jpg", 90
    if variant == "dark":
        x = ImageEnhance.Brightness(img).enhance(0.5)
        x = ImageEnhance.Contrast(x).enhance(0.8)
        a = np.asarray(x, dtype=float) * np.array([1.0, 0.96, 0.82])
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), "jpg", 90
    if variant == "blur":
        return img.filter(ImageFilter.GaussianBlur(2.5)), "jpg", 90
    if variant == "jpeg15":
        return img, "jpg", 15
    if variant == "crop":
        w, h = img.size
        return img.crop((0, int(h * 0.03), int(w * 0.90), h)), "jpg", 90
    if variant == "glare":
        return glare(img, r), "jpg", 90
    if variant == "phone":
        x = skew(img, top_shrink=0.05, asym=0.015, margin=0.05)
        x = x.rotate(r.uniform(2.0, 3.5) * r.choice([-1, 1]), resample=Image.BICUBIC, expand=True, fillcolor=DESK)
        x = x.filter(ImageFilter.GaussianBlur(0.8))
        x = x.resize((int(x.width * 0.85), int(x.height * 0.85)), Image.LANCZOS)
        return x, "jpg", 70
    raise ValueError(f"知らない加工: {variant}")


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default=os.path.join(root, "data/rx-testset/images"))
    ap.add_argument("--out", default=os.path.join(root, "captures/rx-testset/variants"))
    ap.add_argument("--only", default=",".join(VARIANTS), help="作る加工（カンマ区切り）")
    args = ap.parse_args()
    variants = [v for v in args.only.split(",") if v]
    for v in variants:
        if v not in VARIANTS:
            sys.exit(f"知らない加工: {v}（使えるのは {', '.join(VARIANTS)}）")
    os.makedirs(args.out, exist_ok=True)
    files = sorted(f for f in os.listdir(args.src) if f.lower().endswith(".png"))
    if not files:
        sys.exit(f"画像がない: {args.src}")
    n = 0
    for f in files:
        stem = os.path.splitext(f)[0]  # rx07-1
        img = Image.open(os.path.join(args.src, f)).convert("RGB")
        for v in variants:
            out, fmt, q = apply(v, img, rng_for(stem, v))
            out = fit(out)
            path = os.path.join(args.out, f"{stem}__gen__pil__{v}.{fmt}")
            if fmt == "png":
                out.save(path, optimize=True)
            else:
                out.save(path, quality=q)
            n += 1
    print(f"元画像 {len(files)} 枚 × 加工 {len(variants)} 種 = {n} 枚 → {args.out}")


if __name__ == "__main__":
    main()
