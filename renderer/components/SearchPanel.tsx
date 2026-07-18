import React, { useState, useRef, useEffect } from 'react'
import { TbSearch } from 'react-icons/tb'
import { useThreadStore } from '../lib/threadStore'
import * as Sentry from '@sentry/electron/renderer'
import { toast } from '../lib/toast'

export function SearchPanel(): React.JSX.Element {
  const selectSession = useThreadStore((s) => s.selectSession)
  const setActiveNav = useThreadStore((s) => s.setActiveNav)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<
    { sessionId: string; title: string; role: string; text: string }[]
  >([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleQueryChange = (val: string): void => {
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQuery(val), 400)
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    const normalizedQuery = debouncedQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      setResults([])
      setSearching(false)
      setError(null)
      return
    }
    setSearching(true)
    setError(null)
    ;(async () => {
      try {
        const matches = await window.api.sessionSearch({ query: debouncedQuery })
        if (cancelled) return
        setResults(matches)
        setSearching(false)
      } catch (err: unknown) {
        Sentry.captureException(err)
        toast.error('Search failed.', err)
        if (!cancelled) {
          setError('Failed to query message history.')
          setSearching(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  return (
    <div className="flex-1 flex flex-col p-6 bg-oc-base overflow-hidden">
      <h2 className="text-xl font-bold text-tx-bright mb-4 flex items-center gap-2">
        <TbSearch size={22} /> Global Search
      </h2>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search message history..."
          className="flex-1 bg-oc-raised border border-oc-border rounded-lg px-3 py-2 text-sm text-tx-main placeholder:text-tx-dim focus:outline-none focus:border-oc-active"
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-3">
        {results.length > 0 ? (
          results.map((r, i) => (
            <button
              type="button"
              key={`${r.sessionId}-${r.role}-${i}`}
              onClick={() => {
                void selectSession(r.sessionId)
                setActiveNav(undefined)
              }}
              className="p-3 bg-oc-surface border border-oc-border rounded-lg hover:border-oc-active transition-colors cursor-pointer text-left"
            >
              <div className="flex justify-between text-xs text-tx-muted mb-1 font-semibold">
                <span>{r.title}</span>
                <span className="capitalize px-1.5 bg-oc-raised rounded border border-oc-border">
                  {r.role}
                </span>
              </div>
              <p className="text-sm text-tx-main line-clamp-2 whitespace-pre-wrap">{r.text}</p>
            </button>
          ))
        ) : searching ? (
          <p className="text-center text-sm text-tx-dim py-8">Searching conversations...</p>
        ) : error ? (
          <p className="text-center text-sm text-destructive py-8">{error}</p>
        ) : query.trim() ? (
          <p className="text-center text-sm text-tx-dim py-8">No results found.</p>
        ) : (
          <p className="text-center text-sm text-tx-dim py-8">
            Type to search across all sessions.
          </p>
        )}
      </div>
    </div>
  )
}

