import { db } from '../db/db'
import { getCursor, setCursor } from '../db/meta'
import { countWords } from '../lib/wordcount'
import type { ChangeItem, PushItem, SyncResponse } from './types'

interface OwnEcho {
  /** 服务端为这次推送分配的 seq。 */
  seq: number
  /** 推送时这条正文的哈希。 */
  contentHash: string
}

/**
 * 找出「本次响应里哪些变更是我们自己刚推上去的」。
 *
 * 不能只看 content_hash 相等：推送在途时用户又打了字，本地正文已经比
 * 回显的那份新。若把这种回显当成远端修改，就会存出一个假的 shadow，
 * 让只在一台设备上写作的人反复看到「另一台设备也修改过本章」。
 *
 * 判据是服务端回执里的 seq + 推送时的正文哈希 —— 只有两者都对得上，
 * 才能确认服务端当前的正文就是这台设备刚写的那份。
 */
function collectOwnEchoes(resp: SyncResponse, push: PushItem[]): Map<string, OwnEcho> {
  const pushed = new Map<string, PushItem>()
  for (const item of push) pushed.set(`${item.entity}:${item.id}`, item)

  const echoes = new Map<string, OwnEcho>()
  for (const result of resp.results) {
    if (result.status === 'error') continue
    const item = pushed.get(`${result.entity}:${result.id}`)
    if (!item) continue
    echoes.set(`${result.entity}:${result.id}`, {
      seq: result.seq,
      contentHash: item.content_hash ?? '',
    })
  }
  return echoes
}

function isOwnEcho(change: ChangeItem, echo: OwnEcho | undefined): boolean {
  if (!echo || change.seq !== echo.seq) return false
  // 删除没有正文，seq 对上即可；upsert 还必须是推送时的那份正文
  if (change.op === 'delete') return true
  return (change.data?.content_hash ?? '') === echo.contentHash
}

/**
 * 应用服务端下发的变更。
 *
 * **shadow 落地和游标推进必须在同一个事务里提交。** 这样即使应用在拉取中途
 * 被杀，重启后游标仍指向未处理的位置 —— 最坏是重复投递，而应用是幂等的。
 */
export async function applyPull(resp: SyncResponse, push: PushItem[] = []): Promise<void> {
  const ownEchoes = collectOwnEchoes(resp, push)

  await db.transaction('rw', db.novels, db.chapters, db.meta, async () => {
    for (const change of resp.changes) {
      if (change.entity === 'novel') {
        await applyNovelChange(change)
      } else {
        await applyChapterChange(
          change,
          isOwnEcho(change, ownEchoes.get(`${change.entity}:${change.id}`)),
        )
      }
    }

    const current = await getCursor()
    // 游标只允许单调前进，永不接受回退
    await setCursor(Math.max(current, resp.cursor, 0))
  })
}

async function applyNovelChange(change: ChangeItem): Promise<void> {
  const local = await db.novels.get(change.id)

  if (!local) {
    if (change.deleted) return
    const d = change.data ?? {}
    await db.novels.put({
      id: change.id,
      title: d.title ?? '',
      sort_order: d.sort_order ?? 0,
      deleted: 0,
      dirty: 0,
      row_version: change.row_version,
      server_seq: change.seq,
      local_seq: 0,
      updated_at_ms: change.updated_at_ms,
      server_updated_at_ms: change.updated_at_ms,
      pushError: null,
    })
    return
  }

  if (change.deleted) {
    if (local.dirty) {
      // 远端删了但本地还有没推上去的改动。不反转 —— 推送时服务端会复活它。
      await db.novels.update(change.id, {
        row_version: change.row_version,
        server_seq: change.seq,
      })
    } else {
      await db.novels.delete(change.id)
    }
    return
  }

  const d = change.data ?? {}
  const unchanged =
    (d.title ?? '') === local.title && (d.sort_order ?? 0) === local.sort_order

  if (unchanged) {
    // 自己刚推上去的内容回显，或本来就一致 —— 只更新版本记账
    await db.novels.update(change.id, {
      row_version: change.row_version,
      server_seq: change.seq,
      server_updated_at_ms: change.updated_at_ms,
    })
    return
  }

  if (local.dirty) {
    // 本地脏 + 远端也变了。小说没有正文，标题和排序都是低信息量字段，
    // 服务端对小说也不分叉 —— 保留本地版本，让它随下次推送覆盖过去。
    return
  }

  await db.novels.update(change.id, {
    title: d.title ?? local.title,
    sort_order: d.sort_order ?? local.sort_order,
    row_version: change.row_version,
    server_seq: change.seq,
    server_updated_at_ms: change.updated_at_ms,
  })
}

