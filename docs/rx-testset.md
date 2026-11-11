# 処方箋読み取りのテストセット（架空処方箋 20 件）

処方箋の読み取りの正確さを、人が目で見ずに数字で測るための道具。処方箋はすべて架空（実在の患者・施設とは無関係）。

## 中身
| 場所 | 何か |
|---|---|
| `data/rx-testset/prescriptions.json` | 20 処方の定義（1 行ごとの狙いつき）。ここだけを手で直す |
| `data/rx-testset/expected/rxNN.expected.json` | 正解。`/api/read-rx` が返す `result` と同じ形 |
| `data/rx-testset/rows.csv` | 1 行＝処方の 1 行。ページ・実在の製品名・全量・狙い（tricks） |
| `data/rx-testset/images/rxNN-P.png` | 画像 24 枚（20 処方、うち 4 処方が 2 ページ）。1100×1556px |
| `data/rx-testset/print/rx-testset-print.pdf` | 印刷用（A4 24 ページ、rx01 から順に） |

行 145。狙いごとの行数：□コ 19、別包 10、1-0-2-0-0-0 形式 8、【般】12、2 ページ目 17、似た名前 11、同じ薬の別規格 14、1回2錠以上 32、半端な日数 43、(K)(Ca)(Na) 8、先発名で印字 8、括弧の補足 5、カプセル 9、就寝前を含む 6、配合錠 4、単位 mEq 1。処方単位では、All One Dose なし 1（rx11）、「○○も含めて一包化」1（rx12）。

## 印刷（AKI）
- `data/rx-testset/print/rx-testset-print.pdf` を **A4・片面・24 枚**。倍率は「実際のサイズ（100%）」
- **カラー推奨**：□コ は青い四角（白黒だと灰色になる。それも試したければ白黒でもう 1 部）
- 2 ページの処方（rx05・rx10・rx15・rx20）は 1 枚ずつ撮る。ホチキスで留めない
- 各ページの右上に「架空処方 07（1/2）」と書いてあるので、撮った写真の名前はそれに合わせる

## 撮った写真のファイル名
```
<処方>-<ページ>__<撮影者>__<機器>__<条件>[__<回>].jpg
例  rx07-1__AKI__iphone__tilt.jpg
    rx05-2__AKI__iphone__dark__2.jpg   （同じ条件で 2 回目）
```
- 区切りは **アンダースコア 2 つ**（`__`）。各部分の中に `__` を入れない。日本語より英数字が無難
- 処方：`rx01`〜`rx20`。ページ：`-1`、`-2`（1 ページの処方も `-1` をつける）
- 撮影者：自由（`AKI`、`B` など。個人名を出したくなければ記号で）
- 機器：自由（`iphone13`、`pixel7`、`ipad` など）
- 条件：自由。おすすめ：`clean`（真上・明るい）、`tilt`（斜め）、`dark`（暗い）、`glare`（照明の反射）、`hand`（手持ちでぶれ気味）、`far`（遠い）。2 つ重ねるなら `tilt+dark`
- 同じ処方・撮影者・機器・条件・回の `-1` と `-2` は、アプリと同じく 1 回の読み取りにまとめて送られる
- ファイル名で書ききれないことは、任意で撮影の記録 CSV（列 `key,photographer,device,condition`。key は `rx07__AKI__iphone__tilt` のようにページと拡張子を除いた名前）に書いて `--meta` で渡す。CSV がファイル名より優先
- 写真は `captures/rx-photos/` に置く（`captures/` は git に入らない）

