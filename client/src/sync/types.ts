/** 前后端契约。与服务端 app/schemas.py 手工对齐，改动必须两边同时改。 */

export type Entity = 'novel' | 'chapter'

export interface PushItem {
  entity: Entity
  id: string
  /** 本地内容所基于的服务端 row_version。0 = 本地新建、从未同步。 */
  base_version: number
  deleted: 0 | 1
  /** 仅作取证与冲突副本标注，服务端绝不据此判定胜负。 */
  client_mtime_ms?: number
  title: string
  sort_order: number
  novel_id?: string
  content?: string
  content_hash?: string
}

export interface SyncRequest {
  protocol: 1
  device_id: string
  device_name?: string
  platform?: string
  /** 已完整应用的最大 seq，首次同步为 0。 */
  cursor: number
  limit?: number
  /** 整批的幂等键。重试必须复用同一个 —— 但只在 payload 完全相同时。 */
  op_id: string
  push: PushItem[]
}

export interface ServerPrevious {
  title: string
  content: string
  row_version: number
  updated_at_ms: number
}

export interface SyncResultItem {
  entity: Entity
  id: string
  status: 'ok' | 'conflict' | 'error'
  row_version: number
  seq: number
  conflict_copy_id: string | null
  reason: string | null
  resolution: string | null
  server_previous: ServerPrevious | null
  code: string | null
  message: string | null
}

export interface ChangeData {
  title?: string
  sort_order?: number
  novel_id?: string
  content?: string
  content_hash?: string
  conflict_of?: string | null
}

export interface ChangeItem {
  seq: number
  entity: Entity
  id: string
  deleted: 0 | 1
  op: 'upsert' | 'delete'
  row_version: number
  updated_at_ms: number
  data: ChangeData | null
}

export interface SyncResponse {
  protocol: number
  server_time_ms: number
  op_id: string
  results: SyncResultItem[]
  changes: ChangeItem[]
  /** 本响应实际交付的最大 seq。不能存 server_seq 的全局最大值。 */
  cursor: number
  has_more: boolean
  renewed_token: string | null
}
