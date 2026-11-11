# 運用マスタ（施設の採用品）を data/private/ に作る。commit しない。
#   python3 scripts/ops/build-ops-master.py
#
# 形：成分・規格・剤形が軸（1 行＝1 つの薬）。その薬の「今のメーカー」を 1 つ指す。
#   今のメーカーの決め方（上から順）：
#     1. 現物で確認ずみの製品（data/master.json の verified）がある → それ。状態「確認ずみ（現物）」
#     2. AKI が答えている → その製品。状態は答えの「状態」列（記憶ベース／写真で確認（箱・PTP））。
#        写真で箱や PTP を見たものはメーカーが確かだが、刻印は錠剤そのものを見ていないので、確認ずみ（現物）にはしない
#     3. 棚・カセットの札から読み取った製品が 1 つだけ → それ。状態「札の読み取り（未確認）」
#     4. 候補が複数で決まらない → 空欄。状態「未選択」 → 確認表 ①（今のメーカーを 1 つ選ぶ表）に出す
#   刻印・色・大きさは、今のメーカーの製品の親マスタ（添付文書由来）から取る。記憶では入れない。
#
# 入力：data/private/adoption-draft.csv（棚の札）、data/private/cassette-list.csv（カセットの札＋AKI の答え）、
#       data/parent/parent-master.json、data/parent/naifuku-tablets-*.csv（成分名）、
#       data/parent/verify/quote-check.csv と verify/claude-haiku-5-5/quote-check.csv（照合）、reports/check-parent*.csv（品質）、data/master.json
# 出力（すべて data/private/）：
#   ops-master.csv       … 1 行＝1 つの薬（成分・規格・剤形）。今のメーカーと、その製品の外観・検査の印
#   ops-products.csv     … 採用品を製品ごとに 1 行（棚・カセットの札、AKI の答え、親マスタの外観、検査の印）
#   ops-alternatives.csv … 同じ薬の、採用していない他社製品（候補。下書きのまま）
#   ops-unlinked.csv     … 親マスタにつながらなかった札と理由
#   check-sheet-1.csv/.html … 確認表 ①：今のメーカーを 1 つ選ぶ表（AKI が記憶で選んで返す）
#   ops-counts.json      … 件数
# 施設の品目名・カセット番号などは、このスクリプトには書かない。
import csv, json, os, re, sys, unicodedata, html as H
from collections import defaultdict, Counter

P = "data/private"
TODAY = "2026-11-10"

def load(p): return list(csv.DictReader(open(p, encoding="utf-8-sig"))) if os.path.exists(p) else []
def norm(s): return re.sub(r"[\s・･®（）()「」]", "", unicodedata.normalize("NFKC", s or "")).lower()
def maker_of(label):
    m = re.search(r"「([^」]+)」", unicodedata.normalize("NFKC", label or "")); return m.group(1) if m else ""
