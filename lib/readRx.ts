import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODEL } from "./claude";
import { READ_RX_SYSTEM } from "./prompts";
import { RxReadResultSchema } from "./types";

export type RxImage = { base64: string; mediaType: "image/jpeg" | "image/png" };

export const READ_RX_MAX_TOKENS = 16000;

/**
 * 処方箋の写真を Claude に読ませる。/api/read-rx と採点用のランナー（scripts/read-rx-batch.ts）が同じ呼び方を使う。
 * 返すのは SDK の応答そのまま（parsed_output・stop_reason・usage を呼び出し側で見る）。
 */
export function readRx(client: Anthropic, images: RxImage[], model: string = MODEL) {
  return client.messages.parse({
    model,
    max_tokens: READ_RX_MAX_TOKENS,
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
}
