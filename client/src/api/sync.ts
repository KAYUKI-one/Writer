import { apiFetch } from './client'
import type { SyncRequest, SyncResponse } from '../sync/types'

export function callSync(body: SyncRequest): Promise<SyncResponse> {
  // 首次全量同步可能要拉几十万字，默认 30s 不够
  return apiFetch<SyncResponse>('/api/sync', {
    method: 'POST',
    body,
    timeoutMs: 90_000,
  })
}
