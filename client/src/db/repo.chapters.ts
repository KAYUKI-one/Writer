/**
 * 章节仓库。**只写 IndexedDB 并置 dirty 位，绝不发网络请求。**
 */

import { sha256Hex } from '../lib/hash'
import { countWords } from '../lib/wordcount'
import { newId } from '../lib/id'
import { db } from './db'
import type { LocalChapter } from './schema'

const now = () => Date.now()
const EMPTY_HASH = sha256Hex('')

export async function listChapters(novelId: string): Promise<LocalChapter[]> {
  const all = await db.chapters.where('novel_id').equals(novelId).toArray()
  return all
    .filter((c) => c.deleted === 0)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

export function getChapter(id: string): Promise<LocalChapter | undefined> {
  return db.chapters.get(id)
}

export async function createChapter(novelId: string, title = ''): Promise<LocalChapter> {
  const existing = await listChapters(novelId)
  const last = existing[existing.length - 1]
  const chapter: LocalChapter = {
    id: newId(),
    novel_id: novelId,
    title,
    content: '',
    content_hash: await EMPTY_HASH,
    words: 0,
    sort_order: last ? last.sort_order + 1 : 0,
    deleted: 0,
    dirty: 1,
    row_version: 0,
    server_seq: 0,
    local_seq: 1,
    updated_at_ms: now(),
    server_updated_at_ms: 0,
    conflict_of: null,
    shadow: null,
    conflict_copy_id: null,
    remote_deleted: 0,
    pushError: null,
  }
  await db.chapters.add(chapter)
  return chapter
}

/**
 * 正文落盘。这是编辑器的自动保存落点。
 *
 * 哈希和字数在**事务外**算 —— 几十万字的 SHA-256 不该占着数据库的写锁。
 */
export async function saveChapterContent(id: string, content: string): Promise<void> {
  const contentHash = await sha256Hex(content)
  const words = countWords(content)

  await db.chapters.where('id').equals(id).modify((c) => {
    if (c.content === content) return // 没变，不推进 local_seq
    c.content = content
    c.content_hash = contentHash
    c.words = words
    c.dirty = 1
    c.local_seq += 1
    c.updated_at_ms = now()
  })
}

export async function saveChapterTitle(id: string, title: string): Promise<void> {
  await db.chapters.where('id').equals(id).modify((c) => {
    if (c.title === title) return
    c.title = title
    c.dirty = 1
    c.local_seq += 1
    c.updated_at_ms = now()
  })
}

export async function deleteChapter(id: string): Promise<void> {
  await db.chapters.where('id').equals(id).modify((c) => {
    if (c.deleted === 1) return
    c.deleted = 1
    c.dirty = 1
    c.local_seq += 1
    c.updated_at_ms = now()
  })
}

/** 有未同步改动的记录数，用于同步徽标。 */
export async function countDirty(): Promise<number> {
  const [novels, chapters] = await Promise.all([
    db.novels.where('dirty').equals(1).count(),
    db.chapters.where('dirty').equals(1).count(),
  ])
  return novels + chapters
}

export async function hasDirty(): Promise<boolean> {
  return (await countDirty()) > 0
}

/** 有未解决冲突的章节数。 */
export async function countConflicts(): Promise<number> {
  const all = await db.chapters.toArray()
  return all.filter((c) => c.deleted === 0 && (c.shadow !== null || c.conflict_copy_id !== null))
    .length
}

/** 推送时服务端报错、需要用户看到的记录。 */
export async function listPushErrors(): Promise<
  { id: string; title: string; error: string }[]
> {
  const [novels, chapters] = await Promise.all([
    db.novels.toArray(),
    db.chapters.where('deleted').equals(0).toArray(),
  ])
  const errors: { id: string; title: string; error: string }[] = []
  for (const n of novels) {
    if (n.pushError) errors.push({ id: n.id, title: n.title || '未命名小说', error: n.pushError })
  }
  for (const c of chapters) {
    if (c.pushError) errors.push({ id: c.id, title: c.title || '未命名章节', error: c.pushError })
  }
  return errors
}

/** 「保留我的」：丢掉远端暂存，下一次推送会把自己的版本发上去。 */
export async function keepMine(id: string): Promise<void> {
  await db.chapters.update(id, { shadow: null, conflict_copy_id: null, remote_deleted: 0 })
}

/** 「用副本替换」：把远端暂存（shadow）落到正文，并作为一次本地修改推送。 */
export async function adoptShadow(id: string): Promise<void> {
  const chapter = await db.chapters.get(id)
  if (!chapter?.shadow) return

  const { title, content, row_version, updated_at_ms } = chapter.shadow
  // 哈希和字数在事务外算 —— 几十万字的 SHA-256 不该占着数据库写锁
  const content_hash = await sha256Hex(content)
  const words = countWords(content)

  await db.chapters.update(id, {
    title,
    content,
    content_hash,
    words,
    row_version,
    server_updated_at_ms: updated_at_ms,
    // row_version 已经追平服务端，这次推送是正常更新而不是过期写入
    dirty: 1,
    local_seq: chapter.local_seq + 1,
    updated_at_ms: now(),
    shadow: null,
    conflict_copy_id: null,
    remote_deleted: 0,
  })
}

/**
 * 「用副本替换」（推送冲突）：服务端分叉出的副本里是另一台设备的正文。
 * 把它搬回原章节，并把 base_version 设成服务端刚确认的 row_version。
 */
export async function adoptConflictCopy(originalId: string, copyId: string): Promise<boolean> {
  const [original, copy] = await Promise.all([db.chapters.get(originalId), db.chapters.get(copyId)])
  if (!original || !copy) return false

  // 副本标题形如「第三章（冲突副本 · 10-18 17:20 · 来自 Chrome · Windows）」
  const cleanTitle = copy.title.replace(/（冲突副本[^）]*）\s*$/, '').trim()

  await db.chapters.update(originalId, {
    title: cleanTitle || original.title,
    content: copy.content,
    content_hash: copy.content_hash,
    words: copy.words,
    dirty: 1,
    local_seq: original.local_seq + 1,
    updated_at_ms: now(),
    shadow: null,
    conflict_copy_id: null,
    remote_deleted: 0,
  })
  return true
}

/** 远端删了章节，但本地还有未同步的字 —— 恢复它（推送时服务端会走复活分支）。 */
export async function restoreRemoteDeleted(id: string): Promise<void> {
  const chapter = await db.chapters.get(id)
  if (!chapter) return
  await db.chapters.update(id, {
    remote_deleted: 0,
    dirty: 1,
    local_seq: chapter.local_seq + 1,
    updated_at_ms: now(),
  })
}
