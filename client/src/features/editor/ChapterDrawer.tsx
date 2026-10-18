import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import type { LocalChapter, LocalNovel } from '../../db/schema'

interface ChapterDrawerProps {
  open: boolean
  novel: LocalNovel
  chapters: LocalChapter[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (chapter: LocalChapter) => void
  onRenameNovel: (title: string) => void
  onClose: () => void
}

export function ChapterDrawer({
  open,
  novel,
  chapters,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRenameNovel,
  onClose,
}: ChapterDrawerProps) {
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <Link to="/" className="drawer-back">
            ← 我的小说
          </Link>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <input
          ref={titleRef}
          className="novel-title-input"
          defaultValue={novel.title}
          spellCheck={false}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim()
            if (value && value !== novel.title) onRenameNovel(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              titleRef.current?.blur()
            }
          }}
          aria-label="小说名称"
        />

        <div className="drawer-section-title">
          <span>章节</span>
          <button type="button" className="link-button" onClick={onCreate}>
            ＋ 新建
          </button>
        </div>

        <ol className="chapter-list">
          {chapters.map((chapter, index) => (
            <li key={chapter.id}>
              <button
                type="button"
                className={`chapter-item${chapter.id === activeId ? ' active' : ''}`}
                onClick={() => {
                  onSelect(chapter.id)
                  onClose()
                }}
              >
                <span className="chapter-index">{index + 1}</span>
                <span className="chapter-name">{chapter.title || '未命名章节'}</span>
                {chapter.conflict_of ? <span className="chapter-tag">副本</span> : null}
              </button>
              <button
                type="button"
                className="chapter-delete"
                aria-label="删除本章"
                onClick={() => onDelete(chapter)}
              >
                ×
              </button>
            </li>
          ))}
        </ol>

        {chapters.length === 0 && <p className="drawer-empty">还没有章节。</p>}
      </aside>
    </div>
  )
}
