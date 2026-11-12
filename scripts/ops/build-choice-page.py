# 「1 つ選ぶ」確認表を、その場で選べる Artifact のページにする（選んだ答えは Artifact の db に保存され、Claude が読める）。
#   python3 scripts/ops/build-choice-page.py
# 入力：data/private/check-sheet-handwritten.csv（手書きで候補が複数の品目。scripts/ops/link-handwritten.py の出力）、
#       data/private/check-sheet-1.csv（今のメーカーを選ぶ薬。scripts/ops/build-ops-master.py の出力）
# 出力：data/private/answer-choose.html（施設の採用情報を含むので commit しない。非公開の Artifact として出す）
# db の形：collection "answers"、document id ＝ 行の id（手書きの文字／成分・規格・剤形のハッシュ。表を作り直しても答えがずれない）
#   本文 {sheet, drug, item, choice: 選んだ候補の文字, note: メモ, at: ISO 時刻}
import csv, hashlib, html as H, json, os
from collections import OrderedDict

P = "data/private"
def rid(prefix, *parts): return prefix + hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]
def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if os.path.exists(p) and os.path.getsize(p) else []

rows = []
groups = OrderedDict()
for r in load(f"{P}/check-sheet-handwritten.csv"): groups.setdefault(r["手書き"], []).append(r)
for hand, cs in groups.items():
    opts = []
    for c in cs:
        info = "・".join(x for x in [c["剤形"], c["先発・後発"], "すでにカセット・棚にある" if c["すでに運用マスタに"] else "", c["印"]] if x)
        opts.append({"v": c["候補（販売名）"], "info": info})
    rows.append({"id": rid("h", hand), "section": "手書きの品目：製品を 1 つ選ぶ", "drug": hand, "item": "手書きの製品", "label": hand, "hint": "メーカーか剤形が書いていないので、候補が複数あります", "opts": opts})
import re
basis = {(r["成分"], r["規格"], r["剤形"]): r["根拠"] for r in load(f"{P}/ops-master.csv")}
for r in load(f"{P}/check-sheet-1.csv"):
    cands = [x for x in r["候補のメーカー"].split("／") if x]
    opts = [{"v": c, "info": ""} for c in cands]
    if len(cands) > 1: opts.append({"v": "両方使っている", "info": ""})
    else: opts.append({"v": "もう使っていない", "info": "棚の札が古い"})
    hint = "棚の札と手書きでメーカーが違います" if any("手書き" in c for c in cands) else ("前に答えた「" + r["前回の答え（記憶）"] + "」" if r["前回の答え（記憶）"] else
            (f"前に「{m.group(1)}」と答えた薬と販売名の書き方が違い、別の薬に分かれました。この札の製品をまだ使っていますか" if (m := re.search(r"AKI の答え「([^」]+)」", basis.get((r["成分"], r["規格"], r["剤形"]), ""))) else "前の答えがこの札に当たりませんでした"))
    rows.append({"id": rid("m", r["成分"], r["規格"], r["剤形"]), "section": "今のメーカーを 1 つ選ぶ（確認表①）", "drug": f"{r['成分']} {r['規格']}", "item": "今のメーカー",
                 "label": f"{r['成分']} {r['規格']}（{r['剤形'].split('〔')[0]}）", "hint": hint, "opts": opts})

def card(r):
    radios = "".join(
        f"<label class='opt'><input type='radio' name='{r['id']}' id='{r['id']}-{i}' value=\"{H.escape(o['v'])}\"><span><b>{H.escape(o['v'])}</b>"
        + (f"<small>{H.escape(o['info'])}</small>" if o["info"] else "") + "</span></label>" for i, o in enumerate(r["opts"]))
    return (f"<article class='q' data-id='{r['id']}'><div class='qh'><h3>{H.escape(r['label'])}</h3><span class='st'></span></div><p class='hint'>{H.escape(r['hint'])}</p>"
            f"<fieldset><legend class='vh'>{H.escape(r['label'])}</legend>{radios}</fieldset>"
            f"<input class='memo' id='m-{r['id']}' type='text' placeholder='どれでもないときや、補足はここに' aria-label='メモ'></article>")
secs = OrderedDict()
for r in rows: secs.setdefault(r["section"], []).append(r)
body = "".join(f"<section><h2>{H.escape(s)}<span class='count'>{len(rs)} 件</span></h2><div class='grid'>{''.join(card(r) for r in rs)}</div></section>" for s, rs in secs.items())
data = json.dumps([{"id": r["id"], "drug": r["drug"], "item": r["item"]} for r in rows], ensure_ascii=False)

