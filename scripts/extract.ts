/**
 * 添付文書PDF → 外観情報の下書き（draft）
 *   npx tsx scripts/extract.ts pdfs/xxx.pdf --id <マスタのid> [--strength 5mg] [--model claude-sonnet-5-5] [--out data/parent/drafts]
 * 出力：data/drafts/<id>.json（status: draft）。人が確認してから data/master.json に反映する。--out で出力先を変えられる。
 * APIキーは環境変数 ANTHROPIC_API_KEY または CLAUDE_API_KEY（.env.local か環境のシークレット）。
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { EXTRACT_SYSTEM } from "../lib/prompts";
import { getApiKey } from "../lib/claude";

const AppearanceSchema = z.object({
  product_name: z.string().describe("添付文書に書かれた販売名（規格を含む）"),
  strength: z.string().describe("規格"),
  imprint_front: z.string().describe("刻印・識別コード（表）。なければ 'なし'、不明なら '未確認'"),
  imprint_back: z.string().describe("刻印・識別コード（裏）。なければ 'なし'、不明なら '未確認'"),
  imprint_note: z.string().nullable().describe("社名マークのみ、割線、印字など補足"),
  color: z.string().describe("色（添付文書の表現のまま）。不明なら '未確認'"),
  shape: z.enum(["round", "oval", "oblong", "other"]).nullable(),
  size_long_mm: z.number().nullable(),
  size_short_mm: z.number().nullable(),
  thickness_mm: z.number().nullable(),
  score_line: z.boolean().nullable(),
  source_revision: z.string().nullable().describe("改訂年月（例：2024年6月改訂）"),
  source_page: z.number().int().nullable().describe("性状（外観）が書かれているPDFのページ番号（1始まり）"),
  source_quote: z.string().describe("根拠となった添付文書の文言（性状の欄）"),
});
const ExtractResultSchema = z.object({ products: z.array(AppearanceSchema) });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const pdfPath = process.argv[2];
  const id = arg("--id");
  const strength = arg("--strength");
  const sourceUrl = arg("--url");
  const model = arg("--model") ?? "claude-opus-5-5";
  const outDir = arg("--out") ?? path.join("data", "drafts");
  if (!pdfPath || !id) {
    console.error("使い方: npx tsx scripts/extract.ts <pdf> --id <id> [--strength 5mg] [--url <PMDAのURL>]");
    process.exit(1);
  }
  const data = fs.readFileSync(pdfPath).toString("base64");
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("APIキーが未設定です。ANTHROPIC_API_KEY か CLAUDE_API_KEY を設定してください。");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "high", format: zodOutputFormat(ExtractResultSchema) },
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
          {
            type: "text",
            text: strength
              ? `この添付文書から、規格 ${strength} の錠剤の外観情報を書き写してください。`
              : "この添付文書に載っている各規格の錠剤の外観情報を書き写してください。",
          },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  const result = response.parsed_output;
  if (!result) throw new Error("結果を解釈できませんでした");
  const out = {
    id,
    source_file: path.basename(pdfPath),
    source_url: sourceUrl ?? null,
    extracted_at: new Date().toISOString(),
    model: response.model,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    status: "draft",
    products: result.products,
  };
  const outPath = path.join(outDir, `${id}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`書き出し: ${outPath}`);
  for (const p of result.products) {
    console.log(`- ${p.product_name} | ${p.color} ${p.shape ?? "?"} ${p.size_long_mm ?? "?"}x${p.size_short_mm ?? "?"}mm | 表:${p.imprint_front} 裏:${p.imprint_back}`);
  }
}

main().catch((e) => {
  console.error("失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
