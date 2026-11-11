# 採用品それぞれを「【般】一般名＋剤形＋規格」の処方として照合にかけ、その採用品にたどり着けないものを一覧にする。commit しない出力のみ。
#   python3 scripts/ops/probe-general-names.py            → data/private/general-probe/（架空の読み取り）と expected-general-probe.csv を作る
#   node scripts/eval/score-adopted.mjs --facility data/private/facility-real.json --expected data/private/general-probe \
#        --expected-adopted data/private/expected-general-probe.csv --out data/private/score-general-probe
#   python3 scripts/ops/probe-general-names.py --report   → data/private/general-unreachable.csv（採用品・一般名・今の結果・理由）
# 照合はアプリの lib/master.ts をそのまま使う（score-adopted.mjs 経由）。一般名処方の名前は厚労省の一般名処方マスタが無いので、
# 薬価基準の一覧の成分名（generic_name）から組み立てた近似：剤形は 錠／口腔内崩壊錠／カプセル／徐放錠／腸溶錠、
# 徐放錠の補足は CR＝24時間持続、L＝12時間持続（docs/design.md §5.6 の general_release_notes）。
# 施設の品目名はこのスクリプトに書かない。
import csv, json, os, re, sys, unicodedata

P = "data/private"; D = f"{P}/general-probe"
fac = [e for e in json.load(open(f"{P}/facility-real.json", encoding="utf-8"))["products"] if e["adopted"]]
idx = json.load(open("data/parent/maker-index.json", encoding="utf-8"))["drugs"]
key_of = {x["product_key"]: k for k, d in idx.items() for x in d["products"]}
UNKNOWN = ("未選択", "記憶ベース（両方使用）")

def general_name(e):
    k = key_of.get(e["product_key"], "")
    form = k.split("|", 2)[2] if k.count("|") >= 2 else ""
    b = unicodedata.normalize("NFKC", e["brand_name"])
    note = None
    if "カプセル" in b: fw = "徐放カプセル" if re.search(r"徐放|SR|LA|CR|L(?=カプセル)", b) else "カプセル"
    elif "OD" in form or "OD" in b or "口腔内崩壊" in b: fw = "腸溶性口腔内崩壊錠" if "ランソプラゾール" in e["generic_name"] else "口腔内崩壊錠"
    elif re.search(r"CR|徐放|持続|LA|SR", form + b): fw, note = "徐放錠", ("24時間持続" if "CR" in form + b else None)
    elif re.search(r"(^|錠)L$|L錠", form) or re.search(r"L錠", b): fw, note = "徐放錠", "12時間持続"
    elif "腸溶" in form + b or "EN" in form: fw = "腸溶錠"
    else: fw = "錠"
    return f"【般】{e['generic_name']}{fw}{e['strength']}", note

def classify(e, gname, r):
    """たどれない理由。一覧を見て手作業の対応表を作るか決めるための分類（決まりどおりのものと、照合の弱点と、この調べ方の近似を分ける）"""
    b = unicodedata.normalize("NFKC", e["brand_name"]); g = unicodedata.normalize("NFKC", e["generic_name"])
    if e["maker_state"] in UNKNOWN: return "決まりどおり：今のメーカーが「両方使用」なので自動では選ばない"
    if re.search(r"1錠|配合|・|、|\d+mg/", gname) or "錠" in g or "カプセル" in g or not re.search(r"\d", e["strength"]):
        return "この調べ方の近似：配合剤・規格が数量でない・元データの成分名が製品名で、正しい一般名を組み立てられない"
    if re.search(r"速崩|チュアブル|舌下", b): return "照合の弱点の候補：販売名の剤形（速崩・チュアブル・舌下）が一般名の剤形の言い方と合わない"
    if (re.search(r"XR|SR|LA|(?<![A-Z])R錠|徐放", b) or (e.get("yj_code") or "        ")[7:8] in ("G", "N")) and "徐放" not in gname:  # YJ の 8 桁目 G・N は徐放
        return "この調べ方の近似：徐放製剤なのに一般名を「錠・カプセル」で組み立てた（本来は徐放錠・徐放カプセル）"
    if re.search(r"\d(mg|μg)?(MT|AV|ZA|FF|A)「|錠A\d|S錠|FF錠", b): return "照合の弱点の候補：販売名の英字（MT・AV・ZA・FF・S など）を別の薬として分けている"
    if r["category"] == "ambiguous" and re.search(r"徐放|腸溶", gname): return "決まりどおり：徐放・腸溶の一般名は補足が無いと 1 つに決めない（候補には出る）"
    if r["category"] == "ambiguous": return "決まりどおり：先発・後発の印が無い／同じ鍵に複数あるので候補どまり"
    if re.search(r"水和物|プロピレングリコール|ナトリウム|Na|塩酸塩", g + gname): return "照合の弱点の候補：成分名の書き方（水和物・塩・Na の略記など）が親マスタの読み方と合わない"
    return "照合の弱点の候補：理由を特定できない（要確認）"

