# 確認表 ②（検査の印がある薬）を、AKI が見る前に機械で減らす。commit しない出力はすべて data/private/。
#   python3 scripts/ops/build-ops-master.py && python3 scripts/ops/build-check-sheet-2.py && python3 scripts/ops/reduce-check-sheet-2.py
#
# 印ごとの片付け方（AI の判断は使わない。比べるのは文字と数字だけ）：
#   ・数字が別のページ／本文に無いと出たもの → scripts/verify-recheck.py の結果（数字の空白を詰めて照合、製品名のあるページ）
#   ・刻印が図だけ（照合「どのページにも無い（図の可能性）」、品質 R3）→ Opus 5.5 で抽出し直した値（data/private/opus-drafts/）と
#     下書き（Sonnet か Haiku）の値が一致すれば「2モデル一致」。違えば、または Opus も読めなければ残す
#   ・大きさが図だけ（本文に数字が無い）→ 同じく Opus の値と比べ、0.1mm 以内で一致すれば「2モデル一致」
#   ・形・大きさが空欄（品質 R4）→ 形は性状の文から拾う（無ければ、カプセル剤は長円、長径＝短径の錠剤は円形）。大きさは Opus の値が本文にあれば採る。カプセルの短径は号数から推定（印つき）
#   ・根拠の文言が近似だけが残ったもの → 値はそれぞれ本文で照合ずみなので片付ける（文言の書き起こしの揺れ）
# 片付いた薬は「値の状態＝添付文書で確認（機械）」とする。確認ずみ（現物）にはしない。
# 出力：data/private/check-sheet-2.csv（残った分だけ）、check-sheet-2.html、check-sheet-2-machine.csv（片付いた分と理由）、check-sheet-2-counts.json
import csv, json, os, re, sys, unicodedata, html as H
from collections import Counter

sys.path.insert(0, "scripts")
P = "data/private"
def nfkc(s): return unicodedata.normalize("NFKC", s or "")
def nkey(s): return re.sub(r"[\s・･®（）()「」]", "", nfkc(s)).lower()
def ikey(s): return re.sub(r"[\s　・\-‐]", "", nfkc(s)).upper()
UNKNOWN = {"", "未確認", "NONE", "NULL"}

import importlib.util
spec = importlib.util.spec_from_file_location("vr", "scripts/verify-recheck.py"); vr = importlib.util.module_from_spec(spec); spec.loader.exec_module(vr)

pm = {p["brand_name"]: p for p in json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]}
om = {r["今の製品（販売名）"]: r for r in csv.DictReader(open(f"{P}/ops-master.csv", encoding="utf-8-sig"))}
sheet = list(csv.DictReader(open(f"{P}/check-sheet-2-all.csv", encoding="utf-8-sig")))  # build-check-sheet-2.py が書く減らす前の全件
# 照合の行（Sonnet は YJ＋販売名、Haiku は販売名）
qc = {}
for f, m in [("data/parent/verify/quote-check.csv", "s"), ("data/parent/verify/claude-haiku-5-5/quote-check.csv", "h")]:
    for r in csv.DictReader(open(f, encoding="utf-8-sig")): qc.setdefault((m, r["yj"] if m == "s" else "", nkey(r["product_name"])), r)
rc = {}
for f, m in [("data/parent/verify/recheck.csv", "s"), ("data/parent/verify/claude-haiku-5-5/recheck.csv", "h")]:
    if os.path.exists(f):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")): rc[(m, r["yj"] if m == "s" else "", nkey(r["product_name"]))] = r

def opus_product(doc_id, name, strength):
    f = f"data/private/opus-drafts/{doc_id}.json"
    if not os.path.exists(f): return None
    ps = json.load(open(f)).get("products", [])
    return (next((p for p in ps if nkey(p["product_name"]) == nkey(name)), None)
            or next((p for p in ps if nkey(p["product_name"]) and (nkey(p["product_name"]) in nkey(name) or nkey(name) in nkey(p["product_name"]))), None)
            or next((p for p in ps if nkey(p.get("strength")) == nkey(strength)), None)
            or (ps[0] if len(ps) == 1 else None))
def num_eq(a, b):
    try: return abs(float(a) - float(b)) <= 0.1
    except (TypeError, ValueError): return False

