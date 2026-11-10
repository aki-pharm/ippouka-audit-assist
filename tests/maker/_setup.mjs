// 共通の準備：モジュール解決を差し込み、origin/main の lib/ と data/master.json を一時ディレクトリに置く
import { register } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });

/** origin/main の lib/*.ts と data/master.json を置いた一時ディレクトリ（無ければ null） */
export const MAIN_ROOT = (() => {
  try {
    const root = mkdtempSync(path.join(tmpdir(), "maker-main-"));
    mkdirSync(path.join(root, "lib"), { recursive: true });
    mkdirSync(path.join(root, "data"), { recursive: true });
    for (const f of git("ls-tree", "--name-only", "origin/main", "lib/").trim().split("\n"))
      if (f.endsWith(".ts")) writeFileSync(path.join(root, f), git("show", `origin/main:${f}`));
    writeFileSync(path.join(root, "data/master.json"), git("show", "origin/main:data/master.json"));
    return root;
  } catch { return null; }
})();

register(pathToFileURL(path.join(REPO, "tests/maker/hooks.mjs")).href, { data: { roots: MAIN_ROOT ? [MAIN_ROOT] : [] } });

export const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
export const impMain = (rel) => import(pathToFileURL(path.join(MAIN_ROOT, rel)).href);
export const readJson = (rel) => JSON.parse(readFileSync(path.join(REPO, rel), "utf8"));
export const samples = () =>
  readdirSync(path.join(REPO, "public/samples")).filter((f) => /^rx-.*\.expected\.json$/.test(f)).sort()
    .map((f) => ({ name: f, rx: readJson(`public/samples/${f}`) }));
