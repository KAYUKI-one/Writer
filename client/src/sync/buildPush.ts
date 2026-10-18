import { db } from '../db/db'
import { getInflightOp, setInflightOp } from '../db/meta'
import { sha256Hex } from '../lib/hash'
import { newId } from '../lib/id'
import { platform } from '../platform'
import { getDeviceId, getDeviceName } from '../platform/deviceInfo'
import type { PushItem, SyncRequest } from './types'

// 服务端上限是 50 条 / 5MB，这里留点余量
const MAX_ITEMS = 45
const MAX_BYTES = 4 * 1024 * 1024

export interface BuiltPush {
  request: SyncRequest
  /** id → 推送时的 local_seq。ack 时比对，用来发现「在途期间用户又打字了」。 */
  pushedLocalSeq: Map<string, number>
}

/**
 * 收集所有 dirty 记录，拼成推送 payload。
 *
 * **没有独立的 outbox 队列** —— 队列和记录内容会不一致（崩溃、部分写、迁移遗漏），
 * 而 dirty 位是从记录自身状态推导出来的，永远自洽、自愈。
 */
export async function buildPush(cursor: number): Promise<BuiltPush> {
  const [novels, chapters] = await Promise.all([
    db.novels.where('dirty').equals(1).toArray(),
    db.chapters.where('dirty').equals(1).toArray(),
  ])

  const pushedLocalSeq = new Map<string, number>()
  const push: PushItem[] = []
  let bytes = 0

  for (const n of novels) {
    if (push.length >= MAX_ITEMS) break
    pushedLocalSeq.set(n.id, n.local_seq)
    push.push({
      entity: 'novel',
      id: n.id,
      base_version: n.row_version,
      deleted: n.deleted,
      title: n.title,
      sort_order: n.sort_order,
      client_mtime_ms: n.updated_at_ms,
    })
  }

  for (const c of chapters) {
    if (push.length >= MAX_ITEMS) break
    // UTF-8 上界估算，避免为了算准确字节数再编码一遍几 MB 的正文
    const size = c.content.length * 3
    if (push.length > 0 && bytes + size > MAX_BYTES) break
    bytes += size

    pushedLocalSeq.set(c.id, c.local_seq)
    push.push({
      entity: 'chapter',
      id: c.id,
      novel_id: c.novel_id,
      base_version: c.row_version,
      deleted: c.deleted,
      title: c.title,
      // 删除的条目不带正文，省流量
      content: c.deleted ? '' : c.content,
      content_hash: c.deleted ? '' : c.content_hash,
      sort_order: c.sort_order,
      client_mtime_ms: c.updated_at_ms,
    })
  }

  const fingerprint = await fingerprintOf(push, cursor)
  const opId = await resolveOpId(fingerprint)

  return {
    request: {
      protocol: 1,
      device_id: getDeviceId(),
      device_name: getDeviceName(),
      platform,
      cursor,
      op_id: opId,
      push,
    },
    pushedLocalSeq,
  }
}

/**
 * payload 指纹。**只在指纹完全一致时才复用 op_id。**
 *
 * 服务端按 op_id 缓存响应并原样回放。如果客户端拿着同一个 op_id 但 payload
 * 已经变了（用户在超时重试的间隙又打了字），服务端会回放一个过期的响应 ——
 * 那批新打的字就被静默吞掉了。
 */
function fingerprintOf(push: PushItem[], cursor: number): Promise<string> {
  // 用已有的 content_hash 而不是把几 MB 正文 stringify 一遍
  const parts = push.map(
    (p) =>
      `${p.entity}:${p.id}:${p.base_version}:${p.deleted}:${p.content_hash ?? ''}:${p.title}:${p.sort_order}`,
  )
  return sha256Hex(`${cursor}|${parts.join('|')}`)
}

async function resolveOpId(fingerprint: string): Promise<string> {
  const inflight = await getInflightOp()
  if (inflight && inflight.fingerprint === fingerprint) return inflight.opId

  const opId = newId()
  await setInflightOp({ opId, fingerprint })
  return opId
}