async function applyChapterChange(change: ChangeItem, ownEcho: boolean): Promise<void> {
  const local = await db.chapters.get(change.id)

  if (!local) {
    if (change.deleted) return
    const d = change.data ?? {}
    const content = d.content ?? ''
    await db.chapters.put({
      id: change.id,
      novel_id: d.novel_id ?? '',
      title: d.title ?? '',
      content,
      content_hash: d.content_hash ?? '',
      words: countWords(content),
      sort_order: d.sort_order ?? 0,
      deleted: 0,
      dirty: 0,
      row_version: change.row_version,
      server_seq: change.seq,
      local_seq: 0,
      updated_at_ms: change.updated_at_ms,
      server_updated_at_ms: change.updated_at_ms,
      conflict_of: d.conflict_of ?? null,
      shadow: null,
      conflict_copy_id: null,
      remote_deleted: 0,
      pushError: null,
    })
    return
  }

  if (change.deleted) {
    if (ownEcho) {
      // 自己刚推的删除回显。本地已经是软删除状态，只记账 ——
      // 绝不能标成 remote_deleted，否则会弹出「另一台设备删除了本章」的假横幅。
      await db.chapters.update(change.id, {
        row_version: change.row_version,
        server_seq: change.seq,
        server_updated_at_ms: change.updated_at_ms,
        remote_deleted: 0,
        shadow: null,
      })
      return
    }

    if (local.dirty) {
      // 远端删了，但本地还有未推送的字。**不要反转用户的删除** ——
      // 保留正文并标记，推送时服务端走「复活」分支。
      await db.chapters.update(change.id, {
        remote_deleted: 1,
        row_version: change.row_version,
        server_seq: change.seq,
      })
    } else {
      await db.chapters.delete(change.id)
    }
    return
  }

  const d = change.data ?? {}
  const incomingHash = d.content_hash ?? ''

  if (ownEcho) {
    // 服务端当前正文就是这台设备刚推上去的那份（seq 与哈希都对得上）。
    // 推送在途时用户又打了字，本地正文只会比回显更新 —— 同一条写作线，
    // 更新版本记账即可，绝不制造 shadow 或冲突横幅。
    await db.chapters.update(change.id, {
      row_version: change.row_version,
      server_seq: change.seq,
      server_updated_at_ms: change.updated_at_ms,
      remote_deleted: 0,
      // 服务端已确认这份正文；此前的远端暂存要么已被分叉保存，要么已过期
      shadow: null,
      // 本地干净时可以安全地跟随服务端的标题和正文（内容其实就是我们推的那份）
      ...(local.dirty
        ? {}
        : {
            title: d.title ?? local.title,
            content: d.content ?? local.content,
            content_hash: incomingHash,
            words: countWords(d.content ?? local.content),
          }),
    })
    return
  }

  if (incomingHash === local.content_hash) {
    // 远端内容与本地完全一致（可能是重复投递，也可能是两边写出了同样的字）。
    // 只更新版本记账，绝不碰正文，也绝不制造冲突横幅。
    await db.chapters.update(change.id, {
      row_version: change.row_version,
      server_seq: change.seq,
      server_updated_at_ms: change.updated_at_ms,
      remote_deleted: 0,
      shadow: null,
      // 本地干净时标题可以跟随远端；本地脏时保留自己的，等推送
      ...(local.dirty ? {} : { title: d.title ?? local.title }),
    })
    return
  }

  if (!local.dirty) {
    // 本地干净，直接采用服务端版本
    const content = d.content ?? ''
    await db.chapters.update(change.id, {
      title: d.title ?? local.title,
      content,
      content_hash: incomingHash,
      words: countWords(content),
      sort_order: d.sort_order ?? local.sort_order,
      row_version: change.row_version,
      server_seq: change.seq,
      server_updated_at_ms: change.updated_at_ms,
      shadow: null,
      remote_deleted: 0,
    })
    return
  }

  // 本地脏 + 远端也变了 —— **不覆盖正文**，把远端那份存进 shadow。
  // 用户屏幕上正在写的字不能在他眼皮底下被替换掉。
  await db.chapters.update(change.id, {
    shadow: {
      row_version: change.row_version,
      title: d.title ?? '',
      content: d.content ?? '',
      updated_at_ms: change.updated_at_ms,
    },
  })
}