if "--report" not in sys.argv:
    os.makedirs(D, exist_ok=True)
    items, exp = [], []
    for i, e in enumerate(sorted(fac, key=lambda e: e["id"]), 1):
        rp = f"{i:03d}"; name, note = general_name(e)
        items.append({"rp": rp, "name_as_written": name, "name_note": note, "strength": e["strength"], "dosage_form": e["dosage_form"],
                      "dose_per_time": 1, "times_per_day": 1, "dose_per_day": 1, "per_timing": {"morning": 1, "noon": 0, "evening": 0}, "days": 7,
                      "raw_usage_text": "1回1錠 1日1回 朝食後", "pack_instruction": "none", "manual_fill_mark": False, "confidence": "high"})
        exp.append({"rx": "gp", "rp": rp, "expected": "メーカー未確定" if e["maker_state"] in UNKNOWN else e["id"], "pending_product": e["id"] if e["maker_state"] in UNKNOWN else "", "cases": ""})
    json.dump({"items": items, "all_one_dose": True, "include_all_note": None, "notes": None}, open(f"{D}/gp.expected.json", "w", encoding="utf-8"), ensure_ascii=False)
    with open(f"{P}/expected-general-probe.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["rx", "rp", "expected", "pending_product", "cases"]); w.writeheader(); w.writerows(exp)
    print(f"採用品 {len(items)} 件を一般名の処方にした → {D}/gp.expected.json")
else:
    res = list(csv.DictReader(open(f"{P}/score-general-probe-rows.csv", encoding="utf-8-sig")))
    gp = {x["rp"]: x for x in json.load(open(f"{D}/gp.expected.json", encoding="utf-8"))["items"]}
    exp = {r["rp"]: r for r in csv.DictReader(open(f"{P}/expected-general-probe.csv", encoding="utf-8"))}
    sorted_fac = sorted(fac, key=lambda e: e["id"])
    LABEL = {"wrong_product": "別の製品が選ばれる", "wrong_none": "該当なし", "ambiguous": "自動で決まらない（候補が複数・候補どまり）", "missing": "読み取りで抜け"}
    out = []
    for r in res:
        if r["category"] in ("ok_product", "ok_pending", "ok_none"): continue
        e = sorted_fac[int(r["rp"]) - 1]
        why = classify(e, gp[r["rp"]]["name_as_written"], r)
        if r["category"] == "ambiguous" and "正解が候補にある" in (r["kind"] or ""): now = "候補に出る（自動では選ばれない）"
        elif r["category"] == "ambiguous": now = "候補に出ない（別の候補だけ）"
        else: now = LABEL.get(r["category"], r["category"])
        out.append({"採用品": e["brand_name"], "一般名": gp[r["rp"]]["name_as_written"] + (f"（{gp[r['rp']]['name_note']}）" if gp[r["rp"]]["name_note"] else ""),
                    "今の結果": now, "選ばれた・候補": f"{r['selected'] or '—'}／候補 {r['candidates']}", "理由": why})
    with open(f"{P}/general-unreachable.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["採用品", "一般名", "今の結果", "選ばれた・候補", "理由"], quoting=csv.QUOTE_ALL); w.writeheader(); w.writerows(out)
    from collections import Counter
    print(f"採用品 {len(res)}：たどれる {len(res) - len(out)}、たどれない {len(out)}", dict(Counter(x["今の結果"] for x in out)))
    print(dict(Counter(x["理由"].split("：")[0] for x in out)))
    for k, v in Counter(x["理由"] for x in out).most_common(): print(f"  {v:3d} {k}")