# 剤形・放出の印は data/parent/form-markers.json に 1 つだけ置き、lib/makers.ts・scripts/build-maker-index.cjs と共有する。
# 手順も 3 か所で同じ（変えるときは 3 か所とも）。迷ったら分ける：CR・L・R・SR・TR・徐放・腸溶・OD などの印が違えば別の薬
MARKERS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/parent/form-markers.json"), encoding="utf-8"))
def _is_latin(w): return re.fullmatch(r"[A-Za-z]+", w) is not None
def parse_form(name):
    """販売名 → (剤形, 放出の印があるか)。lib/makers.ts の parseForm と同じ"""
    M = MARKERS
    full = re.sub(r"「[^」]*」", "", unicodedata.normalize("NFKC", name or ""))
    m = re.sub(r"[（(][^）)]*[）)]", "", full)
    film = m.find("ODフィルム")
    if film >= 0: idx, base = film, "ODフィルム"
    else:
        hits = sorted([(i, b) for i, b in [(m.find("カプセル"), "カプセル"), (m.find("錠"), "錠")] if i >= 0])
        if not hits: return "その他", False
        idx, base = hits[0]
    allw = M["od"] + M["release"] + M["other"]
    latin = {w for w in allw if _is_latin(w)}
    words = sorted([w for w in allw if not _is_latin(w)], key=len, reverse=True)
    tokens = []
    pre = m[:idx]
    if base != "ODフィルム":
        while True:
            while pre and pre[-1] in M["separators"]: pre = pre[:-1]
            lm = re.search(r"[A-Za-z]+$", pre)
            if lm:
                w = lm.group(0); before = pre[: -len(w)]
                if re.search(r"\d$", before, re.ASCII) or w in M["salt"] or (w not in latin and tokens): break
                tokens.append(w); pre = before; continue
            jw = next((w for w in words if pre.endswith(w)), None)
            if not jw: break
            tokens.append(jw); pre = pre[: -len(jw)]
    label = ["OD" if t in M["od"] else M["rename"].get(t, t) for t in reversed(tokens)]
    for w in reversed(M["anywhere"]):
        if w in full and w not in label: label.insert(0, w)
    rest = m[idx + len(base):]
    s1 = (re.match(r"[A-Za-z]+", rest) or [""])[0]
    m2 = re.search(r"\d([A-Za-zμ]+)\s*$", rest, re.ASCII)
    s2 = re.sub(r"^(mg|μg|ug|mcg|g)", "", m2.group(1)) if m2 else ""
    release = any(t in M["release"] for t in label)
    # 放出の印があるときは、印の前の名前（デパケン／セレニカ）も剤形に入れる（lib/makers.ts と同じ。迷ったら分ける）
    stem = re.sub(r"[\s・･\-‐‑‒–—−]", "", pre) if release else ""
    return "".join(label) + base + s1 + (f"〔{stem}〕" if stem else "") + ("/" + s2 if s2 else ""), release
def form_of(name): return parse_form(name)[0]
def drug_form(group, name, yj):
    """鍵に使う剤形。YJ の 8 桁目が徐放（G・N）・腸溶（H）で、販売名に放出の印が無いときだけ「|YJ徐放」などを足す（lib/makers.ts の drugKey と同じ）"""
    f, release = parse_form(name); y = yj or ""
    if len(y) >= 8 and y[:7] == (group or "")[:7] and y[7] in MARKERS["yj"] and not release: return f"{f}|YJ{MARKERS['yj'][y[7]]}"
    return f
# 規格：単位 mg を落とし、小数の末尾の 0 をそろえる（1.0mg と 1mg を同じに）。mg・ug は最初の 1 つだけ（lib/makers.ts と同じ）
def strength_key(s):
    # 「1錠中アミトリプチリン塩酸塩10mg」のような、成分 1 つの書き方は量だけにそろえる（lib/makers.ts と同じ）
    n = re.sub(r"^1(錠|カプセル)中に?[^\d]*?(\d+(?:\.\d+)?)(mg|μg|g)(として)?$", lambda x: x.group(2) + x.group(3), norm(s), flags=re.ASCII)
    k = re.sub(r"(\d+)\.(\d*?)0+(?!\d)", lambda x: f"{x.group(1)}.{x.group(2)}" if x.group(2) else x.group(1), n, flags=re.ASCII)
    return k.replace("mg", "", 1).replace("ug", "μg", 1)
def legacy_form_of(name):
    """剤形の分け方を変える前（11/10）の剤形。確認表①の前の答え（maker-answers.csv）を探すときだけ使う"""
    n = unicodedata.normalize("NFKC", name or "")
    if "ODフィルム" in n: return "ODフィルム"
    if "OD錠" in n or "口腔内崩壊" in n: return "OD錠"
    if "カプセル" in n: return "カプセル"
    if "チュアブル" in n: return "チュアブル錠"
    if "錠" in n: return "錠"
    return "その他"
def legacy_strength_key(s): return norm(s).replace("mg", "").replace("ug", "μg")
def stem(name):
    """販売名から成分らしい部分（メーカー・規格・剤形を除く）"""
    n = unicodedata.normalize("NFKC", name)
    n = re.sub(r"「.*?」|\(.*?\)|（.*?）", "", n)
    n = re.split(r"OD錠|錠|カプセル|配合錠|チュアブル|ODフィルム", n)[0]
    return re.sub(r"\d+(\.\d+)?\s*(mg|μg|ug|g|単位)?$", "", n).strip()