## 動かし方
```bash
# 1. 画像・正解・印刷用 PDF を作り直す（prescriptions.json を変えたとき）
node scripts/make-rx-testset.cjs                 # npm install 済みなら playwright で
node scripts/make-rx-testset.cjs --no-render     # 正解と rows.csv だけ

# 2. 印刷せずに崩れた画像を作る（Pillow）→ captures/rx-testset/variants/（240 枚、加工なし clean を含む）
python3 scripts/make-rx-variants.py

# 3. 読み取る（API を使う。費用の上限 --max-usd、既定 $2。呼ぶ前に 1 回の最悪の費用を取っておくので上限は超えない）
npx tsx scripts/read-rx-batch.ts --only "__clean$" --dry-run                        # 対象と見積もりだけ
npx tsx scripts/read-rx-batch.ts --only "__clean$"                                  # 既定モデル（lib/claude.ts の MODEL）
npx tsx scripts/read-rx-batch.ts --model claude-haiku-5-5 --only "__clean$"         # モデルを比べる
npx tsx scripts/read-rx-batch.ts --images captures/rx-photos --out captures/rx-runs/photos-opus --max-usd 5

# 4. 採点 → reports/score-rx.md と CSV 2 つ
node scripts/eval/score-rx.cjs --results captures/rx-runs/claude-opus-5-5
node scripts/eval/score-rx.cjs --results captures/rx-runs/claude-haiku-5-5 --out reports/score-rx-haiku
```
- 読み取りは `lib/readRx.ts`（アプリの `/api/read-rx` と同じ関数）を使う。プロンプト・スキーマ・effort・画像の縮小（長辺 1600px・JPEG 85）もアプリと同じ
- 見積もり（20 処方・24 枚、出力 3,000 トークン／回と仮定）：Opus 5.5 約 $1.6、Sonnet 5.5 約 $0.8、Haiku 5.5 約 $0.04。実際の費用は出力（考える量）で変わる
- 費用の上限：呼ぶ前に「入力の見積もり×1.3＋出力 16,000 トークン（max_tokens）すべて」の費用を取っておき、使った額との合計が上限を超えるなら止める（Opus 5.5 で 1 回 最大 約 $0.35）。例外で失敗した回はこの最悪の費用で数える。止まったら --max-usd を上げて同じコマンドで続きから
- 料金は `lib/api-prices.json`（公式の料金表、2026-11-11 確認。extract-docs.cjs も同じものを使う）

## 加工の種類（`make-rx-variants.py`）
`clean` 加工なし／`rotp8`・`rotm8` ±8°回転／`skew` 斜めから撮った台形／`dark` 暗い／`blur` ピンぼけ／`jpeg15` JPEG 画質 15／`crop` 右 10%・上 3% が切れる（採点する列は残る）／`glare` 照明の反射／`phone` ふつうのスマホ撮影の合わせ技

## 採点の決まり（`scripts/eval/score-rx.cjs`、詳しくはスクリプト先頭）
- 行の対応づけは順番に頼らない（薬品名の近さ＋規格・Rp・朝昼夕で、合計点が最大の組み合わせ）。抜け・余分を数える
- 採点はマスタとの照合より厳しい。比べる前にそろえるのは全角半角・空白・μ・㎎・大文字小文字だけで、**括弧の中は消さない**（「(OD)」「（0.5mg）」「（24時間持続）」で薬が変わる）。メーカー名「」・【般】も比べる
- 行頭の (K)(Ca)(Na)：読み取りに無ければ不問、有れば正解と同じときだけ正しい（(Na) と (K) の取り違えは誤り）
- 規格：配合錠は「配合錠」の後ろの記号（HD・A81 など）が規格。記号の無い配合錠（ノイロビタン、ウラリット）は null。「錠」「配合」などは誤り
- 数：数か数字だけの文字列だけを数として比べる（true・"28日" は誤り）
- 眠前：1日量は眠前を含む。1日量 −（朝＋昼＋夕）を眠前の数として比べる。**アプリの表は朝昼夕だけで、眠前は扱えない**（アプリの制限。採点では眠前を落とすと誤り）
- 「行が全部正しい」＝薬品名・規格・朝昼夕・1日量（＝眠前も）・日数・別包・□コ・括弧の補足（name_note）がすべて正しい
- 壊れた JSON・空のファイル・items の中の null の行で止まらない（その撮影は読み取り失敗／その行は無視）。ページごとのファイル（rx05-1__…、rx05-2__…）は 1 つにまとめてから採点
- 項目別・狙い別・条件別・撮影者別・機器別・処方別。□コ と別包は取りこぼし／付けすぎの数も

## 正解の決め方（11/11 AKI の判断を反映）
- 「1-0-2-0-0-0 で投与」は 朝1・夕2（朝夕食後）。1回量は null（rx-a のサンプルと同じ）、時点ごとの数で採点する
- 1日量は眠前を含む（AKI）。朝昼夕は眠前を含めない（rx17 の 1-0-1-1 は 1日量 3、朝昼夕 1-0-1）。就寝前だけの薬は朝昼夕すべて 0、1日量は眠前の数
- 配合錠の規格は印字された記号（ユニシア配合錠HD → HD、バファリン配合錠A81 → A81）。記号の無いものは null（AKI）
- 【般】の徐放錠の「（24時間持続）」は括弧の補足として name_note に分ける（プロンプトの指示どおり）
