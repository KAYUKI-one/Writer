import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { SyncBadge } from '../../components/SyncBadge'
import { createChapter, deleteChapter, listChapters } from '../../db/repo.chapters'
import { getNovel, renameNovel } from '../../db/repo.novels'
import type { LocalChapter, LocalNovel } from '../../db/schema'
import { useDataVersion } from '../../stores/dataVersion'
import { ChapterDrawer } from './ChapterDrawer'
import { ChapterEditor } from './ChapterEditor'

export function WritingPage() {
  const { novelId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const version = useDataVersion((s) => s.version)

  const [novel, setNovel] = useState<LocalNovel | null>(null)
  const [chapters, setChapters] = useState<LocalChapter[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const creating = useRef(false)

  const load = useCallback(async () => {
    const [nextNovel, nextChapters] = await Promise.all([
      getNovel(novelId),
      listChapters(novelId),
    ])
    setNovel(nextNovel ?? null)
    setChapters(nextChapters)
    setLoaded(true)
    return nextChapters
  }, [novelId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- load 先 await 读库，setState 不在渲染期同步发生
    void load()
  }, [load, version])

  const activeId = searchParams.get('c')
  const active = chapters?.find((c) => c.id === activeId) ?? null

  const selectChapter = useCallback(
    (id: string) => setSearchParams({ c: id }, { replace: true }),
    [setSearchParams],
  )

  // 章节选择：URL 里的 id 失效时回到第一章；一本书一章都没有时自动建第一章。
  // StrictMode 会双执行 effect，用 ref 保证不会建出两章。
  useEffect(() => {
    if (!novel || !chapters || active) return
    if (chapters.length > 0) {
      selectChapter(chapters[0].id)
      return
    }
    if (creating.current) return
    creating.current = true
    void createChapter(novel.id, '第一章')
      .then(async (chapter) => {
        await load()
        selectChapter(chapter.id)
      })
      .finally(() => {
        creating.current = false
      })
  }, [novel, chapters, active, selectChapter, load])

  /** 冲突处理完后的重载：先读库，再换 key 强制编辑器用新正文重建。 */
  const reload = useCallback(async () => {
    await load()
    setEpoch((value) => value + 1)
  }, [load])

  async function onCreateChapter() {
    if (!novel) return
    const chapter = await createChapter(novel.id, `第${(chapters?.length ?? 0) + 1}章`)
    await load()
    selectChapter(chapter.id)
    setDrawerOpen(false)
  }

  async function onDeleteChapter(chapter: LocalChapter) {
    if (!window.confirm(`删除「${chapter.title || '未命名章节'}」？`)) return
    await deleteChapter(chapter.id)
    await load()
    setEpoch((value) => value + 1)
  }

  async function onRenameNovel(title: string) {
    await renameNovel(novelId, title)
    setNovel((await getNovel(novelId)) ?? null)
  }

  if (!loaded) return null

  if (!novel) {
    return (
      <main className="page">
        <div className="empty-state">
          <p>这本小说不存在，或已被删除。</p>
          <Link to="/" className="primary-button">
            返回小说列表
          </Link>
        </div>
      </main>
    )
  }

  return (
    <div className="writing-page">
      <button
        type="button"
        className="drawer-toggle"
        onClick={() => setDrawerOpen(true)}
        aria-label="打开目录"
      >
        ☰
      </button>

      {active && chapters ? (
        <ChapterEditor
          key={`${active.id}:${epoch}`}
          chapter={active}
          chapters={chapters}
          onReload={reload}
          onSelectChapter={selectChapter}
        />
      ) : (
        <div className="editor-loading" />
      )}

      <ChapterDrawer
        open={drawerOpen}
        novel={novel}
        chapters={chapters ?? []}
        activeId={active?.id ?? ''}
        onSelect={selectChapter}
        onCreate={() => void onCreateChapter()}
        onDelete={(chapter) => void onDeleteChapter(chapter)}
        onRenameNovel={(title) => void onRenameNovel(title)}
        onClose={() => setDrawerOpen(false)}
      />

      <SyncBadge />
    </div>
  )
}
