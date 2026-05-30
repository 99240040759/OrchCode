import React, { useState, useRef, useEffect } from 'react'
import { Plus, ChevronDown, ArrowRight, Square } from 'lucide-react'
import { useAtomValue, useAtom } from 'jotai'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { agentRunStateAtom, sessionTokensAtom, selectedModelAtom } from '../store/agentStore'
import { estimateTokens } from '../lib/tokenizer'

interface InputBarProps {
  onSubmit?: (val: string, mode?: string) => void
  onStop?: () => void
}

const PLANNING_MODES = ['Planning', 'Code', 'Debug', 'Explain'] as const
type PlanningMode = (typeof PLANNING_MODES)[number]

const MAX_TOKENS = 200_000
const RING_RADIUS = 9
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ringColor(fraction: number): string {
  if (fraction >= 0.95) return '#ef4444'
  if (fraction >= 0.80) return '#f59e0b'
  if (fraction >= 0.50) return '#10b981'
  return '#5e5e5e'
}

export const InputBar: React.FC<InputBarProps> = ({ onSubmit, onStop }) => {
  const [inputValue, setInputValue] = useState('')
  const [planningMode, setPlanningMode] = useState<PlanningMode>('Planning')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const runState = useAtomValue(agentRunStateAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)

  const sessionTokens = useAtomValue(sessionTokensAtom)

  const isRunning = runState !== 'idle' && runState !== 'error'

  const [inputEstimate, setInputEstimate] = useState(0)

  useEffect(() => {
    let active = true
    const delayDebounce = setTimeout(async () => {
      if (!inputValue) {
        setInputEstimate(0)
        return
      }
      try {
        const tokens = await estimateTokens(inputValue)
        if (active) setInputEstimate(tokens)
      } catch (err) {
        console.error('[InputBar] Token estimation error:', err)
      }
    }, 60)

    return () => {
      active = false
      clearTimeout(delayDebounce)
    }
  }, [inputValue])

  const displayTotal = sessionTokens + inputEstimate
  const fraction = Math.min(displayTotal / MAX_TOKENS, 1)
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction)
  const color = ringColor(fraction)
  const formattedTokens = displayTotal >= 1000
    ? `${(displayTotal / 1000).toFixed(1)}k`
    : String(displayTotal)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [inputValue])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    const val = inputValue.trim()
    if (!val || isRunning) return
    onSubmit?.(val, planningMode)
    setInputValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleStop = () => onStop?.()

  return (
    <div className="input-bar-container">
      <textarea
        ref={textareaRef}
        rows={1}
        className="input-bar-text-area"
        placeholder="Ask anything, @ to mention"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isRunning}
        style={{ opacity: isRunning ? 0.7 : 1 }}
      />

      <div className="input-bar-toolbar">
        <div className="input-bar-toolbar-left">
          <div className="toolbar-icon-btn" title="Add context or file">
            <Plus size={16} style={{ color: 'var(--text-secondary)' }} />
          </div>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-selector" title="Select mode" style={{ cursor: 'pointer' }}>
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>{planningMode}</span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                style={{
                  background: 'var(--bg-sidebar)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '4px 0',
                  minWidth: 140,
                  zIndex: 1000,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                }}
                sideOffset={6}
              >
                {PLANNING_MODES.map((mode) => (
                  <DropdownMenu.Item
                    key={mode}
                    onSelect={() => setPlanningMode(mode)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 13,
                      color: mode === planningMode ? 'var(--text-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      outline: 'none',
                      fontFamily: 'var(--font-display)',
                      background: mode === planningMode ? 'rgba(255,255,255,0.05)' : 'transparent'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = mode === planningMode ? 'rgba(255,255,255,0.05)' : 'transparent')
                    }
                  >
                    {mode}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <div className="toolbar-selector" title="Select model" style={{ cursor: 'pointer' }}>
                <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>
                  {selectedModel === 'gemini' 
                    ? 'Gemini 3.1 Flash Lite (FAST)' 
                    : 'Gemma (Thinking)'
                  }
                </span>
              </div>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                style={{
                  background: 'var(--bg-sidebar)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  padding: '4px 0',
                  minWidth: 200,
                  zIndex: 1000,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
                }}
                sideOffset={6}
              >
                <DropdownMenu.Item
                  onSelect={() => setSelectedModel('gemini')}
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    color: selectedModel === 'gemini' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'var(--font-display)',
                    background: selectedModel === 'gemini' ? 'rgba(255,255,255,0.05)' : 'transparent'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = selectedModel === 'gemini' ? 'rgba(255,255,255,0.05)' : 'transparent')
                  }
                >
                  <span style={{ fontWeight: 500 }}>Gemini 3.1 Flash Lite (FAST)</span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setSelectedModel('gemma')}
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    color: selectedModel === 'gemma' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'var(--font-display)',
                    background: selectedModel === 'gemma' ? 'rgba(255,255,255,0.05)' : 'transparent'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = selectedModel === 'gemma' ? 'rgba(255,255,255,0.05)' : 'transparent')
                  }
                >
                  <span style={{ fontWeight: 500 }}>Gemma (Thinking)</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="input-bar-toolbar-right">
          <div
            className="token-ring-wrapper"
            title={`${displayTotal.toLocaleString()} / ${MAX_TOKENS.toLocaleString()} tokens\n(${(fraction * 100).toFixed(1)}% context filled)`}
          >
            <svg
              width={RING_RADIUS * 2 + 4}
              height={RING_RADIUS * 2 + 4}
              viewBox={`0 0 ${RING_RADIUS * 2 + 4} ${RING_RADIUS * 2 + 4}`}
              style={{ transform: 'rotate(-90deg)' }}
            >
              <circle
                cx={RING_RADIUS + 2}
                cy={RING_RADIUS + 2}
                r={RING_RADIUS}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={2}
              />
              <circle
                cx={RING_RADIUS + 2}
                cy={RING_RADIUS + 2}
                r={RING_RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
              />
            </svg>
            {fraction > 0.05 && (
              <span className="token-ring-label" style={{ color }}>
                {formattedTokens}
              </span>
            )}
          </div>

          {isRunning ? (
            <button
              className="toolbar-submit-btn"
              onClick={handleStop}
              title="Stop generation"
              style={{ background: '#3a3a3a' }}
            >
              <Square size={11} strokeWidth={3} style={{ color: 'var(--text-primary)' }} />
            </button>
          ) : (
            <button
              className="toolbar-submit-btn"
              onClick={handleSend}
              title="Submit"
              disabled={!inputValue.trim()}
              style={{ opacity: inputValue.trim() ? 1 : 0.4 }}
            >
              <ArrowRight size={14} strokeWidth={2.5} style={{ color: 'var(--text-primary)' }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default InputBar
