# 下書きの採点（data/drafts × data/master.json verified）

実行：2026-11-10T11:19:14.549Z　スクリプト：scripts/eval/score-drafts.cjs

- 照合した品目：28（master.json の verified 28 品目）
- 比べた項目：196（28 品目 × 7 項目）
- 一致 171 ／ 未確認・空欄 24 ／ 誤った値 1

判定の決め方：空白（全角含む）を取り除き、全角英数字を半角に寄せてから比べる。数値は数として比べる。「未確認・空欄」は下書きが「未確認」か null / "" でマスタに値がある（人が埋めた）もの。「誤った値」は下書きに値があるのにマスタと違うもの。

## 項目別

| 項目 | 一致 | 未確認・空欄 | 誤った値 | 一致率 |
| --- | --- | --- | --- | --- |
| imprint_front | 24 | 3 | 1 | 85.7% |
| imprint_back | 9 | 19 | 0 | 32.1% |
| color | 28 | 0 | 0 | 100.0% |
| shape | 26 | 2 | 0 | 92.9% |
| size_long_mm | 28 | 0 | 0 | 100.0% |
| size_short_mm | 28 | 0 | 0 | 100.0% |
| thickness_mm | 28 | 0 | 0 | 100.0% |
| 合計 | 171 | 24 | 1 | 87.2% |

## 誤った値（1）

| id | 販売名 | 項目 | 下書き | マスタ（verified） |
| --- | --- | --- | --- | --- |
| orkedia-4 | オルケディア錠4mg | imprint_front | KH603 | オルケディア 4 |

## 未確認・空欄（24）

| id | 販売名 | 項目 | 下書き | マスタ（verified） |
| --- | --- | --- | --- | --- |
| amitiza-12-cap | アミティーザカプセル12μg | imprint_front | 未確認 | なし |
| amitiza-12-cap | アミティーザカプセル12μg | imprint_back | 未確認 | なし |
| amlodipine-od-10-takedateva | アムロジピンOD錠10mg「武田テバ」 | imprint_back | 未確認 | なし |
| amlodipine-od-2.5-takedateva | アムロジピンOD錠2.5mg「武田テバ」 | imprint_back | 未確認 | なし |
| aspara-ca-200 | アスパラ-CA錠200mg | imprint_back | 未確認 | なし |
| aspara-k-300 | アスパラカリウム錠300mg | imprint_back | 未確認 | なし |
| azilsartan-20-nipro | アジルサルタン錠20mg「ニプロ」 | imprint_front | 未確認 | アジルサルタン 20 ニプロ |
| azilsartan-20-nipro | アジルサルタン錠20mg「ニプロ」 | imprint_back | 未確認 | アジルサルタン 20 ニプロ |
| carvedilol-2.5-sawai | カルベジロール錠2.5mg「サワイ」 | imprint_back | 未確認 | カルベジロール 2.5 サワイ |
| carvedilol-2.5-sawai | カルベジロール錠2.5mg「サワイ」 | shape | null | oval |
| cibenzoline-50-sawai | シベンゾリンコハク酸塩錠50mg「サワイ」 | imprint_back | 未確認 | なし |
| darbroc-4 | ダーブロック錠4mg | imprint_back | 未確認 | なし |
| eldecalcitol-0.75-cap-sawai | エルデカルシトールカプセル0.75μg「サワイ」 | imprint_front | 未確認 | なし |
| eldecalcitol-0.75-cap-sawai | エルデカルシトールカプセル0.75μg「サワイ」 | imprint_back | 未確認 | なし |
| eliquis-2.5 | エリキュース錠2.5mg | imprint_back | 未確認 | 2½ |
| eliquis-5 | エリキュース錠5mg | imprint_back | 未確認 | 5 |
| ferrous-citrate-50-nig | クエン酸第一鉄Na錠50mg「NIG」 | imprint_back | 未確認 | なし |
| foliamin-5 | フォリアミン錠5mg | imprint_back | 未確認 | なし |
| methycobal-500 | メチコバール錠500μg | imprint_back | 未確認 | なし |
| mosapride-5-aa | モサプリドクエン酸塩錠5mg「AA」 | imprint_back | 未確認 | 5 |
| mosapride-5-aa | モサプリドクエン酸塩錠5mg「AA」 | shape | null | oblong |
| nifedipine-cr-10-sawai | ニフェジピンCR錠10mg「サワイ」 | imprint_back | 未確認 | なし |
| nifedipine-cr-20-sawai | ニフェジピンCR錠20mg「サワイ」 | imprint_back | 未確認 | なし |
| orkedia-4 | オルケディア錠4mg | imprint_back | 未確認 | KH603 |
