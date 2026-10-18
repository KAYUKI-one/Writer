import { useEffect, useRef, useState } from 'react'

import { ConflictBanner } from '../../components/ConflictBanner'
import { ConflictDiff } from '../../components/ConflictDiff'
import {
  adoptConflictCopy,
  adoptShadow,
  deleteChapter,
  keepMine,
  restoreRemoteDeleted,
} from '../../db/repo.chapters'
import type { LocalChapter } from '../../db/schema'
import { useAutosave } from '../../hooks/useAutosave'
import { countWords, formatCount } from '../../lib/wordcount'
import { requestSync } from '../../sync/engine'
import { BodyInput } from './BodyInput'
import { TitleInput } from './TitleInput'

interface ChapterEditorProps {
  chapter: LocalChapter
  chapters: LocalChapter[]
  onReload: () => Promise<void>
  onSelectChapter: (id: string) => void
}

const PUSH_AFTER_SAVE_MS = 3_000

/**
 * 单章编辑器。
 *
 * 用 key={chapter.id} 挂载，切换章节即换一个实例 —— 标题和正文的 ref、
 * 防抖计时器都跟着章节走，不会把上一章的字串到下一章。
 */
export function ChapterEditor({
  chapter,
  chapters,
  onReload,
  onSelectChapter,
}: ChapterEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const titleDraft = useRef(chapter.title)
  const contentDraft = useRef(chapter.content)
  const lastRemoteContent = useRef(chapter.content)
  const lastRemoteTitle = useRef(chapter.title)

  const [words, setWords] = useState(chapter.words)
  const [showDiff, setShowDiff] = useState(false)
  const [diffMine, setDiffMine] = useState('')
  const pushTimer = useRef<number | null>(null)

  const autosave = useAutosave(
    chapter.id,
    // 直接读 DOM：中文输入法 compositionend 与 blur 的先后顺序在不同浏览器上
    // 不一致，ref 缓冲可能落后一拍；DOM 里的值永远是用户看到的那个。
    () => ({
      title: titleRef.current?.value ?? titleDraft.current,
      content: bodyRef.current?.value ?? contentDraft.current,
    }),
    (draft) => {
      setWords(countWords(draft.content))
      // 停笔 3s 后推一次。落盘是可靠的，推送失败也不影响继续写。
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current)
      pushTimer.current = window.setTimeout(() => {
        pushTimer.current = null
        void requestSync('autosave')
      }, PUSH_AFTER_SAVE_MS)
    },
  )

  useEffect(() => {
    return () => {
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current)
    }
  }, [])

  // 远端拉下来的新内容：只在本地干净、且用户没在输入时替换 DOM。
  // 正在编辑的 textarea 一旦被程序改写，浏览器原生撤销栈会被清空。
  useEffect(() => {
    const next = chapter.content
    if (next === lastRemoteContent.current) return
    lastRemoteContent.current = next

    const ta = bodyRef.current
    if (!ta || chapter.dirty === 1 || document.activeElement === ta) return
    ta.value = next
    contentDraft.current = next
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    setWords(chapter.words)
  }, [chapter.content, chapter.dirty, chapter.words])

  useEffect(() => {
    const next = chapter.title
    if (next === lastRemoteTitle.current) return
    lastRemoteTitle.current = next

    const input = titleRef.current
    if (!input || chapter.dirty === 1 || document.activeElement === input) return
    input.value = next
    titleDraft.current = next
  }, [chapter.title, chapter.dirty])

  const copyChapter = chapters.find(
    (c) => c.conflict_of === chapter.id || c.id === chapter.conflict_copy_id,
  )

  async function applyAndReload(action: () => Promise<unknown>) {
    await action()
    await onReload()
  }

  async function adoptTheirs() {
    if (chapter.shadow) {
      await applyAndReload(() => adoptShadow(chapter.id))
    } else if (copyChapter) {
      await applyAndReload(() => adoptConflictCopy(chapter.id, copyChapter.id))
    }
    setShowDiff(false)
  }

  async function deleteLocal() {
    if (!window.confirm('删除本章？本机上的正文会被移除。')) return
    // 重载后本章从列表消失，WritingPage 会自动选中下一章
    await applyAndReload(() => deleteChapter(chapter.id))
  }

  return (
    <article className="chapter-editor">
      <div className="chapter-heading">
        <TitleInput
          inputRef={titleRef}
          defaultValue={chapter.title}
          onDraftChange={(value) => {
            titleDraft.current = value
          }}
          onSchedule={autosave.schedule}
          onFlush={() => void autosave.flush()}
          onEnter={() => bodyRef.current?.focus()}
        />

        <ConflictBanner
          chapter={chapter}
          copyChapter={copyChapter}
          onShowDiff={() => {
            setDiffMine(contentDraft.current)
            setShowDiff(true)
          }}
          onOpenCopy={onSelectChapter}
          onKeepMine={() => void applyAndReload(() => keepMine(chapter.id))}
          onUseTheirs={() => void adoptTheirs()}
          onRestoreRemoteDeleted={() =>
            void applyAndReload(() => restoreRemoteDeleted(chapter.id))
          }
          onDeleteLocal={() => void deleteLocal()}
        />
      </div>

      <BodyInput
        textareaRef={bodyRef}
        defaultValue={chapter.content}
        onDraftChange={(value) => {
          contentDraft.current = value
        }}
        onSchedule={() => {
          autosave.schedule()
        }}
        onCancelSchedule={autosave.cancel}
        onFlush={() => void autosave.flush()}
      />

      <footer className="chapter-footer">
        <span>{formatCount(words)} 字</span>
        <span>{autosave.saving ? '保存中…' : '已保存'}</span>
      </footer>

      {showDiff && chapter.shadow && (
        <ConflictDiff
          title={chapter.title}
          mine={diffMine}
          theirs={chapter.shadow.content}
          theirsLabel="另一台设备"
          onClose={() => setShowDiff(false)}
        />
      )}
    </article>
  )
}
