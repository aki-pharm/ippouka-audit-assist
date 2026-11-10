#!/usr/bin/env python3
"""PDF からページごとの本文を取り出す（PyMuPDF）。verify-quotes.cjs が使う。

  python3 -I scripts/pdf-text.py <pdf> <mode>            … 1 文書。ページを \\f で区切って標準出力へ
  python3 -I scripts/pdf-text.py --all <pdf_dir> <txt_dir>  … まとめて。<txt_dir>/<doc_id><mode>.txt に書く（あるものは飛ばす）

mode は pdftotext と同じ名前にしてある：
  -layout … 見た目どおり（左上から右下へ、同じ行の文字をそろえる：get_text(sort=True)）
  -raw    … PDF に書かれた並び順どおり（get_text()）
pdftotext は日本語フォントの辞書（poppler-data）が無いと日本語を出せないが、PyMuPDF は要らない。
"""
import os
import sys

import pymupdf

MODES = ("-layout", "-raw")


def pages(pdf_path, mode):
    doc = pymupdf.open(pdf_path)
    try:
        if mode == "-layout":
            return [pg.get_text("text", sort=True) for pg in doc]
        return [pg.get_text("text") for pg in doc]
    finally:
        doc.close()


def main(argv):
    if len(argv) >= 4 and argv[1] == "--all":
        pdf_dir, txt_dir = argv[2], argv[3]
        os.makedirs(txt_dir, exist_ok=True)
        n = skipped = failed = 0
        for f in sorted(os.listdir(pdf_dir)):
            if not f.endswith(".pdf"):
                continue
            doc_id = f[:-4]
            for mode in MODES:
                out = os.path.join(txt_dir, f"{doc_id}{mode}.txt")
                if os.path.exists(out):
                    skipped += 1
                    continue
                try:
                    txt = "\f".join(pages(os.path.join(pdf_dir, f), mode))
                except Exception as e:  # 壊れた PDF など
                    failed += 1
                    print(f"NG {doc_id} {mode}: {e}", file=sys.stderr)
                    continue
                if txt.strip():  # 空の結果は残さない（取得途中の PDF を空として覚えないため）
                    with open(out, "w", encoding="utf-8") as w:
                        w.write(txt)
                    n += 1
        print(f"書いた {n}、あった {skipped}、失敗 {failed} → {txt_dir}")
        return 0
    if len(argv) == 3 and argv[2] in MODES:
        sys.stdout.write("\f".join(pages(argv[1], argv[2])))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
