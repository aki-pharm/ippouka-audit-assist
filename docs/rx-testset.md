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

# 3. 読み取る（API を使う。費用の上限 --max-usd、既定 $2）
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

## 加工の種類（`make-rx-variants.py`）
`clean` 加工なし／`rotp8`・`rotm8` ±8°回転／`skew` 斜めから撮った台形／`dark` 暗い／`blur` ピンぼけ／`jpeg15` JPEG 画質 15／`crop` 右 10%・上 3% が切れる（採点する列は残る）／`glare` 照明の反射／`phone` ふつうのスマホ撮影の合わせ技

## 採点の決まり（`scripts/eval/score-rx.cjs`、詳しくはスクリプト先頭）
- 行の対応づけは順番に頼らない（薬品名の近さ＋規格・Rp・朝昼夕で、合計点が最大の組み合わせ）。抜け・余分を数える
- 薬品名は `lib/master.ts` の `normalize()` で比べる（括弧内を除くので「(K)」の有無は区別しない）。基幹名（メーカー・【般】を除く）も別に出す
- 「行が全部正しい」＝薬品名・規格・朝昼夕・日数・別包・□コ がすべて正しい
- 項目別・狙い別・条件別・撮影者別・機器別・処方別。□コ と別包は取りこぼし／付けすぎの数も

## 正解の決め方で迷うところ（変えるなら prescriptions.json と生成スクリプト）
- 「1-0-2-0-0-0 で投与」の 1回量は null（rx-a のサンプルと同じ）。1日量は眠前も含めた合計、朝昼夕は眠前を含めない（rx17 の 1-0-1-1 は 1日量 3、朝昼夕 1-0-1）
- 就寝前だけの薬は朝昼夕すべて 0（プロンプトの指示どおり）
- 配合錠の規格は null。読み取りが空か、薬品名に含まれる文字（HD など）なら正解にしている
- 【般】の徐放錠の「（24時間持続）」は括弧の補足として name_note に分ける（プロンプトの指示どおり）
