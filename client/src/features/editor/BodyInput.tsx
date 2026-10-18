import { useCallback, useEffect, useRef, type RefObject } from 'react'

interface BodyInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  defaultValue: string
  onDraftChange: (value: string) => void
  onSchedule: () => void
  onCancelSchedule: () => void
  onFlush: () => void
}

/**
 * 正文输入。**非受控 textarea**，不用 contenteditable。
 *
 * - 受控 value 会在每次按键把全部内容塞回 DOM，中文输入法下重置候选词、打断组词
 * - contenteditable 在中文输入法里光标乱跳、粘贴带样式；小说写作不需要富文本
 */
export function BodyInput({
  textareaRef,
  defaultValue,
  onDraftChange,
  onSchedule,
  onCancelSchedule,
  onFlush,
}: BodyInputProps) {
  const composing = useRef(false)

  const resize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [textareaRef])

  useEffect(() => {
    resize()
  }, [defaultValue, resize])

  return (
    <textarea
      ref={textareaRef}
      className="chapter-body"
      defaultValue={defaultValue}
      placeholder="开始写作…"
      spellCheck={false}
      onChange={(e) => {
        if (composing.current) return
        onDraftChange(e.currentTarget.value)
        resize()
        onSchedule()
      }}
      onCompositionStart={() => {
        composing.current = true
        // 组词期间的中间态不落盘
        onCancelSchedule()
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        // Android WebView 上部分输入法 compositionend 早于最后一次 input，
        // 不要相信事件负载，等一拍再从 textarea.value 取值
        const ta = e.currentTarget
        window.setTimeout(() => {
          onDraftChange(ta.value)
          resize()
          onSchedule()
        }, 0)
      }}
      onBlur={onFlush}
    />
  )
}