# --keys：鍵だけを出す（scripts/build-maker-index.cjs が lib/makers.ts と同じかを確かめる。施設のデータは読まない）
#   標準入力 [[成分・剤形コード, 規格, 販売名, YJコード], ...] → 標準出力 ["成分・剤形コード|規格|剤形", ...]
if "--keys" in sys.argv:
    rows = json.load(sys.stdin)
    json.dump(["|".join([g, strength_key(st), drug_form(g, n, y)]) for g, st, n, y in rows], sys.stdout, ensure_ascii=False)
    sys.exit(0)

# ---------- 親マスタ・成分名・運用マスタ（確認ずみ） ----------
pm = json.load(open("data/parent/parent-master.json", encoding="utf-8"))["products"]
PM = {p["product_key"]: p for p in pm}
generic_by_yj = {}
for f in sorted(os.listdir("data/parent")):
    if f.startswith("naifuku-tablets-") and f.endswith(".csv"):
        for r in load(os.path.join("data/parent", f)): generic_by_yj[r["yj_code"]] = r["generic_name"]
master = {norm(m["brand_name"]): m for m in json.load(open("data/master.json", encoding="utf-8"))}
verified = {k for k, m in master.items() if m.get("status") == "verified"}

# ---------- 検査の印（照合・品質） ----------
qc = defaultdict(list)
for src, keyf in [("data/parent/verify/quote-check.csv", lambda r: ("yj", r["yj"])), ("data/parent/verify/claude-haiku-5-5/quote-check.csv", lambda r: ("name", norm(r["product_name"])))]:
    for r in load(src):
        v = "照合不能" if r["quote"] == "照合不能" else ("目で見る" if r["priority"] else "通った")
        qc[keyf(r)].append((v, r["priority"], r["review_reason"] or r["reason"], r["product_name"]))
cp = defaultdict(list)
for r in load("reports/check-parent.csv"): cp[("yj", r["yj_code"])].append(r["rules"])
for r in load("reports/check-parent-claude-haiku-5-5.csv"): cp[("name", norm(r["brand_name"]))].append(r["rules"])
def key_of(p): return ("yj", p["yj_code"]) if p["draft_model"] == "claude-sonnet-5-5" else ("name", norm(p["brand_name"]))
def verify_of(p):
    rows = qc.get(key_of(p), [])
    if not rows: return ("", "", "")
    same = [x for x in rows if norm(x[3]) == norm(p["brand_name"])] or rows
    w = sorted(same, key=lambda x: {"照合不能": 0, "目で見る": 1, "通った": 2}[x[0]])[0]
    return w[0], w[1], w[2]
def rules_of(p): return " ".join(sorted({x for xs in cp.get(key_of(p), []) for x in xs.split()}))
def marks_of(p):
    v, pri, why = verify_of(p); rules = rules_of(p); m = []
    if v == "目で見る": m.append(f"照合：目で見る（{pri}）{why}")
    if v == "照合不能": m.append(f"照合不能：{why}")
    if rules: m.append(f"品質：{rules}")
    if p["flags"]: m.append("印：" + "・".join(p["flags"]))
    return v, why if v != "通った" else "", rules, "；".join(m)

# ---------- 採用品（札）を製品に集める ----------
shelf = [r for r in load(f"{P}/adoption-draft.csv") if r["棚のラベル（読み取り）"]]
cas = [r for r in load(f"{P}/cassette-list.csv") if r["ラベル（読み取り）"] and r["カセット番号"]]
items, unlinked = {}, []
def take(key, src, r, label):
    if key not in PM:
        unlinked.append((src, label, r["突き合わせ"] or "候補なし")); return None
    it = items.setdefault(key, {"shelf": [], "cas": [], "cas_no": [], "aki": [], "ambig": False, "conf": []})
    if r["突き合わせ"].startswith("名前だけ") or ("件" in r["突き合わせ"]): it["ambig"] = True
    it["conf"].append(r["確度"]); return it
