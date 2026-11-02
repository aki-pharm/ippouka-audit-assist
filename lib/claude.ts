import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
export function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

/** 1日あたりの呼び出し上限（プロセス内の簡易カウンタ。コスト保護の最低限） */
const counter = { day: "", count: 0 };
export function takeDailyBudget(): { ok: boolean; used: number; limit: number } {
  const limit = Number(process.env.DAILY_API_CALL_LIMIT ?? 200);
  const today = new Date().toISOString().slice(0, 10);
  if (counter.day !== today) {
    counter.day = today;
    counter.count = 0;
  }
  if (counter.count >= limit) return { ok: false, used: counter.count, limit };
  counter.count += 1;
  return { ok: true, used: counter.count, limit };
}