html = f"""<title>採用品の選び直し</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
<style>
/* レイアウト：質問ごとのカード（2 列、狭いと 1 列）。選んだ候補は青く、保存済みのカードは左に緑の帯 */
:root{{--bg:#f6f8f7;--fg:#1c2128;--muted:#5b6670;--line:#cdd4d9;--card:#ffffff;--accent:#1f5f8b;--pick:#e3eef7;--good:#2e7d4f;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#13171b;--fg:#e8ecef;--muted:#a3adb6;--line:#38424a;--card:#1a2025;--accent:#6fb1e0;--pick:#1e3242;--good:#5fbf86;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#13171b;--fg:#e8ecef;--muted:#a3adb6;--line:#38424a;--card:#1a2025;--accent:#6fb1e0;--pick:#1e3242;--good:#5fbf86;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:15px;line-height:1.55;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}}
main{{max-width:1040px;margin:0 auto;display:grid;gap:24px}} h1{{font-size:1.45rem;margin:0;text-wrap:balance}} h2{{font-size:1.08rem;margin:0 0 10px;border-left:5px solid var(--accent);padding-left:10px}}
.sub{{color:var(--muted);margin:6px 0 0;max-width:68ch}} .count{{color:var(--muted);font-weight:400;font-size:.92rem;margin-left:.4em}}
.bar{{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-variant-numeric:tabular-nums}} .bar b{{font-size:1.15rem}} #note{{color:var(--muted)}}
.grid{{display:grid;align-items:start;grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr));gap:14px}}
.q{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;display:grid;gap:8px;min-width:0}} .q.saved{{box-shadow:inset 5px 0 0 var(--good)}}
.qh{{display:flex;justify-content:space-between;gap:8px;align-items:baseline}} h3{{margin:0;font-size:1.05rem}} .st{{color:var(--muted);font-size:.8rem;white-space:nowrap}}
.hint{{margin:0;color:var(--muted);font-size:.88rem}} fieldset{{border:0;margin:0;padding:0;display:grid;gap:6px}} .vh{{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}}
.opt{{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:6px;padding:8px 10px;cursor:pointer}} .opt input{{margin-top:.3em;accent-color:var(--accent)}}
.opt span{{display:grid;min-width:0}} .opt small{{color:var(--muted);font-size:.8rem}} .opt:has(input:checked){{background:var(--pick);border-color:var(--accent)}}
.memo{{font:inherit;font-size:.9rem;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);width:100%;box-sizing:border-box}}
input:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
</style>
<main>
<header><h1>採用品の選び直し</h1>
<p class="sub">手書きで足した品目のうち製品が 1 つに決まらなかったものと、今のメーカーが決まらない薬です。使っているものを 1 つ選んでください（記憶でかまいません。現物で確かめるまでは「記憶ベース」として扱います）。</p>
<div class="bar"><span>選んだ <b id="done">0</b> / {len(rows)}</span><span id="note">保存先に接続しています…</span></div></header>
{body}
<p class="sub">選んだ答えはこのページの保存先に残り、Claude が読み取って運用マスタに反映します。病院の採用情報を含むため、公開リポジトリには入れていません。</p>
</main>
<script>
const ROWS = {data};
const answers = {{}};
let db = null, ro = false;
const note = document.getElementById("note");
function render() {{
  let done = 0;
  for (const r of ROWS) {{
    const a = answers[r.id] || {{}}, card = document.querySelector(`.q[data-id="${{r.id}}"]`);
    card.querySelectorAll("input[type=radio]").forEach(x => {{ x.checked = x.value === a.choice; }});
    const m = document.getElementById("m-" + r.id); if (document.activeElement !== m) m.value = a.note || "";
    const filled = !!(a.choice || a.note); card.classList.toggle("saved", filled);
    if (card.querySelector(".st").textContent !== "保存中…") card.querySelector(".st").textContent = filled ? "保存済み" : "";
    if (filled) done++;
  }}
  document.getElementById("done").textContent = done;
}}
const pending = {{}};
async function save(id, patch) {{
  if (!db || ro) return;
  const r = ROWS.find(x => x.id === id);
  const body = {{ sheet: "採用品の選び直し", drug: r.drug, item: r.item, choice: "", note: "", ...(answers[id] || {{}}), ...patch, at: new Date().toISOString() }};
  answers[id] = body;
  const st = document.querySelector(`.q[data-id="${{id}}"] .st`); st.textContent = "保存中…"; render();
  while (pending[id]) await pending[id];
  pending[id] = db.collection("answers").doc(id).set(body).then(() => {{ st.textContent = "保存済み"; }})
    .catch(e => {{ st.textContent = "保存できず"; ro = true; note.textContent = "この表示では書き込めません。答えは Claude に文字で送ってください。"; }})
    .finally(() => {{ pending[id] = null; }});
}}
document.querySelectorAll(".q").forEach(card => {{
  const id = card.dataset.id;
  card.querySelectorAll("input[type=radio]").forEach(x => x.addEventListener("change", () => save(id, {{ choice: x.value }})));
  const m = document.getElementById("m-" + id);
  m.addEventListener("change", () => {{ if ((answers[id] || {{}}).note !== m.value.trim()) save(id, {{ note: m.value.trim() }}); }});
}});
render();
(async () => {{
  db = await (window.claude?.use?.("db") ?? null);
  if (!db) {{ note.textContent = "この表示では保存できません。答えは Claude に文字で送ってください。"; document.querySelectorAll("input").forEach(x => x.disabled = true); return; }}
  const timer = setTimeout(() => {{ note.textContent = "保存先にまだつながりません。選んだ内容は、つながると保存されます。"; }}, 10000);
  db.collection("answers").onSnapshot(snap => {{
    for (const d of snap.docs) if (d.exists && ROWS.some(r => r.id === d.id)) answers[d.id] = {{ ...d.data() }};
    if (!snap.metadata.fromCache) {{ clearTimeout(timer); note.textContent = "選んだ内容は自動で保存されます。"; }}
    render();
  }}, e => {{ clearTimeout(timer); note.textContent = "保存先が使えません。答えは Claude に文字で送ってください。"; }});
}})();
</script>"""
open(f"{P}/answer-choose.html", "w", encoding="utf-8").write(html)
print(f"選ぶ表 {len(rows)} 件：", {s: len(rs) for s, rs in secs.items()})
