export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** 立刻执行待处理的调用（切后台、退出前用）。 */
  flush(): void
  cancel(): void
  pending(): boolean
}

/**
 * 带最大等待的防抖。
 *
 * 普通防抖有个致命问题：用户持续不停地打字时，回调**永远不触发**。
 * 一个写得快的作者可能连着十几分钟不停笔，那期间一个字都没落盘 ——
 * 一崩溃就全没了。所以加一条「距首次调用超过 maxWaitMs 就强制执行」。
 */
export function debounceMax<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
  maxWaitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstCallAt = 0
  let lastArgs: A | null = null

  function invoke() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    firstCallAt = 0
    const args = lastArgs
    lastArgs = null
    if (args) fn(...args)
  }

  function run(...args: A) {
    lastArgs = args
    const now = Date.now()
    if (firstCallAt === 0) firstCallAt = now

    if (now - firstCallAt >= maxWaitMs) {
      invoke()
      return
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(invoke, waitMs)
  }

  const debounced = ((...args: A) => run(...args)) as Debounced<A>
  debounced.flush = () => {
    if (lastArgs) invoke()
  }
  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    lastArgs = null
    firstCallAt = 0
  }
  debounced.pending = () => lastArgs !== null
  return debounced
}
