// テスト専用の zod の代わり（node_modules が無い環境で lib/types.ts を読むため）。
// lib/types.ts で使っている機能だけ：string/number/boolean/enum/array/object、nullable・default・int・min・describe。
// parse は型の確認と default の適用だけ行う（zod と同じく object は知らない欄を落とす）。
class S {
  constructor(check) { this.check = check; this.isNullable = false; this.hasDefault = false; }
  _clone(p) { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, p); }
  nullable() { return this._clone({ isNullable: true }); }
  optional() { return this._clone({ isOptional: true }); }
  default(v) { return this._clone({ hasDefault: true, def: v }); }
  describe() { return this; }
  int() { const c = this.check; return this._clone({ check: (v, p) => { const r = c(v, p); if (!Number.isInteger(r)) throw new Error(`${p}: 整数でない`); return r; } }); }
  min(n) { const c = this.check; return this._clone({ check: (v, p) => { const r = c(v, p); if (r < n) throw new Error(`${p}: ${n} 未満`); return r; } }); }
  parse(v, p = "$") {
    if (v === undefined && this.hasDefault) return structuredClone(this.def);
    if (v === undefined && this.isOptional) return undefined;
    if (v === null && this.isNullable) return null;
    return this.check(v, p);
  }
}
const prim = (t) => () => new S((v, p) => { if (typeof v !== t) throw new Error(`${p}: ${t} でない（${JSON.stringify(v)}）`); return v; });
export const z = {
  string: prim("string"),
  number: prim("number"),
  boolean: prim("boolean"),
  enum: (vals) => new S((v, p) => { if (!vals.includes(v)) throw new Error(`${p}: ${JSON.stringify(v)} は ${vals.join("/")} でない`); return v; }),
  array: (s) => new S((v, p) => { if (!Array.isArray(v)) throw new Error(`${p}: 配列でない`); return v.map((x, i) => s.parse(x, `${p}[${i}]`)); }),
  object: (shape) => new S((v, p) => {
    if (typeof v !== "object" || v === null) throw new Error(`${p}: object でない`);
    const o = {};
    for (const [k, s] of Object.entries(shape)) { const r = s.parse(v[k], `${p}.${k}`); if (r !== undefined) o[k] = r; }
    return o;
  }),
};
export default z;
