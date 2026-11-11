# 抜き取り表と確認表②を、その場で答えを書き込める Artifact のページにする（書き込みは Artifact の db に保存され、Claude が読める）。
#   python3 scripts/ops/build-answer-pages.py
# 入力：data/private/sample-machine.csv、sample-machine.json、check-sheet-2.csv
# 出力：data/private/answer-sample.html、answer-sheet2.html（施設の採用情報を含むので commit しない。非公開の Artifact として出す）
# db の形：collection "answers"、document id ＝ 行の id（薬名＋項目のハッシュ。表を作り直しても答えがずれない）
#   本文 {sheet, drug, item, ok: "○"|"×"|"", correct: 文字列, at: ISO 時刻}
import csv, hashlib, html as H, json

P = "data/private"
def rid(prefix, *parts): return prefix + hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]

def page(title, h1, lead, rows, sections, ok_col):
    """rows: [{id, section, cells:[(label, html)], link, item}]、ok_col：○×の列を出すか"""
    data = json.dumps([{"id": r["id"], "drug": r["drug"], "item": r["item"]} for r in rows], ensure_ascii=False)
    def table(sec):
        rs = [r for r in rows if r["section"] == sec]
        head = "".join(f"<th>{H.escape(l)}</th>" for l, _ in rs[0]["cells"]) if rs else ""
        body = "".join(
            f"<tr data-id='{r['id']}'>" + "".join(f"<td class='{c}'>{v}</td>" for (l, v), c in zip(r["cells"], r["classes"])) +
            f"<td><a href=\"{H.escape(r['link'])}\" target=\"_blank\" rel=\"noopener\">開く</a></td>"
            f"<td class='w'><input id='c-{r['id']}' type='text' aria-label='正しい値' placeholder='正しい値'></td>" +
            (f"<td class='w ok'><div class='seg' role='group' aria-label='合っているか'><button type='button' data-v='○'>○</button><button type='button' data-v='×'>×</button></div></td>" if ok_col else "") +
            "<td class='st'></td></tr>" for r in rs)
        return (f"<section><h2>{H.escape(sec)}<span class='count'>{len(rs)} 件</span></h2><div class='scroll'><table><thead><tr>{head}<th>添付文書</th><th>正しい値</th>" +
                ("<th>合っているか</th>" if ok_col else "") + f"<th></th></tr></thead><tbody>{body}</tbody></table></div></section>")
    return f"""<title>{H.escape(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
/* レイアウト：1 カラムの記入表。上に進み具合、下に表。記入欄は黄色、保存済みの行は左に緑の帯 */
:root{{--bg:#f7f8f6;--fg:#1c2128;--muted:#5b6670;--line:#c9cfd4;--head:#e6edf2;--accent:#1f5f8b;--row:#ffffff;--row2:#f1f4f6;--write:#fffbe6;--good:#2e7d4f;--bad:#b3382c;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;--good:#5fbf86;--bad:#e57368;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#14181c;--fg:#e8ecef;--muted:#a3adb6;--line:#3a434b;--head:#1f272e;--accent:#6fb1e0;--row:#181d22;--row2:#1d2328;--write:#2a2710;--good:#5fbf86;--bad:#e57368;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.5;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}}
main{{max-width:1200px;margin:0 auto;display:grid;gap:22px}} h1{{font-size:1.5rem;margin:0;text-wrap:balance}} h2{{font-size:1.1rem;margin:0 0 6px;border-left:5px solid var(--accent);padding-left:10px}}
.sub{{color:var(--muted);margin:6px 0 0;max-width:70ch}} .count{{color:var(--muted);font-weight:400;font-size:.95rem;margin-left:.4em}} a{{color:var(--accent)}}
.bar{{display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-variant-numeric:tabular-nums}} .bar b{{font-size:1.15rem}} #note{{color:var(--muted)}}
.scroll{{overflow-x:auto;min-width:0}} table{{border-collapse:collapse;width:100%;min-width:860px}}
th,td{{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left;font-size:.9rem}} th{{background:var(--head);font-size:.82rem}}
tbody tr:nth-child(even) td{{background:var(--row2)}} tbody tr:nth-child(odd) td{{background:var(--row)}}
td.no{{text-align:center;font-weight:700;width:3em}} td.name{{font-weight:700}} td.todo{{font-weight:700}} td.val{{font-weight:700}} small{{color:var(--muted);font-weight:400}}
td.w{{background:var(--write)!important}} td.w input{{width:100%;min-width:9em;box-sizing:border-box;font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--fg)}}
.seg{{display:flex;gap:6px}} .seg button{{font:inherit;font-size:1.1rem;width:2.4em;height:2.2em;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}}
.seg button[aria-pressed=true][data-v="○"]{{background:var(--good);color:#fff;border-color:var(--good)}} .seg button[aria-pressed=true][data-v="×"]{{background:var(--bad);color:#fff;border-color:var(--bad)}}
button:focus-visible,input:focus-visible,a:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
tr.saved td:first-child{{box-shadow:inset 4px 0 0 var(--good)}} td.st{{width:4.5em;color:var(--muted);font-size:.8rem;white-space:nowrap}}
</style>
<main>
<header><h1>{H.escape(h1)}</h1><p class="sub">{lead}</p>
<div class="bar"><span>記入済み <b id="done">0</b> / {len(rows)}</span>{"<span>○ <b id='nok'>0</b>　× <b id='nng'>0</b></span>" if ok_col else ""}<span id="note">保存先に接続しています…</span></div></header>
{''.join(table(s) for s in sections)}
<p class="sub">書いた内容はこの表の保存先に残り、Claude が読み取ってマスタに反映します。病院の採用情報を含むため、公開リポジトリには入れていません。</p>
</main>
<script>
const ROWS = {data};
const SHEET = {json.dumps(title, ensure_ascii=False)};
const answers = {{}};
let db = null, ro = false;
const note = document.getElementById("note");
function render() {{
  let done = 0, ok = 0, ng = 0;
  for (const r of ROWS) {{
    const a = answers[r.id] || {{}};
    const tr = document.querySelector(`tr[data-id="${{r.id}}"]`); if (!tr) continue;
    const inp = document.getElementById("c-" + r.id);
    if (document.activeElement !== inp) inp.value = a.correct || "";
    tr.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(a.ok === b.dataset.v)));
    const filled = !!(a.ok || a.correct); tr.classList.toggle("saved", filled);
    tr.querySelector(".st").textContent = filled ? "保存済み" : "";
    if (filled) done++; if (a.ok === "○") ok++; if (a.ok === "×") ng++;
  }}
  document.getElementById("done").textContent = done;
  const a = document.getElementById("nok"), b = document.getElementById("nng"); if (a) a.textContent = ok; if (b) b.textContent = ng;
}}
const pending = {{}};
async function save(id, patch) {{
  if (!db || ro) return;
  const r = ROWS.find(x => x.id === id);
  const body = {{ sheet: SHEET, drug: r.drug, item: r.item, ok: "", correct: "", ...(answers[id] || {{}}), ...patch, at: new Date().toISOString() }};
  answers[id] = body; render();
  const tr = document.querySelector(`tr[data-id="${{id}}"]`); tr.querySelector(".st").textContent = "保存中…";
  while (pending[id]) await pending[id];
  pending[id] = db.collection("answers").doc(id).set(body).then(() => {{ tr.querySelector(".st").textContent = "保存済み"; }})
    .catch(e => {{ tr.querySelector(".st").textContent = "保存できず"; if (e && e.code === "invalid_argument") {{ ro = true; note.textContent = "この表示では書き込めません。答えは Claude に文字で送ってください。"; }} }})
    .finally(() => {{ pending[id] = null; }});
}}
document.querySelectorAll("tr[data-id]").forEach(tr => {{
  const id = tr.dataset.id;
  tr.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {{
    const cur = (answers[id] || {{}}).ok; save(id, {{ ok: cur === b.dataset.v ? "" : b.dataset.v }});
  }}));
  const inp = document.getElementById("c-" + id);
  inp.addEventListener("change", () => {{ if ((answers[id] || {{}}).correct !== inp.value.trim()) save(id, {{ correct: inp.value.trim() }}); }});
}});
render();
(async () => {{
  db = await (window.claude?.use?.("db") ?? null);
  if (!db) {{ note.textContent = "この表示では保存できません。答えは Claude に文字で送ってください。"; document.querySelectorAll("input,.seg button").forEach(x => x.disabled = true); return; }}
  const timer = setTimeout(() => {{ note.textContent = "保存先にまだつながりません。書いた内容は、つながると保存されます。"; }}, 10000);
  db.collection("answers").onSnapshot(snap => {{
    for (const d of snap.docs) if (d.exists && ROWS.some(r => r.id === d.id)) answers[d.id] = {{ ...d.data() }};
    if (!snap.metadata.fromCache) {{ clearTimeout(timer); note.textContent = "書いた内容は自動で保存されます。"; }}
    render();
  }}, e => {{ clearTimeout(timer); note.textContent = "保存先が使えません。答えは Claude に文字で送ってください。"; }});
}})();
</script>"""

