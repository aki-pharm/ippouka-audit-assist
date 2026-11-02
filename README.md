# 一包化監査アシスト

一包化の1包目を監査するとき、処方箋から「朝・昼・夕の袋に入るはずの錠剤」を、添付文書由来の刻印・形・色・大きさつきのイラストで並べて見せるスマホWebアプリです。
判断するのは薬剤師。このツールの役割は「調べる手間を減らすこと」です。カメラに錠剤を判定させません。

- 仕様書：[docs/design.md](docs/design.md)
- 作業計画：[docs/plan.md](docs/plan.md)
- 日々のまとめ：[docs/daily/](docs/daily/)

> Built with Claude: Japan 2026 ハッカソン（2026-11-02 〜 11-08）期間中に新規に制作しています。

## 使い方（開発）

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY（または CLAUDE_API_KEY）, APP_PASSCODE を設定
npm run dev
```

- `npm run extract -- pdfs/xxx.pdf --id <マスタid> --strength 5mg --url <PMDAのURL>`：添付文書PDFから外観情報の下書きを作る（`data/drafts/`）
- `npm run csv -- export | import | apply-drafts`：マスタのCSV書き出し／取り込み／下書きの反映
- `node scripts/make-samples.cjs`：架空の処方箋サンプル画像を作り直す（`public/samples/`）

## 安全とデータ
- APIキーはサーバ側（環境変数）にだけ置き、画面には出しません。
- 公開URLは共通パスコードで保護します（`APP_PASSCODE`）。
- 処方箋・1包目の画像はサーバに保存せず、ログにも出しません。
- 実在の患者情報・院内データ・病院名は使いません。`public/samples/` の処方箋は架空のものです。
- 添付文書PDFはリポジトリに含めません（出典URLのみ）。

## 対象外
半錠、散剤、カプセルの外観表示、眠前など朝昼夕以外の服用時点。