CAPSULE_MM = {"000": 9.9, "00": 8.5, "0": 7.6, "1": 6.9, "2": 6.4, "3": 5.8, "4": 5.3, "5": 4.9}
out_left, out_done = [], []
issue_count, fix_count = Counter(), Counter()
for s in sheet:
    name = s["今の製品（販売名）"]; p = pm[name]; o = om.get(name, {})
    m = "s" if p["draft_model"] == "claude-sonnet-5-5" else "h"
    key = (m, p["yj_code"] if m == "s" else "", nkey(name))
    q = qc.get(key) or (next((v for k, v in qc.items() if k[0] == "s" and k[1] == p["yj_code"]), None) if m == "s" else None)
    r = rc.get(key)
    issues = [x for x in ((q or {}).get("review_reason", "") or "").split("；") if x]
    rules = (o.get("品質") or "").split()
    for x in issues: issue_count["照合：" + x] += 1
    for x in rules: issue_count["品質：" + x] += 1
    left_after_text = set(x for x in (r["残った"].split("；") if r else issues) if x)
    fixed = []; left = []; values = {}
    # 1) 本文での照合し直し
    for x in issues:
        if x not in left_after_text: fixed.append(f"{x}（本文で照合し直し）"); fix_count["本文で照合し直し"] += 1
    op = opus_product(p["doc_id"], name, p["strength"])
    def imprint_issue(side):
        d = p["imprint_front"] if side == "表" else p["imprint_back"]
        ov = (op or {}).get("imprint_front" if side == "表" else "imprint_back")
        if op is None: return False, f"刻印（{side}）：Opus の抽出なし", d, ""
        if ikey(d) in UNKNOWN or ikey(ov) in UNKNOWN: return False, f"刻印（{side}）：図だけで、どちらのモデルも文字にできない" if ikey(d) in UNKNOWN and ikey(ov) in UNKNOWN else f"刻印（{side}）：片方のモデルしか読めない（下書き {d or '空'}／Opus {ov or '空'}）", d, ov
        if ikey(d) == ikey(ov): return True, f"刻印（{side}）：2モデル一致", d, ov
        return False, f"刻印（{side}）：2モデルで違う（下書き {d}／Opus {ov}）", d, ov
    sides = set()
    for x in left_after_text:
        if "刻印（表）" in x and "図" in x: sides.add("表")
        if "刻印（裏）" in x and "図" in x: sides.add("裏")
    if "R3" in rules: sides.add("表" if ikey(p["imprint_front"]) in UNKNOWN else "裏")
    for side in sorted(sides):
        ok, why, d, ov = imprint_issue(side)
        (fixed if ok else left).append(why); values[f"刻印_{side}"] = (d, ov)
        if ok: fix_count["刻印 2モデル一致"] += 1
    # 2) 大きさ（図だけ）
    for lab, col in [("長径", "size_long_mm"), ("短径", "size_short_mm"), ("厚さ", "thickness_mm")]:
        if not any(x.startswith(lab) for x in left_after_text): continue
        d = p.get(col); ov = (op or {}).get(col)
        if op is not None and num_eq(d, ov): fixed.append(f"{lab}：2モデル一致"); fix_count["大きさ 2モデル一致"] += 1
        else: left.append(f"{lab}：本文に数字が無く、" + ("Opus の抽出なし" if op is None else f"2モデルで違う（下書き {d or '空'}／Opus {ov or '空'}）")); values[lab] = (d, ov)
    # 3) 空欄（R4）
    if "R4" in rules:
        pages = vr.pages(p["doc_id"]) or []
        if not p["shape"]:
            jp, en = vr.find_shape(pages, name)
            if jp: fixed.append(f"形：性状の文から「{jp}」"); fix_count["形 性状の文から"] += 1; values["形（拾った値）"] = (jp, en)
            elif "カプセル" in name: fixed.append("形：カプセル剤なので長円（oblong）"); fix_count["形 カプセル剤"] += 1; values["形（拾った値）"] = ("カプセル", "oblong")
            elif p["size_long_mm"] not in ("", None) and num_eq(p["size_long_mm"], p["size_short_mm"]): fixed.append("形：長径＝短径なので円形（round）"); fix_count["形 長径＝短径"] += 1; values["形（拾った値）"] = ("円形", "round")
            elif op and op.get("shape"): left.append(f"形：空欄（Opus は {op['shape']}）"); values["形"] = ("", op["shape"])
            else: left.append("形：空欄")
        for lab, col in [("長径", "size_long_mm"), ("短径", "size_short_mm")]:
            if p.get(col) not in ("", None): continue
            ov = (op or {}).get(col)
            if lab == "短径" and "カプセル" in name:
                g = re.search(r"(000|00|[0-5])\s*号", nfkc(" ".join(str(x) for x in [p.get("imprint_note"), (q or {}).get("source_quote"), (op or {}).get("source_quote")] if x)))
                if g: fixed.append(f"短径：{g.group(1)}号から推定 {CAPSULE_MM[g.group(1)]}mm"); fix_count["カプセル短径 号数から推定"] += 1; values["短径（推定）"] = ("", CAPSULE_MM[g.group(1)]); continue
            if ov not in ("", None) and any(vr.has_num(t, ov) for t in pages):
                fixed.append(f"{lab}：Opus の値 {ov}mm が本文にある"); fix_count["空欄の大きさ Opus＋本文"] += 1; values[lab + "（拾った値）"] = ("", ov)
            else: left.append(f"{lab}：空欄" + (f"（Opus は {ov}mm、本文で確かめられない）" if ov not in ("", None) else "")); values[lab] = ("", ov)
    # 4) 照合の残り（根拠の文言が近似・色・不一致など）
    for x in left_after_text:
        if x.startswith(("刻印", "長径", "短径", "厚さ")): continue
        if x == "根拠の文言が近似": fixed.append("根拠の文言が近似（値はそれぞれ本文で照合ずみ）"); fix_count["文言の近似（値は照合ずみ）"] += 1
        else: left.append(x)
    row = {"置き場": s["置き場"], "薬名": name, "今のメーカー": s["今のメーカー"], "状態": s["状態"]}
    if left:
        page = (q or {}).get("found_page") or (q or {}).get("source_page") or p.get("source_page") or 1
        url = f"{p['source_url']}#page={page}"
        draft_vals = "；".join(f"{k}：下書き {a or '空'}" + (f"／Opus {b}" if b not in ('', None) else "") for k, (a, b) in values.items()) or f"刻印 {p['imprint_front']}／{p['imprint_back']}、{p['color']} {p['shape']} {p['size_long_mm']}×{p['size_short_mm']}mm"
        out_left.append({**row, "何が問題か": "；".join(left), "下書きの値": draft_vals, "添付文書の該当ページ": url, "正しい値": "", "機械で片付いた印": "；".join(fixed)})
    else:
        out_done.append({**row, "値の状態": "添付文書で確認（機械）", "片付いた理由": "；".join(fixed), "拾った値": "；".join(f"{k}：{b}" for k, (a, b) in values.items() if b)})

