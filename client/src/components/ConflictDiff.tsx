import { formatCount, countWords } from '../lib/wordcount'

interface ConflictDiffProps {
  title: string
  mine: string
  theirs: string
  theirsLabel: string
  onClose: () => void
}

/** 冲突两版对照。只读，选择动作在 ConflictBanner 上。 */
export function ConflictDiff({ title, mine, theirs, theirsLabel, onClose }: ConflictDiffProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="conflict-diff" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="panel-header">
          <strong>{title ? `${title} · 两版对照` : '两版对照'}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="diff-columns">
          <section className="diff-column">
            <header>我的版本 · {formatCount(countWords(mine))} 字</header>
            <pre>{mine || '（空）'}</pre>
          </section>
          <section className="diff-column">
            <header>
              {theirsLabel} · {formatCount(countWords(theirs))} 字
            </header>
            <pre>{theirs || '（空）'}</pre>
          </section>
        </div>

        <p className="diff-hint">两版都还在。关掉这个窗口后，用横幅上的按钮决定保留哪一版。</p>
      </div>
    </div>
  )
}
