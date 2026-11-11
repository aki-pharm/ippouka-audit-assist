# 運用マスタ（data/private/ops-master.csv・ops-products.csv）から、照合の採点に使う施設マスタ JSON を作る。commit しない。
#   python3 scripts/ops/build-facility-json.py   → data/private/facility-real.json
# 形は data/rx-testset/facility.json と同じ（scripts/eval/score-adopted.mjs が読む）。
#   1 件：id（親マスタの product_key）・product_key・yj_code・brand_name・generic_name・strength・maker・dosage_form・adopted・maker_state・aliases、
#         採用中止なら discontinued_reason
# 決め方：
#   ・薬（成分・規格・剤形）ごとの「今の製品」→ adopted: true、maker_state は運用マスタの状態
#   ・「両方使用」の薬 → 名指しされた製品をすべて adopted: true、maker_state「記憶ベース（両方使用）」（照合ではメーカー未確定になる）
#   ・同じ薬で今の製品でない採用品（棚とカセットの札が違った側など）→ adopted: false、discontinued_reason「メーカー切替」
#   ・今のメーカーが決まっていない薬 → 札の製品を adopted: true、maker_state「未選択」
# 施設の品目名はこのスクリプトに書かない。
import csv, json, re, unicodedata

P = "data/private"
def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig")))
pm = {p["product_key"]: p for p in json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]}
by_brand = {p["brand_name"]: p for p in pm.values()}
master = load(f"{P}/ops-master.csv"); products = load(f"{P}/ops-products.csv")
answers = {(r["成分"], r["規格"], r["剤形"]): r for r in load(f"{P}/maker-answers.csv")}

def entry(p, generic, adopted, maker_state=None, reason=None):
    e = {"id": p["product_key"], "product_key": p["product_key"], "yj_code": p["yj_code"] or None, "brand_name": p["brand_name"], "generic_name": generic,
         "strength": p["strength"], "maker": p["maker"], "dosage_form": "capsule" if "カプセル" in p["brand_name"] else "tablet",
         "adopted": adopted, "maker_state": maker_state, "aliases": []}
    if reason: e["discontinued_reason"] = reason
    return e

out = {}
def put(e):
    cur = out.get(e["id"])
    if cur is None or (e["adopted"] and not cur["adopted"]): out[e["id"]] = e

prod_by_drug = {}
for r in products:
    prod_by_drug.setdefault((r["成分・剤形コード"], r["規格"], r["剤形"]), []).append(r)
for r in master:
    generic = r["成分"]; state = r["状態"]
    rs = [x for k, xs in prod_by_drug.items() if k[0] == r["成分・剤形コード"] and k[2] == r["剤形"] and re.sub(r"\s", "", k[1]) == re.sub(r"\s", "", r["規格"]) for x in xs]
    if state == "記憶ベース（両方使用）":
        names = re.sub(r"^両方（|）$", "", r["今のメーカー"]).split("・")
        ans = answers.get((generic, r["規格"], r["剤形"]))
        chosen = []
        for x in rs:
            lab = re.search(r"「([^」]+)」", x["販売名"]); lab = lab.group(1) if lab else f"（先発）{re.split(r'OD錠|錠|カプセル', x['販売名'])[0]}"
            if any(n and (n in lab or lab in n) for n in names): chosen.append(x["販売名"])
        # 札に無い製品を名指ししている（例：後発の別メーカー）ときは、同じ薬の親マスタの製品から探す
        for n in names:
            if any(n.replace("（先発）", "") in c for c in chosen): continue
            for p in pm.values():
                if p["group"] == r["成分・剤形コード"] and re.sub(r"\s", "", p["strength"]) == re.sub(r"\s", "", r["規格"]) and n.replace("（先発）", "") and n.replace("（先発）", "") in p["brand_name"]:
                    if ("OD" in p["brand_name"]) == (r["剤形"] == "OD錠"): chosen.append(p["brand_name"]); break
        for b in dict.fromkeys(chosen):
            if b in by_brand: put(entry(by_brand[b], generic, True, "記憶ベース（両方使用）"))
        for x in rs:
            if x["販売名"] not in chosen and x["販売名"] in by_brand: put(entry(by_brand[x["販売名"]], generic, False, None, "メーカー切替"))
        continue
    cur = r["今の製品（販売名）"]
    if cur and cur in by_brand:
        put(entry(by_brand[cur], generic, True, state))
        for x in rs:
            if x["販売名"] != cur and x["販売名"] in by_brand: put(entry(by_brand[x["販売名"]], generic, False, None, "メーカー切替"))
    else:
        for x in rs:
            if x["販売名"] in by_brand: put(entry(by_brand[x["販売名"]], generic, True, "未選択"))

# 処方箋での別表記（aliases）：デモ用マスタ（data/master.json。AKI が実物で確認した採用品）にあるものを、同じ製品に引き継ぐ
for m in json.load(open("data/master.json", encoding="utf-8")):
    e = out.get(m.get("product_key") or "")
    if e is not None:
        e["aliases"] = sorted(set(e["aliases"]) | {a for a in [m["brand_name"], *(m.get("aliases") or [])] if a != e["brand_name"]})
items = sorted(out.values(), key=lambda e: e["id"])
doc = {"_説明": ["実在施設の採用品マスタ（非公開。commit しない）。scripts/ops/build-facility-json.py で運用マスタから作る",
                 "adopted:false はメーカー切替で今の製品でなくなったもの。maker_state が 未選択／記憶ベース（両方使用） はメーカー未確定"],
       "facility": "院内（非公開）", "products": items}
json.dump(doc, open(f"{P}/facility-real.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
print(f"施設マスタ {len(items)} 件：採用 {sum(e['adopted'] for e in items)}、メーカー切替で採用中止 {sum(not e['adopted'] for e in items)}、メーカー未確定 {sum(1 for e in items if e['adopted'] and e['maker_state'] in ('未選択', '記憶ベース（両方使用）'))}")
