import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

/**
 * APIキー。ANTHROPIC_API_KEY を優先し、無ければ CLAUDE_API_KEY を読む。
 * Claude Code のクラウド環境は ANTHROPIC_API_KEY という名前の変数を無効化するため、
 * そこで動かす場合は CLAUDE_API_KEY に設定する。
 */
export function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined;
}

let client: Anthropic | null = null;
export function getClient(): Anthropic | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
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
