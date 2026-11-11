// ランナー（scripts/read-rx-batch.ts）を API なしで動かす：SDK・zod は仮のもの、lib/readRx は fake-readrx.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url, { data: { fakeReadRx: new URL("./fake-readrx.mjs", import.meta.url).href } });
