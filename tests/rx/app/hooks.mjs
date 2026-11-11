// アプリの lib/master.ts を書き換えずに、架空施設のマスタで動かす（品質が別に書いたもの。scripts/eval/adopted-hooks.mjs は使わない）。
// - lib/master.ts の "@/data/master.json" → initialize で渡された施設のマスタ
// - lib/master.ts の "./types" → TabletSchema.parse が aliases の既定値 [] だけを入れる最小のもの（zod が無いので）
let facility = null;
export async function initialize(data) {
  facility = data.facility;
}
export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  if (parent.endsWith("/lib/master.ts") && specifier === "@/data/master.json")
    return { url: "data:text/javascript," + encodeURIComponent(`export default ${JSON.stringify(facility)};`), shortCircuit: true };
  if (parent.endsWith("/lib/master.ts") && specifier === "./types")
    return { url: "data:text/javascript," + encodeURIComponent("export const TabletSchema = { parse: (m) => ({ ...m, aliases: m.aliases ?? [] }) };"), shortCircuit: true };
  return next(specifier, context);
}
