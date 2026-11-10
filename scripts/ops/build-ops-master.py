# 運用マスタ（施設の採用品）を data/private/ に作る。commit しない。
# 入力：data/private/adoption-draft.csv（棚 497 件）、cassette-list.csv（カセット 165 件＋AKI の答え）、
#       data/parent/parent-master.json、data/parent/verify/quote-check.csv、reports/check-parent.csv、data/master.json
# 出力：data/private/ops-master.csv（1 品目 1 行）、ops-unlinked.csv（親マスタにつながらない）、ops-alternatives.csv（同成分の他社）、
#       check-sheet-1.csv / .html（確認表 ①）、ops-counts.json（件数）
import csv, json, re, unicodedata
from collections import defaultdict, Counter

P = "data/private"
def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig")))
def norm(s): return re.sub(r"[\s・･®（）()「」]", "", unicodedata.normalize("NFKC", s or "")).lower()
def maker_of(label):
    m = re.search(r"「([^」]+)」", unicodedata.normalize("NFKC", label or "")); return m.group(1) if m else ""
def form_of(name):
    n = unicodedata.normalize("NFKC", name)
    if "ODフィルム" in n: return "ODフィルム"
    if "OD錠" in n or "口腔内崩壊" in n: return "OD錠"
    if "カプセル" in n: return "カプセル"
    if "チュアブル" in n: return "チュアブル錠"
    if "錠" in n: return "錠"
    return "その他"
def strength_key(s): return norm(s).replace("mg", "").replace("μg", "μg").replace("ug", "μg")

pm = json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]
PM = {p["product_key"]: p for p in pm}
master = {norm(m["brand_name"]): m for m in json.load(open("data/master.json", encoding="utf-8"))}

# 照合（Sonnet の下書き＝YJ 単位）：yj → 判定と理由
qc = defaultdict(list)
for r in load("data/parent/verify/quote-check.csv"):
    v = "照合不能" if r["quote"] == "照合不能" else ("目で見る" if r["priority"] else "通った")
    qc[r["yj"]].append((v, r["priority"], r["review_reason"] or r["reason"], r["product_name"]))
cp = defaultdict(list)
for r in load("reports/check-parent.csv"): cp[r["yj_code"]].append(r["rules"])
# Haiku（文書単位）の下書きしかない品目：照合・品質とも販売名で引く（YJ が無い・共有されているため）
import os
qc_h = defaultdict(list); cp_h = defaultdict(list)
if os.path.exists("data/parent/verify/claude-haiku-5-5/quote-check.csv"):
    for r in load("data/parent/verify/claude-haiku-5-5/quote-check.csv"):
        v = "照合不能" if r["quote"] == "照合不能" else ("目で見る" if r["priority"] else "通った")
        qc_h[norm(r["product_name"])].append((v, r["priority"], r["review_reason"] or r["reason"], r["product_name"]))
if os.path.exists("reports/check-parent-claude-haiku-5-5.csv"):
    for r in load("reports/check-parent-claude-haiku-5-5.csv"): cp_h[norm(r["brand_name"])].append(r["rules"])

def verify_of(p):
    """品目の照合結果。Sonnet の下書きがある品目は YJ で（販売名が一致する行を優先）、Haiku だけの品目は販売名で引く"""
    rows = qc.get(p["yj_code"], []) if p["draft_model"] == "claude-sonnet-5-5" else qc_h.get(norm(p["brand_name"]), [])
    if not rows: return ("", "", "")
    same = [x for x in rows if norm(x[3]) == norm(p["brand_name"])] or rows
    worst = sorted(same, key=lambda x: {"照合不能": 0, "目で見る": 1, "通った": 2}[x[0]])[0]
    return worst[0], worst[1], worst[2]
def rules_of(p):
    src = cp.get(p["yj_code"], []) if p["draft_model"] == "claude-sonnet-5-5" else cp_h.get(norm(p["brand_name"]), [])
    return " ".join(sorted({x for xs in src for x in xs.split()}))

