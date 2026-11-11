# 確認表 ②（検査の印がある薬の現物確認）を data/private/ に作る。commit しない。
#   python3 scripts/ops/build-check-sheet-2.py
# 入力：data/private/ops-master.csv（scripts/ops/build-ops-master.py の出力）
# 出力：data/private/check-sheet-2.csv、check-sheet-2.html
#
# 対象：今のメーカーが決まっていて、検査の印（照合の「目で見る」、品質 R1〜R4、照合不能）がある薬。
#       現物で確認ずみのもの、一包化しない印のものは除く。「両方使用」は今の製品が 1 つに決まらないので除く。
# 並び：カセット（番号順）→ 棚（成分順）。どちらも、照合の優先度「高」を先に。
# 確かめることは、検査の理由を現場の言葉に直したもの（表の刻印／裏の刻印／大きさ／形／色／添付文書全体）。
# 施設の品目名などはこのスクリプトに書かない。
import csv, re, html as H

P = "data/private"
rows = list(csv.DictReader(open(f"{P}/ops-master.csv", encoding="utf-8-sig")))

def todo(r):
    """検査の理由 → 現場で確かめること"""
    t = []
    why = r["照合の理由"] + "；" + r["検査の印"]
    if r["刻印_表"] in ("", "未確認") or "刻印（表）" in why: t.append("表の刻印")
    if r["刻印_裏"] in ("", "未確認") or "刻印（裏）" in why or "R3" in r["品質"]: t.append("裏の刻印")
    if re.search(r"長径|短径|厚さ", why) or ("R4" in r["品質"] and r["長径mm"] in ("", None)): t.append("大きさ")
    if "R4" in r["品質"] and not r["形"]: t.append("形")
    if "R1" in r["品質"]: t.append("大きさ（値が範囲外）")
    if "R2" in r["品質"]: t.append("色・形（抽出ごとに違う）")
    if "色の表現" in why: t.append("色")
    if "根拠の文言" in why or "照合不能" in why: t.append("添付文書と全体を見比べる")
    return "・".join(dict.fromkeys(t)) or "全体"

def priority(r):
    if "（高）" in r["検査の印"]: return "高"
    if "（中）" in r["検査の印"] or r["品質"]: return "中"
    return "低"

target = [r for r in rows if r["今の製品（販売名）"] and r["検査の印"] and r["状態"] != "確認ずみ（現物）" and "一包化しない" not in r["印"]]
def place(r): return f"カセット {r['カセット番号']}" if r["カセット番号"] else "棚"
def sort_key(r):
    cas = r["カセット番号"].split("／")[0] if r["カセット番号"] else ""
    return (0 if cas else 1, {"高": 0, "中": 1, "低": 2}[priority(r)], int(cas) if cas.isdigit() else 0, r["成分"])
target.sort(key=sort_key)

cols = ["置き場", "優先", "今の製品（販売名）", "今のメーカー", "状態", "確かめること", "親マスタの刻印 表", "親マスタの刻印 裏", "色", "形", "長径mm",
        "記入：棚・カセットの中身は今の製品と同じ？", "記入：刻印 表", "記入：刻印 裏", "記入：メモ"]
out = []
for r in target:
    out.append({"置き場": place(r), "優先": priority(r), "今の製品（販売名）": r["今の製品（販売名）"], "今のメーカー": r["今のメーカー"], "状態": r["状態"],
                "確かめること": todo(r), "親マスタの刻印 表": r["刻印_表"], "親マスタの刻印 裏": r["刻印_裏"], "色": r["色"], "形": r["形"], "長径mm": r["長径mm"],
                "記入：棚・カセットの中身は今の製品と同じ？": "", "記入：刻印 表": "", "記入：刻印 裏": "", "記入：メモ": ""})
