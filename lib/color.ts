/** 添付文書の色の表現（例：白色、微黄白色、淡赤色）を表示色に対応づける。人が color_hex を入れればそちらを優先 */
const TABLE: [RegExp, string][] = [
  [/^(白|白色|微黄白|帯黄白|帯微黄白|淡黄白|うすい黄白)/, "#F7F7F2"],
  [/^(淡黄|うすい黄|微黄)/, "#F6E7A1"],
  [/^(黄|黄色)/, "#F2D54B"],
  [/^(黄褐|橙黄)/, "#E9B547"],
  [/^(淡橙|うすい橙|淡だいだい)/, "#F2C59A"],
  [/^(橙|だいだい)/, "#EFA94D"],
  [/^(淡赤|うすい赤|淡紅|淡赤紫|淡桃|桃)/, "#F2B8AE"],
  [/^(赤|紅|赤褐)/, "#D9534F"],
  [/^(淡青|うすい青|淡緑青)/, "#BFD7F2"],
  [/^(青)/, "#6C8EDB"],
  [/^(淡緑|うすい緑)/, "#CFE8C5"],
  [/^(緑)/, "#7FBF7B"],
  [/^(淡褐|うすい褐|淡茶)/, "#D9C2A5"],
  [/^(褐|茶)/, "#A9743F"],
  [/^(淡紫|うすい紫)/, "#D9C7EA"],
  [/^(紫)/, "#9B7FC7"],
  [/^(灰|灰白)/, "#D7D7D7"],
];

export function colorToHex(color: string | null | undefined): string | null {
  if (!color || color === "未確認") return null;
  const c = color.replace(/[\s　]/g, "").replace(/[～〜~].*$/, ""); // 「白〜微黄白色」は前半で判定
  for (const [re, hex] of TABLE) if (re.test(c)) return hex;
  return null;
}