out_left.sort(key=lambda r: (r["置き場"] == "棚", int(re.sub(r"\D", "", r["置き場"].split("／")[0]) or 0), r["薬名"]))
def write(path, rows, cols):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
write(f"{P}/check-sheet-2.csv", out_left, ["置き場", "薬名", "今のメーカー", "状態", "何が問題か", "下書きの値", "添付文書の該当ページ", "正しい値", "機械で片付いた印"])
write(f"{P}/check-sheet-2-machine.csv", out_done, ["置き場", "薬名", "今のメーカー", "状態", "値の状態", "片付いた理由", "拾った値"])

e = H.escape
def table(rs):
    return ("<div class='scroll'><table><thead><tr><th>No.</th><th>薬名</th><th>何が問題か</th><th>下書きの値</th><th>添付文書</th><th>正しい値</th></tr></thead><tbody>" +
            "".join(f"<tr><td class='no'>{e(r['置き場'].replace('カセット ', ''))}</td><td class='name'>{e(r['薬名'])}<br><small>{e(r['状態'])}</small></td>"
                    f"<td class='todo'>{e(r['何が問題か'])}</td><td><small>{e(r['下書きの値'])}</small></td>"
                    f"<td><a href=\"{e(r['添付文書の該当ページ'])}\" target=\"_blank\" rel=\"noopener\">該当ページ</a></td><td class='w'></td></tr>" for r in rs) + "</tbody></table></div>")