with open(f"{P}/check-sheet-2.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL); w.writeheader(); w.writerows(out)

e = H.escape
def table(rs):
    trs = "".join(
        f"<tr class='p{e(r['優先'])}'><td class='no'>{e(r['置き場'].replace('カセット ', ''))}</td><td class='pri'>{e(r['優先'])}</td>"
        f"<td class='name'>{e(r['今の製品（販売名）'])}<br><small>{e(r['状態'])}</small></td><td class='todo'>{e(r['確かめること'])}</td>"
        f"<td>{e(r['親マスタの刻印 表'])}<br><small>裏 {e(r['親マスタの刻印 裏'])}</small></td><td>{e(r['色'])}<br><small>{e(r['形'])} {e(str(r['長径mm']))}{'mm' if r['長径mm'] else ''}</small></td>"
        f"<td class='w'></td><td class='w'></td><td class='w'></td></tr>" for r in rs)
    return ("<div class='scroll'><table><thead><tr><th>No.</th><th>優先</th><th>今の製品</th><th>確かめること</th><th>添付文書の刻印</th><th>色・形・長径</th>"
            "<th>中身は同じ？</th><th>刻印 表</th><th>刻印 裏</th></tr></thead><tbody>" + trs + "</tbody></table></div>")
cas = [r for r in out if r["置き場"] != "棚"]; shelf = [r for r in out if r["置き場"] == "棚"]
page = f"""<title>確認表②</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
/* レイアウト：1 カラムの帳票。カセットと棚の 2 つの表。優先「高」の行に左の帯 */
:root{{--bg:#f7f8f6;--fg:#1c2128;--muted:#5b6670;--line:#c9cfd4;--head:#e6edf2;--accent:#1f5f8b;--row:#ffffff;--row2:#f1f4f6;--write:#fffbe6;--hi:#c0392b;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;--hi:#e57368;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;--hi:#e57368;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.5;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}}
main{{max-width:1200px;margin:0 auto;display:grid;gap:24px}} h1{{font-size:1.5rem;margin:0;text-wrap:balance}} h2{{font-size:1.1rem;margin:0 0 6px;border-left:5px solid var(--accent);padding-left:10px}}
.sub{{color:var(--muted);margin:6px 0 0;max-width:70ch}} .count{{color:var(--muted);font-weight:400;font-size:.95rem;margin-left:.4em}}
.scroll{{overflow-x:auto;min-width:0}} table{{border-collapse:collapse;width:100%;min-width:900px;font-variant-numeric:tabular-nums}}
th,td{{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left;font-size:.9rem}} th{{background:var(--head);font-size:.82rem;letter-spacing:.02em}}
tbody tr:nth-child(even) td{{background:var(--row2)}} tbody tr:nth-child(odd) td{{background:var(--row)}}
td.no{{text-align:center;font-weight:700;width:3em}} td.pri{{text-align:center;width:2.5em}} tr.p高 td.pri{{color:var(--hi);font-weight:700;box-shadow:inset 4px 0 0 var(--hi)}}
td.name{{font-weight:700}} td.name small{{font-weight:400;color:var(--muted)}} td.todo{{font-weight:700}} small{{color:var(--muted)}} td.w{{background:var(--write)!important;min-width:6.5em}}
</style>
<main>
<header><h1>確認表 ②　検査で印が付いた薬の現物確認</h1>
<p class="sub">{len(out)} 件（カセット {len(cas)}、棚 {len(shelf)}）。添付文書から作った値に、刻印が読めない・大きさが無いなどの印が付いた薬です。今のメーカーの錠剤を見て、まず棚やカセットの中身が「今の製品」と同じかを確かめ、「確かめること」の欄の項目を書いてください。刻印が無ければ「なし」、割線だけなら「割線」。優先「高」は添付文書と値が食い違っている可能性があるものです。</p></header>
<section><h2>カセット<span class="count">{len(cas)} 件</span></h2>{table(cas)}</section>
<section><h2>棚（手撒き）<span class="count">{len(shelf)} 件</span></h2>{table(shelf)}</section>
<p class="sub">病院の採用情報を含むため、公開リポジトリには入れていません。</p>
</main>"""
open(f"{P}/check-sheet-2.html", "w", encoding="utf-8").write(page)
from collections import Counter
print(f"確認表② {len(out)} 件（カセット {len(cas)}、棚 {len(shelf)}）", dict(Counter(r["優先"] for r in out)))
print("確かめること:", Counter(x for r in out for x in r["確かめること"].split("・")).most_common())
