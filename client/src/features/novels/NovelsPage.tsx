import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SyncBadge } from '../../components/SyncBadge'
import {
  createNovel,
  deleteNovel,
  listNovelSummaries,
  renameNovel,
  type NovelSummary,
} from '../../db/repo.novels'
import { formatCount } from '../../lib/wordcount'
import { formatRelative } from '../../lib/time'
import { useDataVersion } from '../../stores/dataVersion'

export function NovelsPage() {
  const navigate = useNavigate()
  const version = useDataVersion((s) => s.version)
  const [novels, setNovels] = useState<NovelSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void listNovelSummaries().then((list) => {
      if (!cancelled) setNovels(list)
    })
    return () => {
      cancelled = true
    }
  }, [version])

  async function onCreate() {
    const novel = await createNovel()
    navigate(`/novel/${novel.id}`)
  }

  async function onRename(summary: NovelSummary) {
    const next = window.prompt('小说名称', summary.novel.title)
    if (next === null) return
    await renameNovel(summary.novel.id, next)
    setNovels(await listNovelSummaries())
  }

  async function onDelete(summary: NovelSummary) {
    const ok = window.confirm(
      `确定删除《${summary.novel.title}》？\n\n小说和全部章节会从所有设备上删除，无法恢复。`,
    )
    if (!ok) return
    await deleteNovel(summary.novel.id)
    setNovels(await listNovelSummaries())
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1 className="page-title">我的小说</h1>
        <button type="button" className="ghost-button" onClick={() => void onCreate()}>
          ＋ 新小说
        </button>
      </header>

      {novels === null ? null : novels.length === 0 ? (
        <div className="empty-state">
          <p>还没有小说。</p>
          <button type="button" className="primary-button" onClick={() => void onCreate()}>
            写第一本
          </button>
        </div>
      ) : (
        <ul className="novel-list">
          {novels.map((summary) => (
            <li key={summary.novel.id} className="novel-card">
              <button
                type="button"
                className="novel-open"
                onClick={() => navigate(`/novel/${summary.novel.id}`)}
              >
                <span className="novel-title">{summary.novel.title || '未命名'}</span>
                <span className="novel-meta">
                  {summary.chapters} 章 · {formatCount(summary.words)} 字 ·{' '}
                  {formatRelative(summary.novel.server_updated_at_ms || summary.novel.updated_at_ms)}
                </span>
              </button>

              <div className="novel-actions">
                <button type="button" className="link-button" onClick={() => void onRename(summary)}>
                  重命名
                </button>
                <button
                  type="button"
                  className="link-button danger"
                  onClick={() => void onDelete(summary)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SyncBadge />
    </main>
  )
}
