// lib/readRx.ts を node_modules なしで動かすための読み込みの差し替え（テスト専用）。
// SDK と zod は仮のものにし、拡張子の無い相対 import（./claude など）は .ts を補う。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const stub = (code) => "data:text/javascript," + encodeURIComponent(code);
const STUBS = {
  "@anthropic-ai/sdk": stub("export default class Anthropic {}"),
  "@anthropic-ai/sdk/helpers/zod": stub("export const zodOutputFormat = (schema) => ({ __zodOutputFormat: schema.__id });"),
  // zod：どんな呼び方をしても新しい物を返し、物ごとに番号（__id）を持つ。z.object(...) の結果が別のスキーマと取り違えられていないかを番号で見る
  zod: stub(`let n = 0;
const mk = () => { const id = ++n; return new Proxy(function () {}, { get: (t, k) => (k === "__id" ? id : k === Symbol.toPrimitive ? () => "z" : mk()), apply: () => mk() }); };
const z = mk();
export { z }; export default z;`),
};

// register(..., { data: { fakeReadRx: "<file URL>" } }) のとき、lib/readRx を偽物に差し替える（ランナーの費用の上限を試す用）
let fakeReadRx = null;
export async function initialize(data) {
  fakeReadRx = data?.fakeReadRx ?? null;
}

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  if (fakeReadRx && /(^|\/)lib\/readRx(\.ts)?$/.test(specifier)) return { url: fakeReadRx, shortCircuit: true };
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.startsWith("file:")) {
    const u = new URL(specifier + ".ts", context.parentURL);
    if (fs.existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true };
  }
  return next(specifier, context);
}
