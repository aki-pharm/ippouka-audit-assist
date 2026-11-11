# 機械で片付けた薬（確認表②の machine 分）から無作為に抜き取り、人が答え合わせする「抜き取り表」を data/private/ に作る。commit しない出力のみ。
#   python3 scripts/ops/sample-machine-checks.py [--n 10] [--seed 20261111]
# 選び方：片付いた薬を薬名で並べ（並びを毎回同じにするため）、random.Random(seed).sample で n 件を選ぶ。選んだ薬の「片付いた項目」をすべて並べる。
# 入力：data/private/check-sheet-2-machine-items.csv（reduce-check-sheet-2.py の出力）
# 出力：data/private/sample-machine.csv、sample-machine.html、sample-machine.json（種・件数・選んだ薬）
import csv, json, random, sys, html as H

P = "data/private"
arg = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
N, SEED = arg("--n", 10), arg("--seed", 20261111)
items = list(csv.DictReader(open(f"{P}/check-sheet-2-machine-items.csv", encoding="utf-8-sig")))
drugs = sorted({r["薬名"] for r in items})
picked = random.Random(SEED).sample(drugs, min(N, len(drugs)))
rows = [{"薬名": r["薬名"], "置き場": r["置き場"], "項目": r["項目"], "方法": r["方法"], "機械が決めた値": r["値"], "添付文書の該当ページ": r["添付文書の該当ページ"], "正しい値": "", "合っているか": ""}
        for d in picked for r in items if r["薬名"] == d]
cols = ["薬名", "置き場", "項目", "方法", "機械が決めた値", "添付文書の該当ページ", "正しい値", "合っているか"]
with open(f"{P}/sample-machine.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL); w.writeheader(); w.writerows(rows)
meta = {"乱数の種": SEED, "方法": "片付いた薬を薬名で並べ、Python の random.Random(種).sample で選ぶ", "母数（片付いた薬）": len(drugs), "抜き取った薬": len(picked), "行（項目）": len(rows), "選んだ薬": picked}
json.dump(meta, open(f"{P}/sample-machine.json", "w"), ensure_ascii=False, indent=1)

e = H.escape
trs = "".join(f"<tr><td class='name'>{e(r['薬名'])}<br><small>{e(r['置き場'])}</small></td><td>{e(r['項目'])}<br><small>{e(r['方法'])}</small></td><td class='val'>{e(str(r['機械が決めた値']))}</td>"
              f"<td><a href=\"{e(r['添付文書の該当ページ'])}\" target=\"_blank\" rel=\"noopener\">該当ページ</a></td><td class='w'></td><td class='w ok'></td></tr>" for r in rows)
page = f"""<title>抜き取り表</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
/* レイアウト：1 カラムの帳票。1 つの表 */
:root{{--bg:#f7f8f6;--fg:#1c2128;--muted:#5b6670;--line:#c9cfd4;--head:#e6edf2;--accent:#1f5f8b;--row:#ffffff;--row2:#f1f4f6;--write:#fffbe6;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.5;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}}
main{{max-width:1100px;margin:0 auto;display:grid;gap:20px}} h1{{font-size:1.5rem;margin:0;text-wrap:balance}} .sub{{color:var(--muted);margin:6px 0 0;max-width:70ch}} a{{color:var(--accent)}}
.scroll{{overflow-x:auto;min-width:0}} table{{border-collapse:collapse;width:100%;min-width:760px}}
th,td{{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left;font-size:.9rem}} th{{background:var(--head);font-size:.82rem}}
tbody tr:nth-child(even) td{{background:var(--row2)}} tbody tr:nth-child(odd) td{{background:var(--row)}}
td.name{{font-weight:700}} td.val{{font-weight:700}} small{{color:var(--muted);font-weight:400}} td.w{{background:var(--write)!important;min-width:8em}} td.ok{{min-width:5em}}
</style>
<main>
<header><h1>抜き取り表　機械で片付けた値の答え合わせ</h1>
<p class="sub">機械で片付けた {len(drugs)} 件から、無作為に {len(picked)} 件を選びました（{len(rows)} 項目）。添付文書の該当ページを開き、「正しい値」と「合っているか（○／×）」を書いてください。× が 1 つでもあれば、片付けた残りの薬も見直します。</p>
<p class="sub">選び方：片付いた薬を薬名で並べ、乱数の種 {SEED} で選択（Python の random.Random({SEED}).sample）。同じ種なら同じ 10 件になります。</p></header>
<div class="scroll"><table><thead><tr><th>薬名</th><th>項目（方法）</th><th>機械が決めた値</th><th>添付文書</th><th>正しい値</th><th>合っているか</th></tr></thead><tbody>{trs}</tbody></table></div>
<p class="sub">病院の採用情報を含むため、公開リポジトリには入れていません。</p>
</main>"""
open(f"{P}/sample-machine.html", "w", encoding="utf-8").write(page)
print(json.dumps(meta, ensure_ascii=False))
