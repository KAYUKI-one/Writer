/**
 * 中文字数统计。
 *
 * 规则：CJK 汉字/假名/韩文每字计 1；连续的拉丁字母或数字算 1 个词；空白不计。
 *
 * 两个坑：
 * - **不能用 `content.length`** —— 那是 UTF-16 码元数，emoji 和扩展汉字（如 𠮷）
 *   会被算成 2。这里用码点遍历。
 * - **不能每次按键全量扫描几十万字** —— 长章节会明显掉帧。所以只在落盘边界
 *   （1.2s 防抖）调一次，不在 onInput 里调。
 */

// 中日韩统一表意文字（含扩展 A/B）、假名、谚文。
// 必须带 u 标志：扩展 B 区（U+20000 起）超出 BMP，没有 u 时正则会把代理对
// 拆成两个码元，`[D840 DC00-D86A DCDF]` 里的范围顺序颠倒，TypeScript 报 TS1517。
const CJK =
  /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]|[\u{20000}-\u{2A6DF}]/gu

const LATIN_WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g

export function countWords(text: string): number {
  if (!text) return 0

  let count = 0

  // 用 exec 循环而不是 match(/g)：match 会为几十万字符分配一个同样大的数组
  CJK.lastIndex = 0
  while (CJK.exec(text) !== null) count++

  const latin = text.match(LATIN_WORD)
  if (latin) count += latin.length

  return count
}

/** 码点数量（含标点），用于「字符数」口径。 */
export function countChars(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

export function formatCount(n: number): string {
  return n.toLocaleString('zh-CN')
}