# ---------- 抜き取り表 ----------
meta = json.load(open(f"{P}/sample-machine.json", encoding="utf-8"))
srows = []
for r in csv.DictReader(open(f"{P}/sample-machine.csv", encoding="utf-8-sig")):
    srows.append({"id": rid("s", r["薬名"], r["項目"]), "section": "抜き取り（機械で片付けた値）", "drug": r["薬名"], "item": r["項目"], "link": r["添付文書の該当ページ"],
                  "cells": [("薬名", f"{H.escape(r['薬名'])}<br><small>{H.escape(r['置き場'])}</small>"), ("項目（方法）", f"{H.escape(r['項目'])}<br><small>{H.escape(r['方法'])}</small>"), ("機械が決めた値", H.escape(str(r['機械が決めた値'])))],
                  "classes": ["name", "", "val"]})
lead = (f"機械で片付けた {meta['母数（片付いた薬）']} 件から無作為に {meta['抜き取った薬']} 件（{len(srows)} 項目）を選びました。「開く」で添付文書の該当ページを開き、機械が決めた値が合っていれば ○、違えば × を押して、× のときは正しい値を書いてください。"
        f"選び方：薬名で並べ、乱数の種 {meta['乱数の種']} で選択（Python の random.Random({meta['乱数の種']}).sample）。")