# 採用品を集める：product_key → 情報
shelf = [r for r in load(f"{P}/adoption-draft.csv") if r["棚のラベル（読み取り）"]]
cas = [r for r in load(f"{P}/cassette-list.csv") if r["ラベル（読み取り）"] and r["カセット番号"]]
items = {}      # product_key → dict
unlinked = []   # (出どころ, ラベル, 理由)
def take(key, src, r):
    if key not in PM:
        unlinked.append((src, r.get("棚のラベル（読み取り）") or r.get("ラベル（読み取り）"), r["突き合わせ"] or "候補なし")); return None
    it = items.setdefault(key, {"shelf": [], "cas": [], "cas_no": [], "cas_maker": [], "aki": [], "ambig": False, "conf": []})
    if "候補" in (r["突き合わせ"] or "") and "件" in r["突き合わせ"]: it["ambig"] = True
    if r["突き合わせ"].startswith("名前だけ"): it["ambig"] = True
    return it
for r in shelf:
    it = take(r["親マスタの候補（販売名）"], "棚", r)
    if it: it["shelf"].append(r["棚のラベル（読み取り）"]); it["conf"].append(r["確度"])
for r in cas:
    it = take(r["親マスタの候補（販売名）"], "カセット", r)
    if it:
        it["cas"].append(r["ラベル（読み取り）"]); it["cas_no"].append(r["カセット番号"]); it["conf"].append(r["確度"])
        it["cas_maker"].append(maker_of(r["ラベル（読み取り）"]) or "（先発）")
        if r.get("現物のメーカー（AKI）"): it["aki"].append(r["現物のメーカー（AKI）"])

rows = []
for key, it in items.items():
    p = PM[key]
    shelf_makers = sorted({maker_of(x) or "（先発）" for x in it["shelf"]})
    cas_makers = sorted(set(it["cas_maker"]))
    aki = "；".join(dict.fromkeys(it["aki"]))
    mismatch = bool(it["cas"]) and bool(it["shelf"]) and set(cas_makers) != set(shelf_makers)
    # 確認の状態：現物（運用マスタ verified）＞ 記憶ベース ＞ 添付文書で人が確認 ＞ 下書き
    m = master.get(norm(p["brand_name"]))
    if m and m.get("status") == "verified": state = "確認ずみ（現物）"
    elif aki: state = "記憶ベース・要再確認"
    elif p["status"] == "confirmed": state = "添付文書で確認（現物は未確認）"
    else: state = "下書き"
    v, pri, why = verify_of(p)
    rules = rules_of(p)
    marks = []
    if v == "目で見る": marks.append(f"照合：目で見る（{pri}）{why}")
    if v == "照合不能": marks.append(f"照合不能：{why}")
    if rules: marks.append(f"品質：{rules}")
    if p["flags"]: marks.append("印：" + "・".join(p["flags"]))
    rows.append({
        "product_key": key, "販売名": p["brand_name"], "メーカー（親マスタ）": p["maker"], "YJコード": p["yj_code"], "成分・剤形コード": p["group"], "規格": p["strength"],
        "採用": "棚＋カセット" if it["shelf"] and it["cas"] else ("カセット" if it["cas"] else "棚"),
        "分包方法": "カセット" if it["cas"] else "手撒き",
        "カセット番号": "／".join(it["cas_no"]), "カセットのメーカー": "／".join(cas_makers), "棚のメーカー": "／".join(shelf_makers),
        "現物のメーカー（AKI 回答）": aki, "カセットと棚で違う": "違う" if mismatch else "",
        "刻印_表": p["imprint_front"], "刻印_裏": p["imprint_back"], "色": p["color"], "形": p["shape"], "長径mm": p["size_long_mm"], "短径mm": p["size_short_mm"], "大きさの出どころ": p["size_source"],
        "確認の状態": state, "親マスタの状態": p["status"],
        "照合": v or "（検査なし）", "照合の理由": why if v != "通った" else "", "品質": rules, "印": "・".join(p["flags"]), "検査の印": "；".join(marks), "検査の下書き": p["draft_model"],
        "候補が複数": "複数（要選択）" if it["ambig"] else "", "読み取りの確度": "".join(sorted(set(it["conf"]))),
        "カセットのラベル": "／".join(it["cas"]), "棚のラベル": "／".join(it["shelf"]), "添付文書": p["source_url"], "備考": p["notes"],
    })
