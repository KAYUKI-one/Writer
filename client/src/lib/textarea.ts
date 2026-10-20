/**
 * 让 textarea 的高度贴合内容。
 *
 * 内容变多时 scrollHeight 已经是完整内容高度，直接撑开即可。
 * **不要每次都先把 height 归零再量**：正文一长，归零会让整个文档瞬间缩到
 * 一屏以内，浏览器随即把 scrollTop 夹到 0；高度恢复后滚动位置也不会回来。
 * 手机端每打一个字都会走这条路径，表现就是「写着写着整页跳回第一行」。
 */
export function resizeTextarea(ta: HTMLTextAreaElement): void {
  const current = ta.clientHeight
  const next = ta.scrollHeight
  if (next > current) {
    ta.style.height = `${next}px`
    return
  }

  // 内容变短（删字、换章）时 scrollHeight 不会小于当前高度，只能塌陷后重测。
  // 塌陷仍会短暂缩短文档，所以先记下页面滚动位置，量完再恢复。
  const scrollY = window.scrollY
  ta.style.height = 'auto'
  ta.style.height = `${ta.scrollHeight}px`
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY)
}
