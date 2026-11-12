# AKI が手書きで足した採用品（写真に写っていなかった品目）を親マスタの製品につなぐ。commit しない出力のみ。
#   python3 scripts/ops/link-handwritten.py
# 入力：data/private/handwritten-raw.txt（1 行 1 品目。AKI の書き方のまま：「成分か販売名＋規格（＋メーカー）」）
#       data/private/handwritten-answers.csv（任意。候補が複数の品目に AKI が選んだ製品：列 手書き,選んだ製品（販売名））
# 出力（data/private/）：
#   handwritten-additions.csv … 1 行 1 品目：区分（1 つに決まった／候補が複数／親マスタに見つからない）、つないだ製品、候補、印、重なり
#   check-sheet-handwritten.csv … 候補が複数の品目を、候補を並べた確認表にしたもの（AKI が 1 つ選ぶ）
# 決め方（推し量らない。決まらなければ候補にとどめる）：
#   ・名前が販売名の頭と合い、規格の数字が合う製品を探す。見つからなければ濁点・半濁点を無視して探し直し（手書きの書き間違い）、読み替えたことを残す
#   ・成分名（後発の名前）で書かれていれば、同じ成分・剤形コードと規格の先発品も候補に入れる
#   ・メーカーが書いてあれば、販売名の「」（）の中かメーカー名で絞る。書いていなければ絞らない
#   ・剤形（錠／OD錠／カプセルなど）が書いていなければ絞らない（普通錠と OD 錠が両方残れば候補が複数）
#   ・印：錠剤・カプセル以外、親マスタの「一包化しない」、抗がん剤（YJ の頭 42。AKI の決まり「抗がん剤は基本一包化しない」）
# 施設の品目名はこのスクリプトに書かない。
import csv, json, os, re, unicodedata
from collections import Counter

P = "data/private"
def nf(s): return unicodedata.normalize("NFKC", s or "")
def norm(s): return re.sub(r"[\s・･®（）()「」]", "", nf(s)).lower()
def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if os.path.exists(p) else []
def plain(s): return "".join(c for c in unicodedata.normalize("NFD", nf(s)) if c not in "\u3099\u309a")  # 濁点・半濁点を外す
MAKER_ALIAS = {"トーワ": ["トーワ", "東和"], "サワイ": ["サワイ", "沢井", "SW"], "ニプロ": ["ニプロ", "NP"], "NP": ["NP", "ニプロ"], "明治": ["明治", "Meiji"],
               "あすか": ["あすか"], "旭化成": ["旭化成"], "JG": ["JG", "日本ジェネリック"]}

pm = json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]
origin = {}
for f in sorted(os.listdir("data/parent")):
    if f.startswith("naifuku-tablets-") and f.endswith(".csv"):
        for r in load(os.path.join("data/parent", f)): origin[nf(r["brand_name"])] = "先発" if r["is_original"] == "True" else "後発" if r["is_generic"] == "True" else ""
ops_products = [r for r in load(f"{P}/ops-products.csv") if r["採用"] != "手書き"]  # 手書きだけで入った製品は「すでにあった」に数えない（作り直しても同じ結果に）
ops_keys = {r["product_key"] for r in ops_products}
ops_drugs = {(r["成分・剤形コード"], norm(r["規格"])) for r in ops_products}
answers = {r["手書き"]: r["選んだ製品（販売名）"] for r in load(f"{P}/handwritten-answers.csv") if r.get("選んだ製品（販売名）")}

def num_of(s):
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mg|μg|µg|g)?", nf(s)); return (m.group(1), (m.group(2) or "").replace("µ", "μ")) if m else (None, "")
def strength_ok(p, num, unit):
    s = nf(p["strength"]) + " " + nf(p["brand_name"])
    return re.search(rf"(?<![\d.]){re.escape(num)}\s*{unit or '(mg|μg|g)?'}(?![\d.])", s) is not None
def maker_label(p):
    m = re.search(r"[「（(]([^」）)]+)[」）)]", nf(p["brand_name"])); return m.group(1) if m else ""
def maker_ok(p, mk):
    names = MAKER_ALIAS.get(mk, [mk]); lab = norm(maker_label(p)); full = norm(p["maker"])
    return any(norm(n) == lab or (norm(n) and norm(n) in full) for n in names)
def form_written(text):
    t = nf(text)
    if "OD" in t or "口腔内崩壊" in t: return "OD"
    if "カプセル" in t: return "カプセル"
    if "錠" in t: return "錠"
    return None
def form_of(p):
    b = nf(p["brand_name"])
    if "OD" in b or "口腔内崩壊" in b: return "OD"
    if "カプセル" in b: return "カプセル"
    if "錠" in b: return "錠"
    return "その他"
