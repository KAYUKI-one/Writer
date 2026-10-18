import { useRef, type RefObject } from 'react'

interface TitleInputProps {
  inputRef: RefObject<HTMLInputElement | null>
  defaultValue: string
  onDraftChange: (value: string) => void
  onSchedule: () => void
  onFlush: () => void
  onEnter: () => void
}

/**
 * 无边框标题输入。
 *
 * 非受控（defaultValue + ref）：受控 input 在中文输入法组词时会打断候选词。
 */
export function TitleInput({
  inputRef,
  defaultValue,
  onDraftChange,
  onSchedule,
  onFlush,
  onEnter,
}: TitleInputProps) {
  const composing = useRef(false)

  return (
    <input
      ref={inputRef}
      className="chapter-title"
      defaultValue={defaultValue}
      placeholder="章节标题"
      spellCheck={false}
      onChange={(e) => {
        if (composing.current) return
        onDraftChange(e.currentTarget.value)
        onSchedule()
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={(e) => {
        composing.current = false
        // 部分安卓输入法 compositionend 早于最后一次 input，延后取 DOM 值
        const input = e.currentTarget
        window.setTimeout(() => {
          onDraftChange(input.value)
          onSchedule()
        }, 0)
      }}
      onBlur={onFlush}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || composing.current) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onFlush()
          onEnter()
        }
      }}
    />
  )
}