# カセットと棚で「同じ成分・規格・剤形なのに別メーカーの製品」に分かれているもの（例：カセットは YD、棚はトーワ）。別の行になるので、ここで印を付ける
grp = defaultdict(list)
for r in rows: grp[(r["成分・剤形コード"], strength_key(r["規格"]), form_of(r["販売名"]))].append(r)
for g, rs in grp.items():
    cas_m = {r["メーカー（親マスタ）"] for r in rs if r["分包方法"] == "カセット"}
    shelf_m = {r["メーカー（親マスタ）"] for r in rs if r["採用"] in ("棚", "棚＋カセット")}
    if cas_m and shelf_m and cas_m != shelf_m:
        for r in rs:
            if not r["カセットと棚で違う"]: r["カセットと棚で違う"] = "違う（同成分の別メーカーがカセットと棚に分かれている）"
            r["同成分の採用品"] = "／".join(sorted(x["販売名"] for x in rs if x is not r))
for r in rows: r.setdefault("同成分の採用品", "")
rows.sort(key=lambda r: (r["YJコード"] or "zzz", r["販売名"]))
cols = list(rows[0].keys())
with open(f"{P}/ops-master.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL); w.writeheader(); w.writerows(rows)
with open(f"{P}/ops-unlinked.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL); w.writerow(["出どころ", "ラベル", "理由"]); w.writerows(unlinked)

# 2. 同じ成分・同じ規格・同じ剤形の他社製品（候補）
by_group = defaultdict(list)
for p in pm:
    if p["status"] != "none": by_group[(p["group"], strength_key(p["strength"]), form_of(p["brand_name"]))].append(p)
alts = []; n_with = 0
for r in rows:
    p = PM[r["product_key"]]
    others = [q for q in by_group.get((p["group"], strength_key(p["strength"]), form_of(p["brand_name"])), []) if q["product_key"] != p["product_key"]]
    if others: n_with += 1
    for q in sorted(others, key=lambda q: q["brand_name"]):
        alts.append([r["販売名"], r["カセット番号"], q["brand_name"], q["maker"], q["imprint_front"], q["imprint_back"], q["color"], q["shape"], q["size_long_mm"],
                     {"verified": "確認ずみ（現物）", "confirmed": "添付文書で確認", "draft": "候補（下書き）"}.get(q["status"], q["status"]), "候補", q["source_url"]])
with open(f"{P}/ops-alternatives.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    w.writerow(["採用品", "カセット番号", "同成分の他社製品（販売名）", "メーカー", "刻印_表", "刻印_裏", "色", "形", "長径mm", "確認の状態", "区分", "添付文書"]); w.writerows(alts)

# 3. 確認表 ①：カセットと棚でメーカーが違う／記憶ベース／先発名のまま（カセットの札が先発で棚が後発）
def is_brand_only(r): return r["分包方法"] == "カセット" and r["カセットのメーカー"] == "（先発）" and r["棚のメーカー"] not in ("", "（先発）")
s1 = [r for r in rows if r["カセットと棚で違う"] or r["確認の状態"] == "記憶ベース・要再確認" or is_brand_only(r)]
s2 = [r for r in rows if r not in s1 and r["検査の印"] and r["確認の状態"] != "確認ずみ（現物）"]
s3 = [r for r in rows if r not in s1 and r not in s2]
c1 = ["カセット番号", "販売名", "規格", "カセットのメーカー", "棚のメーカー", "現物のメーカー（AKI 回答）", "刻印_表", "刻印_裏", "確認の状態", "検査の印", "同成分の採用品"]
with open(f"{P}/check-sheet-1.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL); w.writerow(c1 + ["現物のメーカー（記入）", "刻印（記入）"])
    for r in sorted(s1, key=lambda r: (r["成分・剤形コード"], strength_key(r["規格"]), r["分包方法"] != "カセット", r["販売名"])): w.writerow([r[c] for c in c1] + ["", ""])
import html as H
trs = "".join("<tr>" + "".join(f"<td>{H.escape(str(r[c]))}</td>" for c in c1[:6]) + f"<td>{H.escape(r['刻印_表'])} / {H.escape(r['刻印_裏'])}</td><td>{H.escape(r['確認の状態'])}</td><td class='w'></td><td class='w'></td></tr>"
              for r in sorted(s1, key=lambda r: (int(r["カセット番号"].split("／")[0]) if r["カセット番号"] else 9999)))
open(f"{P}/check-sheet-1.html", "w", encoding="utf-8").write(f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>確認表①</title>
<style>body{{font-family:"Noto Sans JP",sans-serif;font-size:11pt;margin:14px;background:#fff;color:#111}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #777;padding:4px 6px;font-size:9.5pt;vertical-align:top}}th{{background:#eef3fa}}td.w{{min-width:8em;background:#fffbe6}}h1{{font-size:14pt;margin:0 0 6px}}p{{font-size:9.5pt;color:#444}}@media print{{tr{{page-break-inside:avoid}}}}</style></head><body>
<h1>確認表 ①　カセットと棚でメーカーが違う／記憶ベースで答えたもの（{len(s1)} 件）</h1><p>現物を見て、黄色の欄に現物のメーカーと刻印（表／裏）を書いてください。刻印が無ければ「なし」。作成 2026-11-10</p>
<table><thead><tr><th>No.</th><th>販売名</th><th>規格</th><th>カセット</th><th>棚</th><th>AKI の答え（記憶）</th><th>親マスタの刻印 表/裏</th><th>状態</th><th>現物のメーカー</th><th>刻印（表／裏）</th></tr></thead><tbody>{trs}</tbody></table></body></html>""")

counts = {
    "採用品（1品目1行）": len(rows), "うち棚だけ": sum(1 for r in rows if r["採用"] == "棚"), "うちカセット": sum(1 for r in rows if r["分包方法"] == "カセット"),
    "親マスタにつながらない": len(unlinked), "候補が複数で要選択": sum(1 for r in rows if r["候補が複数"]),
    "確認の状態": dict(Counter(r["確認の状態"] for r in rows)), "照合": dict(Counter(r["照合"] for r in rows)), "品質の印あり": sum(1 for r in rows if r["品質"]),
    "Haiku の下書きだけの採用品": sum(1 for r in rows if r["検査の下書き"] == "claude-haiku-5-5"),
    "Haiku だけの採用品の照合": dict(Counter(r["照合"] for r in rows if r["検査の下書き"] == "claude-haiku-5-5")),
    "Haiku だけの採用品の品質の印あり": sum(1 for r in rows if r["検査の下書き"] == "claude-haiku-5-5" and r["品質"]),
    "検査の印あり": sum(1 for r in rows if r["検査の印"]), "一包化しない印": sum(1 for r in rows if "一包化しない" in r["印"]),
    "同成分の他社製品がある採用品": n_with, "他社製品の候補行": len(alts),
    "確認表①": len(s1), "確認表②（検査の印あり）": len(s2), "確認表③（残り）": len(s3),
}
json.dump(counts, open(f"{P}/ops-counts.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(counts, ensure_ascii=False, indent=1))
print("つながらない:", unlinked)
