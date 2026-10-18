/**
 * 「把内存里还没落盘的东西写下去」的登记处。
 *
 * 切后台、关窗口、点同步徽标时都要先 flush 再同步，但触发方拿不到
 * 编辑器内部的 ref。用一个模块级登记表解耦：编辑器挂载时登记自己的 flush，
 * 生命周期钩子遍历调用。
 */

type Flusher = () => Promise<void> | void

const flushers = new Set<Flusher>()

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => {
    flushers.delete(fn)
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all(Array.from(flushers, (fn) => Promise.resolve(fn())))
}
