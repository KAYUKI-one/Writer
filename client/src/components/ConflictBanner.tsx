import type { LocalChapter } from '../db/schema'

interface ConflictBannerProps {
  chapter: LocalChapter
  copyChapter: LocalChapter | undefined
  onShowDiff: () => void
  onOpenCopy: (copyId: string) => void
  onKeepMine: () => void
  onUseTheirs: () => void
  onRestoreRemoteDeleted: () => void
  onDeleteLocal: () => void
}

/**
 * 标题下方的一行浅琥珀小字。**无按钮不打断书写** —— 只有文字链。
 * 三种情况：远端改了正文（shadow）、服务端分叉出副本、远端删了但本地有改动。
 */
export function ConflictBanner({
  chapter,
  copyChapter,
  onShowDiff,
  onOpenCopy,
  onKeepMine,
  onUseTheirs,
  onRestoreRemoteDeleted,
  onDeleteLocal,
}: ConflictBannerProps) {
  if (chapter.remote_deleted) {
    return (
      <div className="conflict-banner">
        <span>另一台设备删除了本章，你本地仍有未同步的修改。</span>
        <button type="button" className="inline-link" onClick={onRestoreRemoteDeleted}>
          恢复并保留我的
        </button>
        <button type="button" className="inline-link danger" onClick={onDeleteLocal}>
          删除本地
        </button>
      </div>
    )
  }

  if (chapter.shadow) {
    return (
      <div className="conflict-banner">
        <span>本章在另一台设备上也被修改过。</span>
        <button type="button" className="inline-link" onClick={onShowDiff}>
          查看对照
        </button>
        <button type="button" className="inline-link" onClick={onKeepMine}>
          保留我的
        </button>
        <button type="button" className="inline-link" onClick={onUseTheirs}>
          用对方的版本
        </button>
      </div>
    )
  }

  if (chapter.conflict_copy_id) {
    return (
      <div className="conflict-banner">
        <span>本章在另一台设备上也被修改过，另一版已保存为副本。</span>
        {copyChapter && (
          <button
            type="button"
            className="inline-link"
            onClick={() => onOpenCopy(copyChapter.id)}
          >
            查看副本
          </button>
        )}
        <button type="button" className="inline-link" onClick={onKeepMine}>
          保留我的
        </button>
        {copyChapter && (
          <button type="button" className="inline-link" onClick={onUseTheirs}>
            用副本替换
          </button>
        )}
      </div>
    )
  }

  return null
}
