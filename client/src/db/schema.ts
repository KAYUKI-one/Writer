/**
 * 本地库的结构定义 —— **唯一改 schema 的地方**。
 *
 * 两个必须遵守的约束：
 *
 * 1. **索引键不能是布尔值**。IndexedDB 只接受 number / string / Date /
 *    ArrayBuffer / Array，所以 `dirty` 和 `deleted` 存 **0/1 数字**。
 *    这是 Dexie 里最常踩的坑。
 * 2. 本地记录比服务端多三个字段：`dirty`（有未推送改动）、`local_seq`
 *    （解决「推送在途期间用户继续打字」的丢字竞态）、`shadow`（冲突暂存）。
 */

export interface Shadow {
  row_version: number
  title: string
  content: string
  updated_at_ms: number
}

export interface LocalNovel {
  id: string
  title: string
  sort_order: number
  deleted: 0 | 1
  dirty: 0 | 1
  /** 服务端已确认的行版本。0 表示从未同步过。 */
  row_version: number
  server_seq: number
  /** 每次本地落盘 +1。推送时记下它，ack 时比对，用来发现「在途期间又改了」。 */
  local_seq: number
  /** 本地时钟，仅用于本地排序。 */
  updated_at_ms: number
  /** 服务器时钟，权威，用于展示。 */
  server_updated_at_ms: number
  pushError: string | null
}

export interface LocalChapter {
  id: string
  novel_id: string
  title: string
  content: string
  content_hash: string
  words: number
  sort_order: number
  deleted: 0 | 1
  dirty: 0 | 1
  row_version: number
  server_seq: number
  local_seq: number
  updated_at_ms: number
  server_updated_at_ms: number
  /** 非空表示这是服务端分叉出来的冲突副本。 */
  conflict_of: string | null
  /** 远端改了、本地也脏时，远端那份暂存在这里，**不覆盖正文**。 */
  shadow: Shadow | null
  /** 推送时服务端告诉我们的副本 id。 */
  conflict_copy_id: string | null
  /** 远端已删除，但本地还有未推送的改动 —— 不要反转用户的删除。 */
  remote_deleted: 0 | 1
  pushError: string | null
}

export interface MetaEntry {
  key: string
  value: unknown
}

/** Dexie 的 stores 声明。改动这里要同时升 db.version。 */
export const STORES = {
  novels: 'id, dirty, deleted, sort_order, server_seq, row_version',
  chapters:
    'id, dirty, deleted, novel_id, [novel_id+sort_order], server_seq, row_version, conflict_of',
  meta: 'key',
} as const

export const DB_VERSION = 1