cas = [r for r in out_left if r["置き場"] != "棚"]; shelf = [r for r in out_left if r["置き場"] == "棚"]
page = f"""<title>確認表②</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
/* レイアウト：1 カラムの帳票。カセットと棚の 2 つの表 */
:root{{--bg:#f7f8f6;--fg:#1c2128;--muted:#5b6670;--line:#c9cfd4;--head:#e6edf2;--accent:#1f5f8b;--row:#ffffff;--row2:#f1f4f6;--write:#fffbe6;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.5;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}}
main{{max-width:1200px;margin:0 auto;display:grid;gap:24px}} h1{{font-size:1.5rem;margin:0;text-wrap:balance}} h2{{font-size:1.1rem;margin:0 0 6px;border-left:5px solid var(--accent);padding-left:10px}}
.sub{{color:var(--muted);margin:6px 0 0;max-width:70ch}} .count{{color:var(--muted);font-weight:400;font-size:.95rem;margin-left:.4em}} a{{color:var(--accent)}}
.scroll{{overflow-x:auto;min-width:0}} table{{border-collapse:collapse;width:100%;min-width:820px}}
th,td{{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left;font-size:.9rem}} th{{background:var(--head);font-size:.82rem}}
tbody tr:nth-child(even) td{{background:var(--row2)}} tbody tr:nth-child(odd) td{{background:var(--row)}}
td.no{{text-align:center;font-weight:700;width:3em}} td.name{{font-weight:700}} td.todo{{font-weight:700}} small{{color:var(--muted)}} td.w{{background:var(--write)!important;min-width:9em}}
</style>
<main>
<header><h1>確認表 ②　機械で片付かなかった薬</h1>
<p class="sub">{len(out_left)} 件（カセット {len(cas)}、棚 {len(shelf)}）。{len(sheet)} 件のうち {len(out_done)} 件は、本文での照合し直しや、Opus との 2 モデルの一致で片付きました（値の状態は「添付文書で確認（機械）」）。残った薬は、添付文書の該当ページを開いて「正しい値」を書いてください。現物の錠剤で見られるならそれが一番確かです。</p></header>
<section><h2>カセット<span class="count">{len(cas)} 件</span></h2>{table(cas)}</section>
<section><h2>棚（手撒き）<span class="count">{len(shelf)} 件</span></h2>{table(shelf)}</section>
<p class="sub">病院の採用情報を含むため、公開リポジトリには入れていません。</p>
</main>"""
open(f"{P}/check-sheet-2.html", "w", encoding="utf-8").write(page)
counts = {"確認表②（減らす前）": len(sheet), "理由ごと（重複あり）": dict(issue_count.most_common()), "片付いた薬": len(out_done), "片付け方（重複あり）": dict(fix_count.most_common()),
          "残った薬": len(out_left), "残った（カセット）": len(cas), "残った（棚）": len(shelf),
          "残った理由（重複あり）": dict(Counter(re.sub(r"（.*", "", x) for r in out_left for x in r["何が問題か"].split("；")).most_common())}
json.dump(counts, open(f"{P}/check-sheet-2-counts.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(counts, ensure_ascii=False, indent=1))

# 運用マスタ（ops-master.csv）に「値の状態」と理由を書き込む。片付いた薬は「添付文書で確認（機械）」、残った薬は「要確認（確認表②）」
done = {r["薬名"]: r for r in out_done}; left = {r["薬名"]: r for r in out_left}
rows = list(csv.DictReader(open(f"{P}/ops-master.csv", encoding="utf-8-sig"))); cols = list(rows[0].keys())
for c in ("値の状態", "値の状態の理由"):
    if c not in cols: cols.append(c)
for r in rows:
    n = r["今の製品（販売名）"]
    if r.get("状態") == "確認ずみ（現物）": r["値の状態"], r["値の状態の理由"] = "確認ずみ（現物）", ""
    elif n in done: r["値の状態"], r["値の状態の理由"] = "添付文書で確認（機械）", done[n]["片付いた理由"]
    elif n in left: r["値の状態"], r["値の状態の理由"] = "要確認（確認表②）", left[n]["何が問題か"]
    elif r.get("今の製品（販売名）") and not r.get("検査の印"): r["値の状態"], r["値の状態の理由"] = "添付文書の下書き（検査の印なし）", ""
    else: r["値の状態"], r["値の状態の理由"] = r.get("値の状態", ""), r.get("値の状態の理由", "")
write(f"{P}/ops-master.csv", rows, cols)
print("値の状態:", dict(Counter(r["値の状態"] for r in rows)))
