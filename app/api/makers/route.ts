import { NextResponse } from "next/server";
import makerIndex from "@/data/parent/maker-index.json";
import { findCandidates, type MakerIndex } from "@/lib/makers";

// 候補の索引（約 4MB）はサーバ側だけで読む。画面には 1 つの薬の候補だけを返す
const index = makerIndex as unknown as MakerIndex;

/** 同じ成分・規格・剤形の他社製品（候補）。GET /api/makers?drug=<drug_key>&current=<product_key> */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const key = params.get("drug");
  if (!key) return NextResponse.json({ error: "薬の鍵（drug）がありません" }, { status: 400 });
  const d = index.drugs[key];
  if (!d) return NextResponse.json({ drug: null, candidates: [] });
  return NextResponse.json({
    drug: { generic_name: d.generic_name, strength: d.strength, form: d.form },
    candidates: findCandidates(index, key, params.get("current")),
  });
}