for r in shelf:
    it = take(r["親マスタの候補（販売名）"], "棚", r, r["棚のラベル（読み取り）"])
    if it: it["shelf"].append(r["棚のラベル（読み取り）"])
for r in cas:
    it = take(r["親マスタの候補（販売名）"], "カセット", r, r["ラベル（読み取り）"])
    if it:
        it["cas"].append(r["ラベル（読み取り）"]); it["cas_no"].append(r["カセット番号"])
        if r.get("現物のメーカー（AKI）"): it["aki"].append(r["現物のメーカー（AKI）"])

products = []
for key, it in items.items():
    p = PM[key]; v, why, rules, marks = marks_of(p)
    products.append({
        "product_key": key, "販売名": p["brand_name"], "メーカー": p["maker"], "YJコード": p["yj_code"], "成分・剤形コード": p["group"], "規格": p["strength"], "剤形": drug_form(p["group"], p["brand_name"], p["yj_code"]),
        "採用": "棚＋カセット" if it["shelf"] and it["cas"] else ("カセット" if it["cas"] else "棚"),
        "カセット番号": "／".join(it["cas_no"]), "棚の札": "／".join(it["shelf"]), "カセットの札": "／".join(it["cas"]), "AKI の答え（記憶）": "；".join(dict.fromkeys(it["aki"])),
        "現物確認": "確認ずみ（現物）" if norm(p["brand_name"]) in verified else "",
        "刻印_表": p["imprint_front"], "刻印_裏": p["imprint_back"], "色": p["color"], "形": p["shape"], "長径mm": p["size_long_mm"], "短径mm": p["size_short_mm"], "大きさの出どころ": p["size_source"],
        "親マスタの状態": p["status"], "検査の下書き": p["draft_model"], "照合": v or "（検査なし）", "照合の理由": why, "品質": rules, "印": "・".join(p["flags"]), "検査の印": marks,
        "候補が複数": "複数（要選択）" if it["ambig"] else "", "読み取りの確度": "".join(sorted(set(it["conf"]))), "添付文書": p["source_url"], "備考": p["notes"],
    })
products.sort(key=lambda r: (r["成分・剤形コード"], strength_key(r["規格"]), r["剤形"], r["販売名"]))

# ---------- 薬（成分・規格・剤形）ごとにまとめ、今のメーカーを 1 つ決める ----------
by_drug = defaultdict(list)
for r in products: by_drug[(r["成分・剤形コード"], strength_key(r["規格"]), r["剤形"])].append(r)
all_by_drug = defaultdict(list)
for p in pm:
    if p["status"] != "none": all_by_drug[(p["group"], strength_key(p["strength"]), drug_form(p["group"], p["brand_name"], p["yj_code"]))].append(p)

def maker_label(r): return maker_of(r["販売名"]) or f"（先発）{stem(r['販売名'])}"
# AKI の言い方（カタカナ）と、親マスタのメーカー名（漢字）や販売名の略号の対応。答えを製品に結びつけるときだけ使う
MAKER_ALIAS = {"サワイ": ["沢井", "sw"], "トーワ": ["東和"], "ニチイコウ": ["日医工"], "オーハラ": ["大原"], "ニッシン": ["日新"], "ケミファ": ["ケミファ"], "ニプロ": ["ニプロ", "np"]}
def maker_matches(ans, c):
    a = norm(ans); ml = norm(maker_of(c["販売名"])); mk = norm(c["メーカー"])
    if a and (a == ml or a in mk): return True
    for k, vs in MAKER_ALIAS.items():
        if a == norm(k) or a in [norm(v) for v in vs]:
            if ml in [norm(v) for v in vs] or any(norm(v) in mk for v in vs): return True
    return False
def pick_by_memory(answers, cands):
    """AKI の答え（例：「日新」「後発（…錠）」「DSEP（AKI：…）」）に合う製品を候補から探す"""
    for a in answers:
        a0 = unicodedata.normalize("NFKC", a)
        if "わからない" in a0 or "同じでは" in a0: continue
        head = re.split(r"[（(；　 ]", a0)[0]  # 「日新」「後発」「トーワ」…
        for c in cands:
            if head and (norm(head) == norm(maker_of(c["販売名"])) or norm(head) in norm(c["販売名"]) or norm(head) in norm(c["メーカー"])): return c, a
        m = re.search(r"[（(]([^）)]+)[）)]", a0)  # 「後発（アジルサルタン錠20mg）」の中身
        if m:
            for c in cands:
                if norm(m.group(1)) in norm(c["販売名"]): return c, a
    return None, ""