open(f"{P}/answer-sample.html", "w", encoding="utf-8").write(page("抜き取り表", "抜き取り表　機械で片付けた値の答え合わせ", H.escape(lead), srows, ["抜き取り（機械で片付けた値）"], True))

# ---------- 確認表② ----------
crows = []
for r in csv.DictReader(open(f"{P}/check-sheet-2.csv", encoding="utf-8-sig")):
    sec = "カセット" if r["置き場"] != "棚" else "棚（手撒き・急ぎません）"
    crows.append({"id": rid("k", r["薬名"], r["何が問題か"]), "section": sec, "drug": r["薬名"], "item": r["何が問題か"], "link": r["添付文書の該当ページ"],
                  "cells": [("No.", H.escape(r["置き場"].replace("カセット ", "") if r["置き場"] != "棚" else "棚")), ("薬名", f"{H.escape(r['薬名'])}<br><small>{H.escape(r['状態'])}</small>"),
                            ("何が問題か", H.escape(r["何が問題か"])), ("下書きの値", f"<small>{H.escape(r['下書きの値'])}</small>")],
                  "classes": ["no", "name", "todo", ""]})
ncas = sum(1 for r in crows if r["section"] == "カセット")
lead2 = (f"機械で片付かなかった {len(crows)} 件（カセット {ncas}、棚 {len(crows) - ncas}）。カセットから先に並べています。「開く」で添付文書の該当ページを開くか、現物の錠剤を見て、正しい値を書いてください。"
         "刻印が無ければ「なし」、割線だけなら「割線」。棚の分は急ぎません。")
open(f"{P}/answer-sheet2.html", "w", encoding="utf-8").write(page("確認表②", "確認表②　機械で片付かなかった薬", H.escape(lead2), crows, ["カセット", "棚（手撒き・急ぎません）"], False))
print(f"抜き取り表 {len(srows)} 行、確認表② {len(crows)} 行（カセット {ncas}）")
