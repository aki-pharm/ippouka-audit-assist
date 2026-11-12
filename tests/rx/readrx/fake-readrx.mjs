// 偽の readRx。RX_FAKE で振る舞いを決める
//   max：出力 16,000 トークン（max_tokens いっぱい）、入力は RX_FAKE_INPUT（既定 5,000）
//   throw：例外（請求が分からない失敗）
export const READ_RX_MAX_TOKENS = 16000;
export async function readRx() {
  const mode = process.env.RX_FAKE ?? "max";
  if (mode === "throw") throw new Error("fake network error");
  // bedtime：rx15 Rp10 の読み違い（「0-0-0-2-0-0 1日1回 就寝前」を夕 2）と、規格の欄が空の行を返す（ランナーの後処理を試す）
  if (mode === "bedtime") {
    const it = (name, strength, raw, per) => ({ rp: "01", name_as_written: name, name_note: null, strength, dosage_form: "tablet", dose_per_time: null, times_per_day: 1, dose_per_day: 2, per_timing: per, days: 42, raw_usage_text: raw, pack_instruction: "none", manual_fill_mark: false, confidence: "high" });
    return {
      stop_reason: "end_turn",
      parsed_output: { items: [it("センノシド錠12mg「サワイ」", null, "0-0-0-2-0-0 で投与 1日1回 就寝前", { morning: 0, noon: 0, evening: 2 })], all_one_dose: true, include_all_note: null, notes: null },
      usage: { input_tokens: 5000, output_tokens: 3000 },
    };
  }
  return {
    stop_reason: "max_tokens",
    parsed_output: { items: [], all_one_dose: true, include_all_note: null, notes: null },
    usage: { input_tokens: Number(process.env.RX_FAKE_INPUT ?? 5000), output_tokens: 16000 },
  };
}
