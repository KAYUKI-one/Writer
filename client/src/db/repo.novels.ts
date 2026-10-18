/**
 * 小说仓库。**只写 IndexedDB 并置 dirty 位，绝不发网络请求。**
 *
 * 网络只被 SyncEngine 使用。这条边界让「离线写作」不是特例而是默认路径 ——
 * 同步失败不影响写作。
 */

import { newId } from '../lib/id'
import { db } from './db'
import type { LocalNovel } from './schema'

const now = () => Date.now()

export async function listNovels(): Promise<LocalNovel[]> {
  const all = await db.novels.toArray()
  return all
    .filter((n) => n.deleted === 0)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

export function getNovel(id: string): Promise<LocalNovel | undefined> {
  return db.novels.get(id)
}

export async function createNovel(title = ''): Promise<LocalNovel> {
  const existing = await listNovels()
  const novel: LocalNovel = {
    id: newId(),
    title: title.trim() || '未命名',
    // 新书排在最前面
    sort_order: existing.length ? existing[0].sort_order - 1 : 0,
    deleted: 0,
    dirty: 1,
    row_version: 0,
    server_seq: 0,
    local_seq: 1,
    updated_at_ms: now(),
    server_updated_at_ms: 0,
    pushError: null,
  }
  await db.novels.add(novel)
  return novel
}

export async function renameNovel(id: string, title: string): Promise<void> {
  await db.novels.where('id').equals(id).modify((n) => {
    const next = title.trim() || '未命名'
    if (n.title === next) return
    n.title = next
    n.dirty = 1
    n.local_seq += 1
    n.updated_at_ms = now()
  })
}

/** 软删除小说，并级联软删除它下面的所有章节。 */
export async function deleteNovel(id: string): Promise<void> {
  await db.transaction('rw', db.novels, db.chapters, async () => {
    await db.novels.where('id').equals(id).modify((n) => {
      n.deleted = 1
      n.dirty = 1
      n.local_seq += 1
      n.updated_at_ms = now()
    })
    await db.chapters.where('novel_id').equals(id).modify((c) => {
      if (c.deleted === 1) return
      c.deleted = 1
      c.dirty = 1
      c.local_seq += 1
      c.updated_at_ms = now()
    })
  })
}

export async function novelStats(novelId: string): Promise<{ chapters: number; words: number }> {
  const chapters = await db.chapters.where('novel_id').equals(novelId).toArray()
  const live = chapters.filter((c) => c.deleted === 0)
  return {
    chapters: live.length,
    words: live.reduce((sum, c) => sum + (c.words || 0), 0),
  }
}

export interface NovelSummary {
  novel: LocalNovel
  chapters: number
  words: number
}

/** 列表页一次性取全，避免 N 本小说发 N 次查询。 */
export async function listNovelSummaries(): Promise<NovelSummary[]> {
  const [novels, chapters] = await Promise.all([listNovels(), db.chapters.toArray()])

  const stats = new Map<string, { chapters: number; words: number }>()
  for (const c of chapters) {
    if (c.deleted) continue
    const s = stats.get(c.novel_id) ?? { chapters: 0, words: 0 }
    s.chapters += 1
    s.words += c.words || 0
    stats.set(c.novel_id, s)
  }

  return novels.map((novel) => ({
    novel,
    chapters: stats.get(novel.id)?.chapters ?? 0,
    words: stats.get(novel.id)?.words ?? 0,
  }))
}
