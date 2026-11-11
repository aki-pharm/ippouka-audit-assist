// 偽の readRx。RX_FAKE で振る舞いを決める
//   max：出力 16,000 トークン（max_tokens いっぱい）、入力は RX_FAKE_INPUT（既定 5,000）
//   throw：例外（請求が分からない失敗）
export const READ_RX_MAX_TOKENS = 16000;
export async function readRx() {
  const mode = process.env.RX_FAKE ?? "max";
  if (mode === "throw") throw new Error("fake network error");
  return {
    stop_reason: "max_tokens",
    parsed_output: { items: [], all_one_dose: true, include_all_note: null, notes: null },
    usage: { input_tokens: Number(process.env.RX_FAKE_INPUT ?? 5000), output_tokens: 16000 },
  };
}
