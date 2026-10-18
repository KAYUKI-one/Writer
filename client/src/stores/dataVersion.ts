import { create } from 'zustand'

/**
 * 数据版本号。同步把远端变更写进 IndexedDB 之后 +1，
 * 页面把它作为 effect 依赖重新读取，从而看到别的设备改的内容。
 *
 * 用这个而不是 dexie-react-hooks，是为了少一个依赖；代价是要手动 bump。
 */
interface DataVersionState {
  version: number
  bump: () => void
}

export const useDataVersion = create<DataVersionState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}))