# AKI が確認表①で答えた「今のメーカー」（data/private/maker-answers.csv：成分・規格・剤形 → 答え）。答えは
#   「YD」のようなメーカー名／「（先発）プレドニン」のような先発名／「両方」（2 つとも使っている。1 つに決めない）
answers_by_drug, answers_legacy = {}, {}
for r in load(f"{P}/maker-answers.csv"):
    answers_by_drug[(norm(r["成分"]), strength_key(r["規格"]), r["剤形"])] = r
    answers_legacy[(norm(r["成分"]), legacy_strength_key(r["規格"]), r["剤形"])] = r
def product_as(p):
    """親マスタの製品を、製品ごとの行と同じ形にする（札からは採用されていないが、AKI の答えで指された製品のため）"""
    v, why, rules, marks = marks_of(p)
    return {"product_key": p["product_key"], "販売名": p["brand_name"], "メーカー": p["maker"], "YJコード": p["yj_code"], "成分・剤形コード": p["group"], "規格": p["strength"], "剤形": drug_form(p["group"], p["brand_name"], p["yj_code"]),
            "採用": "AKI の答え（札には無い）", "カセット番号": "", "棚の札": "", "カセットの札": "", "AKI の答え（記憶）": "", "現物確認": "",
            "刻印_表": p["imprint_front"], "刻印_裏": p["imprint_back"], "色": p["color"], "形": p["shape"], "長径mm": p["size_long_mm"], "短径mm": p["size_short_mm"], "大きさの出どころ": p["size_source"],
            "親マスタの状態": p["status"], "検査の下書き": p["draft_model"], "照合": v or "（検査なし）", "照合の理由": why, "品質": rules, "印": "・".join(p["flags"]), "検査の印": marks,
            "候補が複数": "", "読み取りの確度": "", "添付文書": p["source_url"], "備考": p["notes"]}
def pick_by_answer(ans, rs, dk):
    a = unicodedata.normalize("NFKC", ans)
    if a.startswith("両方"): return "両方", None
    pool = rs + [product_as(p) for p in all_by_drug.get(dk, []) if p["product_key"] not in {r["product_key"] for r in rs}]
    if a.startswith("（先発）") or a.startswith("(先発)"):
        name = a[4:]
        for c in pool:
            if not maker_of(c["販売名"]) and norm(name) in norm(c["販売名"]): return c, None
        return None, None
    for c in pool:
        if maker_matches(a, c): return c, None
    return None, None

