// score-adopted.mjs 用の読み込みの差し替え。アプリの lib/master.ts を「書き換えずに」施設のマスタで動かすため。
// - lib/master.ts の `import masterJson from "@/data/master.json"` → 渡された施設のマスタ（配列）
// - lib/master.ts の `import { TabletSchema } from "./types"` → zod を使わない最小のもの（node_modules が無くても動くように）。
//   本物の TabletSchema.parse と同じく aliases が無ければ [] を入れる。項目の検査はしない（施設のファイルの検査は score-adopted.mjs で行う）
let facilityModule = null;

export async function initialize(data) {
  facilityModule = data?.facilityModule ?? null;
}

const TYPES_STUB =
  "data:text/javascript," +
  encodeURIComponent("export const TabletSchema = { parse: (m) => ({ ...m, aliases: Array.isArray(m.aliases) ? m.aliases : [] }) };");

export async function resolve(specifier, context, next) {
  const fromMaster = context.parentURL?.endsWith("/lib/master.ts");
  if (fromMaster && specifier === "@/data/master.json") {
    if (!facilityModule) throw new Error("施設のマスタが渡されていない");
    return { url: facilityModule, shortCircuit: true };
  }
  if (fromMaster && specifier === "./types") return { url: TYPES_STUB, shortCircuit: true };
  return next(specifier, context);
}
