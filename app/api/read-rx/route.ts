import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClient, MODEL, takeDailyBudget } from "@/lib/claude";
import { READ_RX_SYSTEM } from "@/lib/prompts";
import { RxReadResultSchema } from "@/lib/types";

const MAX_IMAGES = 4;
const MAX_BASE64_CHARS = 3_000_000; // 約2.2MB/枚

type Body = { images?: { base64: string; mediaType: "image/jpeg" | "image/png" }[] };

export async function POST(request: Request) {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { error: "サーバにAPIキーが設定されていません（ANTHROPIC_API_KEY または CLAUDE_API_KEY）。", code: "no_api_key" },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => null)) as Body | null;
  const images = body?.images ?? [];
  if (!images.length) return NextResponse.json({ error: "画像がありません" }, { status: 400 });
  if (images.length > MAX_IMAGES) return NextResponse.json({ error: `画像は${MAX_IMAGES}枚までです` }, { status: 400 });
  for (const img of images) {
    if (typeof img.base64 !== "string" || img.base64.length > MAX_BASE64_CHARS)
      return NextResponse.json({ error: "画像が大きすぎます" }, { status: 413 });
    if (img.mediaType !== "image/jpeg" && img.mediaType !== "image/png")
      return NextResponse.json({ error: "対応していない画像形式です" }, { status: 400 });
  }
  const budget = takeDailyBudget();
  if (!budget.ok) return NextResponse.json({ error: "本日の読み取り回数の上限に達しました" }, { status: 429 });

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "high", format: zodOutputFormat(RxReadResultSchema) },
      system: READ_RX_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img, i) => [
              { type: "text" as const, text: `処方箋の写真 ${i + 1}枚目／${images.length}枚` },
              { type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } },
            ]).flat(),
            { type: "text", text: "上の写真から薬剤情報を書き起こしてください。" },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "読み取りが拒否されました。写真に薬剤情報以外が含まれていないか確認してください。" }, { status: 422 });
    }
    const result = response.parsed_output;
    if (!result) return NextResponse.json({ error: "読み取り結果を解釈できませんでした" }, { status: 502 });
    // 画像や結果はログに出さない（個人情報対策）
    return NextResponse.json({ result, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("read-rx failed:", msg.slice(0, 200));
    return NextResponse.json({ error: "読み取りに失敗しました。もう一度お試しください。" }, { status: 502 });
  }
}