rows, sheet1 = [], []
for dk, rs in by_drug.items():
    group, sk, form = dk
    cands = rs
    generic = next((generic_by_yj[r["YJコード"]] for r in rs if r["YJコード"] in generic_by_yj), "") or stem(rs[0]["販売名"])
    strength = rs[0]["規格"]
    answers = [a for r in rs for a in r["AKI の答え（記憶）"].split("；") if a]
    cur, state, basis = None, "", ""
    v = [r for r in rs if r["現物確認"]]
    ans = answers_by_drug.get((norm(generic), sk, form))
    legacy_ans = False
    if not ans:
        # 11/10 の答えは、剤形の分け方を変える前（CR・L・D錠などを分けていなかった）の剤形で書かれている。
        # 前の分け方の鍵で引けたら使うが、「要再確認」をつける（分けた後の薬に同じ答えが当たるため）
        ans = answers_legacy.get((norm(generic), legacy_strength_key(strength), legacy_form_of(rs[0]["販売名"])))
        legacy_ans = bool(ans)
    if v: cur, state, basis = v[0], "確認ずみ（現物）", "運用マスタ（実物の写真）"
    elif ans:
        c, _ = pick_by_answer(ans["今のメーカー（AKI の答え）"], rs, dk)
        if c == "両方": cur, state, basis = None, "記憶ベース（両方使用）", f"AKI の答え（確認表①）：両方。{ans['備考']}"
        elif c: cur, state, basis = c, (ans.get("状態") or "記憶ベース"), f"AKI の答え（確認表①）：{ans['今のメーカー（AKI の答え）']}" + (f"。{ans['備考']}" if ans["備考"] else "")
        else: cur, state, basis = None, "未選択", f"AKI の答え「{ans['今のメーカー（AKI の答え）']}」に合う製品が親マスタに無い（PMDA の一覧に無い＝販売中止の可能性。正式名を確認）"
        if legacy_ans: basis += "（剤形の分け方を変える前の答え。徐放・口腔内崩壊などの違いを要再確認）"
    else:
        c, a = pick_by_memory(answers, rs)
        if c: cur, state, basis = c, "記憶ベース", f"AKI の答え：{a}"
        elif len(rs) == 1: cur, state, basis = rs[0], "札の読み取り（未確認）", "棚・カセットの札が 1 つだけ"
        else: cur, state, basis = None, "未選択", f"候補 {len(rs)}" + ("、AKI の答えが候補に合わない：" + "／".join(answers) if answers else "")
    if state == "記憶ベース（両方使用）":
        both = [x for x in rs if maker_label(x) in ans["備考"] or stem(x["販売名"]) in ans["備考"]] or rs
        cand_both = "・".join(maker_label(x) for x in both)
    cas_no = "／".join(sorted({n for r in rs for n in r["カセット番号"].split("／") if n}, key=lambda x: int(x) if x.isdigit() else 9999))
    cand_txt = "／".join(f"{maker_label(r)}（{r['採用']}）" for r in rs)
    other = [p for p in all_by_drug.get(dk, []) if p["product_key"] not in {r["product_key"] for r in rs}]
    row = {
        "成分": generic, "規格": strength, "剤形": form, "成分・剤形コード": group,
        "採用": "／".join(sorted({r["採用"] for r in rs})), "分包方法": "カセット" if cas_no else "手撒き", "カセット番号": cas_no,
        "候補のメーカー": cand_txt, "候補の数": len(rs), "他社（採用なし）の数": len(other),
        "今のメーカー": maker_label(cur) if cur else (f"両方（{cand_both}）" if state == "記憶ベース（両方使用）" else ""), "今の製品（販売名）": cur["販売名"] if cur else "", "状態": state, "根拠": basis,
        "刻印_表": cur["刻印_表"] if cur else "", "刻印_裏": cur["刻印_裏"] if cur else "", "色": cur["色"] if cur else "", "形": cur["形"] if cur else "",
        "長径mm": cur["長径mm"] if cur else "", "短径mm": cur["短径mm"] if cur else "", "大きさの出どころ": cur["大きさの出どころ"] if cur else "",
        "親マスタの状態": cur["親マスタの状態"] if cur else "", "照合": cur["照合"] if cur else "", "照合の理由": cur["照合の理由"] if cur else "", "品質": cur["品質"] if cur else "", "印": "・".join(sorted({x for r in rs for x in r["印"].split("・") if x})),
        "検査の印": cur["検査の印"] if cur else "", "添付文書": cur["添付文書"] if cur else "", "備考": "／".join(x for x in {r["備考"] for r in rs} if x),
    }
    rows.append(row)
    if state == "未選択":
        sheet1.append({"成分": generic, "規格": strength, "剤形": form, "カセット番号": cas_no, "候補のメーカー": cand_txt, "前回の答え（記憶）": "／".join(answers), "今のメーカー": ""})
rows.sort(key=lambda r: (r["成分・剤形コード"], strength_key(r["規格"]), r["剤形"]))

