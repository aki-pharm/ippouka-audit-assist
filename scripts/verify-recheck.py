#!/usr/bin/env python3
"""照合（verify-quotes）で「目で見る」になった行を、機械で片付くものだけ照合し直す。AI は使わない。

  python3 -I scripts/verify-recheck.py [--model claude-sonnet-5-5|claude-haiku-5-5]

照合の決まり（verify-quotes.cjs）は変えない。次の 3 つだけを足す：
  1. 数字の書き方の揺れ：PDF によっては「約1 9 . 2 m m」のように 1 字ずつ空白が入る。数字・小数点の間の空白を詰めてから探す
  2. 別のページ：値が根拠のページに無く別のページにあるとき、そのページに製品名（または規格）もあれば、そのページの値として認める
  3. 形が空：根拠のページ（無ければ全ページ）の、製品名のあとの性状の文から「円形・楕円形・長円形…」を拾う

入力：data/parent/verify/[<model>/]quote-check.csv、pdfs/parent-txt-mupdf/<doc_id>-layout.txt（scripts/pdf-text.py で作る本文）、data/parent/parent-master.json
出力：data/parent/verify/[<model>/]recheck.csv（行ごとに：片付いた理由と残った理由、拾った形）
"""
import csv, json, os, re, sys, unicodedata

MODEL = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "claude-sonnet-5-5"
VDIR = "data/parent/verify" if MODEL == "claude-sonnet-5-5" else f"data/parent/verify/{MODEL}"
TXT = "pdfs/parent-txt-mupdf"

def nfkc(s): return unicodedata.normalize("NFKC", s or "")
def squash_digits(t):
    t = nfkc(t)
    t = re.sub(r"(?<=[\d.．])[ \t　]+(?=[\d.．])", "", t)  # 1 9 . 2 → 19.2
    return t.replace("．", ".")
def norm_name(s): return re.sub(r"[\s・･®（）()「」]", "", nfkc(s)).lower()

_pages = {}
def pages(doc_id):
    if doc_id not in _pages:
        f = os.path.join(TXT, f"{doc_id}-layout.txt")
        _pages[doc_id] = [squash_digits(p) for p in open(f, encoding="utf-8").read().split("\f")] if os.path.exists(f) else None
    return _pages[doc_id]

def has_num(text, v):
    if v in ("", None): return False
    try: x = float(v)
    except ValueError: return False
    forms = {f"{x:g}", f"{x:.1f}", f"{x:.2f}"} if x != int(x) else {f"{int(x)}", f"{x:.1f}"}
    return any(re.search(rf"(?<![\d.]){re.escape(f)}(?!\d|\.\d)", text) for f in forms)

def name_keys(name, strength):
    """ページに製品が出てくるかを見る鍵：販売名（空白などを除く）と、販売名から「錠」の前までの名前＋規格の数字"""
    n = norm_name(name); keys = [n]
    m = re.match(r"(.+?)(od錠|錠|カプセル)", n)
    if m: keys.append(m.group(1))
    s = re.search(r"\d+(\.\d+)?", nfkc(strength or ""))
    return keys, (s.group(0) if s else "")
def page_has_product(text, name, strength):
    t = norm_name(text); keys, s = name_keys(name, strength)
    return any(k and k in t for k in keys) or (s and re.search(rf"(?<![\d.]){re.escape(s)}(?!\d)", nfkc(text)) and keys[-1][:3] in t)

SHAPES = [("だ円形", "oval"), ("楕円形", "oval"), ("長円形", "oblong"), ("円形", "round"), ("四角形", "other"), ("三角形", "other"), ("五角形", "other"), ("六角形", "other"), ("菱形", "other"), ("ひし形", "other")]
def find_shape(texts, name):
    keys, _ = name_keys(name, "")
    for t in texts:
        flat = nfkc(t).replace("\n", "")
        tn = norm_name(flat)
        pos = next((tn.find(k) for k in keys if k and k in tn), -1)
        win = flat if pos < 0 else flat[max(0, pos - 50): pos + 400]
        for jp, en in SHAPES:
            if jp in win: return jp, en
    return "", ""

LABEL = {"long": "長径", "short": "短径", "thick": "厚さ"}
COL = {"long": ("size_long_mm", "long_in_text"), "short": ("size_short_mm", "short_in_text"), "thick": ("thickness_mm", "thick_in_text")}

def main():
    pm = {}
    for p in json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]: pm.setdefault(norm_name(p["brand_name"]), p)
    rows = list(csv.DictReader(open(os.path.join(VDIR, "quote-check.csv"), encoding="utf-8-sig")))
    out = []
    for r in rows:
        if not r["priority"]: continue
        reasons = [x for x in r["review_reason"].split("；") if x]
        pg = pages(r["doc_id"])
        fixed, left, shape_jp, shape_en = [], [], "", ""
        if pg is None:
            out.append({**{k: r[k] for k in ("yj", "product_name", "strength", "doc_id", "source_page")}, "片付いた": "", "残った": "；".join(reasons), "拾った形": "", "url": r["url"]}); continue
        sp = int(r["source_page"] or 1) if str(r["source_page"]).isdigit() else 1
        src = pg[sp - 1] if 0 < sp <= len(pg) else ""
        for x in reasons:
            k = next((k for k, lab in LABEL.items() if x.startswith(lab)), None)
            if k:
                v = r[COL[k][0]]
                if has_num(src, v): fixed.append(f"{x} → 根拠のページにある（数字の空白を詰めて照合）"); continue
                hit = [i + 1 for i, t in enumerate(pg) if has_num(t, v) and page_has_product(t, r["product_name"], r["strength"])]
                if hit: fixed.append(f"{x} → p.{hit[0]} に製品名と一緒にある"); continue
                left.append(x); continue
            if x.startswith("刻印（表）が別のページ") or x.startswith("刻印（裏）が別のページ"):
                v = r["imprint_front"] if "表" in x else r["imprint_back"]
                vv = re.sub(r"\s", "", nfkc(v))
                hit = [i + 1 for i, t in enumerate(pg) if vv and vv in re.sub(r"\s", "", t) and page_has_product(t, r["product_name"], r["strength"])]
                if hit: fixed.append(f"{x} → p.{hit[0]} に製品名と一緒にある"); continue
                left.append(x); continue
            left.append(x)
        p = pm.get(norm_name(r["product_name"]))
        if p is not None and not p["shape"]:
            shape_jp, shape_en = find_shape([src] + pg, r["product_name"])
        out.append({**{k: r[k] for k in ("yj", "product_name", "strength", "doc_id", "source_page")},
                    "片付いた": "；".join(fixed), "残った": "；".join(left), "拾った形": f"{shape_jp}（{shape_en}）" if shape_jp else "", "url": r["url"]})
    cols = ["yj", "product_name", "strength", "doc_id", "source_page", "片付いた", "残った", "拾った形", "url"]
    with open(os.path.join(VDIR, "recheck.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(out)
    done = sum(1 for r in out if not r["残った"])
    print(f"{MODEL}：目で見る {len(out)} 行 → すべて片付いた {done}、一部片付いた {sum(1 for r in out if r['片付いた'] and r['残った'])}、形を拾えた {sum(1 for r in out if r['拾った形'])} → {VDIR}/recheck.csv")

if __name__ == "__main__":
    main()
