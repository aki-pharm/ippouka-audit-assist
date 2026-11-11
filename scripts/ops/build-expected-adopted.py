# 架空処方 20 件（data/rx-testset/rows.csv）の各行について、実在施設の採用品なら何が選ばれるべきかの正解 CSV を作る。commit しない。
#   python3 scripts/ops/build-expected-adopted.py   → data/private/expected-adopted-real.csv、expected-adopted-real-ask.csv（迷う行）
# 採点される側（lib/matching.ts）は使わない。薬の鍵（data/parent/maker-index.json の drug_key：成分・規格・剤形。剤形は放出の型を含む）と、
# 厚労省の一覧の先発・後発の印から、docs/design.md §5.6 の院内ルールで決める：
#   同じ鍵の採用品 → 選ぶ（一般名処方は先発・後発を問わない。先発→後発は選ぶ。後発→別の後発は YJ の上 9 桁が同じなら選ぶ）
#   普通錠 → 同じ成分・規格の OD 錠 → 選ぶ（置き換え）。OD→普通錠、カプセル↔錠、放出・規格の違い → 選ばない
#   後発→先発、先発→別の先発（併売）→ 自動では選ばない（候補にとどめる）→ 正解が決まらないので「迷う行」として AKI に聞く
#   採用品の maker_state が 未選択／両方 → メーカー未確定（pending_product にその薬の採用品）
# 施設の品目名はこのスクリプトに書かない。
import csv, json, re, unicodedata

P = "data/private"
def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig")))
idx = json.load(open("data/parent/maker-index.json", encoding="utf-8"))["drugs"]
key_of = {}
for k, d in idx.items():
    for x in d["products"]: key_of[x["product_key"]] = k
pm = {p["product_key"]: p for p in json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]}
# 架空処方の製品名はデモ用マスタ（data/master.json）の名前のことがある（例：「フォリアミン錠5mg」）。その product_key で鍵を引く
for m in json.load(open("data/master.json", encoding="utf-8")):
    if m.get("product_key") and m["product_key"] in key_of:
        for n in [m["brand_name"], *(m.get("aliases") or [])]: key_of.setdefault(n, key_of[m["product_key"]])
        if m["product_key"] in pm: pm.setdefault(m["brand_name"], pm[m["product_key"]])
origin = {}
for f in ["data/parent/naifuku-tablets-20261101.csv"]:
    for r in load(f):
        o = "先発" if r["is_original"] == "True" else "後発" if r["is_generic"] == "True" else "不明"
        origin[unicodedata.normalize("NFKC", r["brand_name"])] = o
def origin_of(name):
    n = unicodedata.normalize("NFKC", name)
    if n in origin and origin[n] != "不明": return origin[n]
    return "後発" if "「" in name else "不明"
def yj9(p): return (p.get("yj_code") or "")[:9]

fac = json.load(open(f"{P}/facility-real.json", encoding="utf-8"))["products"]
adopted = [e for e in fac if e["adopted"]]
by_key = {}
for e in adopted:
    k = key_of.get(e["product_key"])
    if k: by_key.setdefault(k, []).append(e)
UNKNOWN = ("未選択", "記憶ベース（両方使用）")

# 索引が販売名の英字を剤形の印として分けてしまう先発品（効能違いではなく、ただの商品名の一部）。成分・規格・剤形が同じ薬として扱う
SAME_DRUG_BRANDS = {"アルダクトンA錠25mg": "|25|錠", "アルダクトンA錠50mg": "|50|錠"}
for b, tail in SAME_DRUG_BRANDS.items():
    if b in key_of: key_of[b] = key_of[b].split("|")[0] + tail
rows = load("data/rx-testset/rows.csv")
out, ask = [], []
for r in rows:
    written = r["name_as_written"]; prod = r["product"]; general = written.startswith("【般】")
    k = key_of.get(prod)
    res, why, pending = None, "", ""
    if not k:
        res, why = "（判定できない）", "処方の製品が親マスタの索引に無い"
    else:
        g, s, form = k.split("|", 2)
        same = by_key.get(k, [])
        od = by_key.get(f"{g}|{s}|OD錠", []) if form == "錠" else []
        cands, route = (same, "同じ鍵") if same else ((od, "普通錠→OD錠") if od else ([], ""))
        if not cands:
            res, why = "採用なし", "同じ鍵・置き換えの採用品が無い"
        else:
            unk = [e for e in cands if e["maker_state"] in UNKNOWN]
            prod_key = pm.get(prod, {}).get("product_key", prod)  # デモ用マスタの名前なら親マスタの product_key に読み替える
            exact = [e for e in cands if e["product_key"] in (prod, prod_key) and not general]
            if unk:
                res, pending, why = "メーカー未確定", unk[0]["id"], f"{route}の採用品のメーカーが未確定"
            elif exact:
                res, why = exact[0]["id"], "処方どおりの製品が採用品"
            elif general:
                res, why = (cands[0]["id"], f"一般名処方→{route}の採用品") if len(cands) == 1 else (None, f"一般名処方で{route}の採用品が {len(cands)} つ")
            else:
                o_rx = origin_of(pm.get(prod, {}).get("brand_name", prod)); c = cands[0]; o_c = origin_of(c["brand_name"])
                if len(cands) > 1: res, why = None, f"{route}の採用品が {len(cands)} つ"
                elif route == "普通錠→OD錠" and not (o_rx == "後発" and o_c == "先発"): res, why = c["id"], f"普通錠→OD錠（置き換え）、{o_rx}→{o_c}"
                elif o_rx == "先発" and o_c == "後発": res, why = c["id"], f"{route}、先発→後発"
                elif o_rx == "後発" and o_c == "後発" and yj9(pm.get(prod, {})) and yj9(pm.get(prod, {})) == yj9(c): res, why = c["id"], f"{route}、後発→別の後発（YJ 上 9 桁が同じ）"
                else: res, why = None, f"{route}、{o_rx}→{o_c}（自動では選ばない決まり。候補にとどめる）"
    row = {"rx": r["rx"], "rp": r["rp"], "expected": res or "", "pending_product": pending}
    if res is None or res == "（判定できない）":
        ask.append({**row, "処方の名前": written, "理由": why}); continue
    out.append({**row, "_why": why})
with open(f"{P}/expected-adopted-real.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["rx", "rp", "expected", "pending_product", "cases"], extrasaction="ignore"); w.writeheader()
    for x in out: w.writerow({**x, "cases": ""})
with open(f"{P}/expected-adopted-real-why.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["rx", "rp", "expected", "pending_product", "_why"]); w.writeheader(); w.writerows(out)
with open(f"{P}/expected-adopted-real-ask.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["rx", "rp", "処方の名前", "expected", "pending_product", "理由"]); w.writeheader(); w.writerows(ask)
from collections import Counter
print(f"行 {len(rows)}：正解が決まった {len(out)}（採用品 {sum(1 for x in out if x['expected'] not in ('採用なし', 'メーカー未確定'))}、採用なし {sum(1 for x in out if x['expected'] == '採用なし')}、メーカー未確定 {sum(1 for x in out if x['expected'] == 'メーカー未確定')}）、迷う {len(ask)}")
for a in ask: print("  迷う:", a["rx"], a["rp"], "|", a["理由"])
