// テスト専用のモジュール解決（node_modules・Next.js が無い環境で lib/*.ts を読むため）
//  - "zod" → zod-stub.mjs
//  - "@/x" → 読み込み元の「根」（リポジトリ、または比較用に origin/main を置いた一時ディレクトリ）の x
//  - 拡張子なしの相対パス → .ts を補う
//  - .json → export default に包んで読む（import 属性なしで読めるように）
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let extraRoots = [];
export async function initialize(data) { extraRoots = (data?.roots ?? []).map((r) => path.resolve(r)); }

function rootOf(parentURL) {
  if (!parentURL?.startsWith("file:")) return REPO;
  const f = fileURLToPath(parentURL);
  return extraRoots.find((r) => f.startsWith(r + path.sep)) ?? REPO;
}
const withTs = (abs) => (existsSync(abs) ? abs : existsSync(abs + ".ts") ? abs + ".ts" : abs);

export async function resolve(spec, ctx, next) {
  if (spec === "zod") return { url: pathToFileURL(path.join(REPO, "tests/maker/zod-stub.mjs")).href, shortCircuit: true };
  if (spec.startsWith("@/")) return { url: pathToFileURL(withTs(path.join(rootOf(ctx.parentURL), spec.slice(2)))).href, shortCircuit: true };
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:") && !path.extname(spec)) {
    return { url: pathToFileURL(withTs(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec))).href, shortCircuit: true };
  }
  return next(spec, ctx);
}

export async function load(url, ctx, next) {
  if (url.startsWith("file:") && url.endsWith(".json")) {
    return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return next(url, ctx);
}
