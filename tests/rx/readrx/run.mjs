// 使い方：node --import ./register.mjs run.mjs <リポジトリ> [original-route.ts]
// lib/readRx.ts の readRx と、main の route.ts にあった呼び出し（渡されたとき）を、同じ偽の client で呼び、渡した引数を JSON で出す
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const lib = (f) => pathToFileURL(path.join(root, "lib", f)).href;
const { readRx, READ_RX_MAX_TOKENS } = await import(lib("readRx.ts"));
const { MODEL } = await import(lib("claude.ts"));
const { READ_RX_SYSTEM } = await import(lib("prompts.ts"));
const { RxReadResultSchema } = await import(lib("types.ts"));
const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");

const calls = [];
const fake = { messages: { parse: (args) => { calls.push(args); return Promise.resolve({ ok: true }); } } };
const images = [
  { base64: "AAAA", mediaType: "image/jpeg" },
  { base64: "BBBB", mediaType: "image/png" },
];
const out = { MODEL, READ_RX_MAX_TOKENS, READ_RX_SYSTEM, rxSchemaId: RxReadResultSchema.__id };
out.returned = await readRx(fake, images);
out.newCall = calls.pop();
await readRx(fake, images, "claude-haiku-5-5");
out.modelOverride = calls.pop().model;

if (process.argv[3]) {
  // main の route.ts から client.messages.parse({ ... }) の部分を取り出して、同じ材料で評価する
  const src = fs.readFileSync(process.argv[3], "utf8");
  const start = src.indexOf("client.messages.parse({");
  const end = src.indexOf("\n    });", start);
  if (start < 0 || end < 0) throw new Error("main の route.ts に呼び出しが見つからない");
  const body = src.slice(start, end + "\n    })".length).replace(/ as const/g, "");
  const f = new Function("client", "images", "MODEL", "zodOutputFormat", "RxReadResultSchema", "READ_RX_SYSTEM", `return ${body};`);
  await f(fake, images, MODEL, zodOutputFormat, RxReadResultSchema, READ_RX_SYSTEM);
  out.oldCall = calls.pop();
}
console.log(JSON.stringify(out));