def marks(p):
    m = []
    if form_of(p) == "その他": m.append("錠剤・カプセル以外")
    if "一包化しない" in (p.get("flags") or []): m.append("一包化しない（親マスタの印）")
    if (p.get("yj_code") or "").startswith("42"): m.append("一包化しない見込み（抗がん剤。AKI の決まり「抗がん剤は基本一包化しない」）")
    return "・".join(m)

out, sheet = [], []
for line in [l.strip() for l in open(f"{P}/handwritten-raw.txt", encoding="utf-8") if l.strip()]:
    t = nf(line)
    m = re.match(r"^(.+?)(?:OD錠|錠|カプセル)?\s*(\d+(?:\.\d+)?)\s*(mg|μg|µg)?\s*(.*)$", t)
    name, num, unit, mk = m.group(1).strip(), m.group(2), (m.group(3) or "").replace("µ", "μ"), m.group(4).strip()
    fixed = name
    hits = [p for p in pm if nf(p["brand_name"]).startswith(fixed) and strength_ok(p, num, unit)]
    if not hits:  # 濁点・半濁点の書き間違いを許して探し直す（読み替えた名前は親マスタの販売名の頭から取る）
        hits = [p for p in pm if plain(p["brand_name"]).startswith(plain(name)) and strength_ok(p, num, unit)]
        if hits: fixed = nf(hits[0]["brand_name"])[:len(name)]
    generic_written = any(maker_label(p) for p in hits)  # 後発の販売名（「」つき）が当たる＝成分名で書かれている
    if generic_written:  # 同じ成分・剤形コード・規格の先発品も候補に
        groups = {p["group"] for p in hits}
        hits += [p for p in pm if p["group"] in groups and strength_ok(p, num, unit) and p not in hits]
    fw = form_written(t)
    if fw: hits = [p for p in hits if form_of(p) == fw]
    if mk: hits = [p for p in hits if maker_ok(p, mk)]
    hits = sorted({p["product_key"]: p for p in hits}.values(), key=lambda p: (form_of(p) != "錠", origin.get(nf(p["brand_name"])) != "先発", p["brand_name"]))
    chosen = None
    if len(hits) == 1: chosen, kind = hits[0], "1 つに決まった"
    elif not hits: kind = "親マスタに見つからない"
    else:
        kind = "候補が複数"
        a = answers.get(line)
        if a: chosen = next((p for p in hits if p["brand_name"] == a), None)
    overlap = ""
    if chosen and chosen["product_key"] in ops_keys: overlap = "同じ製品がすでに運用マスタにある"
    elif chosen and (chosen["group"], norm(chosen["strength"])) in ops_drugs: overlap = "同じ成分・規格の別の製品がすでに運用マスタにある"
    elif not chosen and any(p["product_key"] in ops_keys for p in hits): overlap = "候補の 1 つがすでに運用マスタにある"
    why = []
    if fixed != name: why.append(f"成分名を読み替え（{name}→{fixed}）")
    if not mk and len(hits) > 1: why.append("メーカーが書いていない")
    if not fw and len({form_of(p) for p in hits}) > 1: why.append("剤形（錠・OD錠・カプセル）が書いていない")
    out.append({"手書き": line, "区分": kind, "つないだ製品（販売名）": chosen["brand_name"] if chosen else "", "product_key": chosen["product_key"] if chosen else "",
                "AKI の選択": answers.get(line, ""), "候補の数": len(hits), "候補（販売名）": "／".join(p["brand_name"] for p in hits),
                "印": marks(chosen) if chosen else "・".join(sorted({marks(p) for p in hits} - {""})), "重なり": overlap, "メモ": "。".join(why)})
    if kind == "候補が複数":
        for i, p in enumerate(hits, 1):
            sheet.append({"手書き": line, "番号": i, "候補（販売名）": p["brand_name"], "メーカー": p["maker"] or maker_label(p), "先発・後発": origin.get(nf(p["brand_name"])) or ("後発" if "「" in p["brand_name"] else ""),
                          "剤形": form_of(p), "印": marks(p), "すでに運用マスタに": "ある" if p["product_key"] in ops_keys else "", "選ぶ（○）": "○" if answers.get(line) == p["brand_name"] else ""})

def write(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), quoting=csv.QUOTE_ALL); w.writeheader(); w.writerows(rows)
write(f"{P}/handwritten-additions.csv", out)
if sheet: write(f"{P}/check-sheet-handwritten.csv", sheet)
c = Counter(r["区分"] for r in out)
print(f"手書き {len(out)}：", dict(c), f"／候補が複数のうち AKI が選んだ {sum(1 for r in out if r['区分'] == '候補が複数' and r['つないだ製品（販売名）'])}")
print("印あり", sum(1 for r in out if r["印"]), dict(Counter(x for r in out for x in r["印"].split("・") if x)))
print("重なり", dict(Counter(r["重なり"] for r in out if r["重なり"])))
print("読み替え", sum(1 for r in out if "読み替え" in r["メモ"]))