def write(path, rs, cols=None):
    cols = cols or list(rs[0].keys())
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, extrasaction="ignore"); w.writeheader(); w.writerows(rs)
write(f"{P}/ops-master.csv", rows); write(f"{P}/ops-products.csv", products)
with open(f"{P}/ops-unlinked.csv", "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL); w.writerow(["出どころ", "札", "理由"]); w.writerows(unlinked)
alts = []
for r in rows:
    dk = (r["成分・剤形コード"], strength_key(r["規格"]), r["剤形"]); adopted = {x["product_key"] for x in by_drug[dk]}
    for q in sorted(all_by_drug.get(dk, []), key=lambda q: q["brand_name"]):
        if q["product_key"] in adopted: continue
        alts.append({"成分": r["成分"], "規格": r["規格"], "剤形": r["剤形"], "今のメーカー": r["今のメーカー"], "他社製品（販売名）": q["brand_name"], "メーカー": q["maker"],
                     "刻印_表": q["imprint_front"], "刻印_裏": q["imprint_back"], "色": q["color"], "形": q["shape"], "長径mm": q["size_long_mm"],
                     "確認の状態": {"verified": "確認ずみ（現物）", "confirmed": "添付文書で確認", "draft": "候補（下書き）"}.get(q["status"], q["status"]), "区分": "候補", "添付文書": q["source_url"]})
if alts: write(f"{P}/ops-alternatives.csv", alts)

# ---------- 確認表 ①：今のメーカーを 1 つ選ぶ表 ----------
c1 = ["成分", "規格", "剤形", "カセット番号", "候補のメーカー", "前回の答え（記憶）", "今のメーカー"]
sheet1.sort(key=lambda r: (r["カセット番号"] == "", int(r["カセット番号"].split("／")[0]) if r["カセット番号"] else 0, r["成分"]))
write(f"{P}/check-sheet-1.csv", sheet1, c1) if sheet1 else open(f"{P}/check-sheet-1.csv", "w").write("")
e = H.escape
trs = "".join("<tr>" + "".join(f"<td>{e(r[c])}</td>" for c in c1[:6]) + "<td class='w'></td></tr>" for r in sheet1)
open(f"{P}/check-sheet-1.html", "w", encoding="utf-8").write(f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>確認表①</title>
<style>body{{font-family:"Noto Sans JP",sans-serif;font-size:11pt;margin:14px;background:#fff;color:#111}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #777;padding:4px 6px;font-size:9.5pt;vertical-align:top}}th{{background:#eef3fa}}td.w{{min-width:9em;background:#fffbe6}}h1{{font-size:14pt;margin:0 0 6px}}p{{font-size:9.5pt;color:#444}}@media print{{tr{{page-break-inside:avoid}}}}</style></head><body>
<h1>確認表 ①　今のメーカーを 1 つ選ぶ（{len(sheet1)} 件）</h1><p>同じ薬（成分・規格・剤形）に候補のメーカーが複数あるもの。黄色の欄に、いま使っているメーカーを 1 つ書いてください（記憶でかまいません。現物で確かめるまでは「記憶ベース」として扱います）。作成 {TODAY}</p>
<table><thead><tr>{''.join(f'<th>{e(c)}</th>' for c in c1)}</tr></thead><tbody>{trs}</tbody></table></body></html>""")

# ---------- 件数 ----------
s2 = [r for r in rows if r["状態"] != "未選択" and r["検査の印"] and r["状態"] != "確認ずみ（現物）"]
counts = {
    "薬（成分・規格・剤形）": len(rows), "うち分包方法がカセット": sum(1 for r in rows if r["分包方法"] == "カセット"),
    "採用製品（製品ごと）": len(products), "親マスタにつながらない札": len(unlinked),
    "状態": dict(Counter(r["状態"] for r in rows)),
    "候補が複数ある薬": sum(1 for r in rows if r["候補の数"] > 1), "他社（採用なし）の候補行": len(alts),
    "今のメーカーが決まっている薬の照合": dict(Counter(r["照合"] for r in rows if r["今のメーカー"])),
    "今のメーカーが決まっている薬の品質の印あり": sum(1 for r in rows if r["今のメーカー"] and r["品質"]),
    "確認表①（今のメーカーを選ぶ）": len(sheet1), "確認表②（検査の印あり）": len(s2), "確認表③（残り）": len(rows) - len(sheet1) - len(s2),
}
json.dump(counts, open(f"{P}/ops-counts.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(counts, ensure_ascii=False, indent=1))
print("つながらない:", [(a, c) for a, b, c in unlinked])
