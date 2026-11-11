// アプリの lib/master.ts を書き換えずに、架空施設のマスタで動かす（品質が別に書いたもの。scripts/eval/adopted-hooks.mjs は使わない）。
// - lib/master.ts の "@/data/master.json" → initialize で渡された施設のマスタ
// - lib/master.ts の "./types" → TabletSchema.parse が既定値（aliases [] と、product_key・drug_key・maker_state・discontinued_reason の null）だけを入れる最小のもの（zod が無いので）
let facility = null;
export async function initialize(data) {
  facility = data.facility;
}
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (parent.endsWith("/lib/master.ts") && specifier === "@/data/master.json")
    return { url: "data:text/javascript," + encodeURIComponent(`export default ${JSON.stringify(facility)};`), shortCircuit: true };
  if (parent.endsWith("/lib/master.ts") && specifier === "./types")
    return { url: "data:text/javascript," + encodeURIComponent("export const TabletSchema = { parse: (m) => ({ product_key: null, drug_key: null, maker_state: null, discontinued_reason: null, ...m, aliases: m.aliases ?? [] }) };"), shortCircuit: true };
  return next(specifier, context);
}
