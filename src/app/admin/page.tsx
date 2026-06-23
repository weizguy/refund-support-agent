'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '@/app/api/admin/traces/route'
import type { TraceEntry } from '@/app/api/admin/traces/[sessionId]/route'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const TOOL_COLORS: Record<string, string> = {
  lookupCustomer:    'bg-purple-100 text-purple-800',
  lookupOrder:       'bg-blue-100 text-blue-800',
  checkRefundPolicy: 'bg-yellow-100 text-yellow-800',
  escalateToHuman:   'bg-orange-100 text-orange-800',
  issueRefund:       'bg-green-100 text-green-800',
}

function ToolBadge({ name }: { name: string | null }) {
  const label = name ?? 'unknown'
  const colour = TOOL_COLORS[label] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-full ${colour}`}>
      {label}
    </span>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span className="text-gray-400 text-xs italic">—</span>
  return (
    <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  s,
  selected,
  onClick,
}: {
  s: SessionSummary
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {s.customerName ?? 'Unknown customer'}
          </p>
          <p className="text-xs font-mono text-gray-400 truncate">{s.sessionId.slice(0, 16)}…</p>
        </div>
        <p className="text-xs text-gray-400 shrink-0">{ago(s.startedAt)}</p>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-gray-500">
        <span>{s.toolCallCount} calls</span>
        <span>·</span>
        <span>{(s.totalInputTokens + s.totalOutputTokens).toLocaleString()} tok</span>
        <span>·</span>
        <span>{fmt(s.totalLatencyMs)}</span>
        {s.hadRetry && (
          <span className="ml-1 bg-yellow-100 text-yellow-700 px-1.5 rounded-full">retry</span>
        )}
        {s.hadError && (
          <span className="ml-1 bg-red-100 text-red-700 px-1.5 rounded-full">error</span>
        )}
      </div>
    </button>
  )
}

// ─── Trace detail ─────────────────────────────────────────────────────────────

function TraceDetail({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<TraceEntry[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setEntries(null)
    fetch(`/api/admin/traces/${sessionId}`)
      .then((r) => r.json())
      .then((data: TraceEntry[]) => setEntries(data))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Loading trace…
      </div>
    )
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        No trace entries found.
      </div>
    )
  }

  const totalTokens = entries.reduce(
    (acc, e) => acc + (e.inputTokens ?? 0) + (e.outputTokens ?? 0),
    0,
  )
  const totalLatency = entries.reduce((acc, e) => acc + (e.latencyMs ?? 0), 0)
  const retries = entries.filter((e) => e.isRetry).length
  const errors = entries.filter((e) => e.errorMsg).length

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 text-sm bg-white border border-gray-200 rounded-xl px-4 py-3">
        <div>
          <span className="text-gray-500">Tool calls</span>{' '}
          <span className="font-semibold text-gray-900">{entries.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Total tokens</span>{' '}
          <span className="font-semibold text-gray-900">{totalTokens.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500">Total latency</span>{' '}
          <span className="font-semibold text-gray-900">{fmt(totalLatency)}</span>
        </div>
        {retries > 0 && (
          <div>
            <span className="text-yellow-600 font-medium">{retries} retr{retries === 1 ? 'y' : 'ies'}</span>
          </div>
        )}
        {errors > 0 && (
          <div>
            <span className="text-red-600 font-medium">{errors} error{errors === 1 ? '' : 's'}</span>
          </div>
        )}
        <div className="ml-auto text-xs text-gray-400 font-mono self-center truncate max-w-xs">
          {sessionId}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative space-y-3 pl-4">
        <div className="absolute left-0 top-2 bottom-2 w-px bg-gray-200" />
        {entries.map((entry, i) => (
          <div key={entry.id} className="relative">
            {/* Timeline dot */}
            <div
              className={`absolute -left-[17px] top-3 w-2.5 h-2.5 rounded-full border-2 border-white ${
                entry.errorMsg
                  ? 'bg-red-400'
                  : entry.isRetry
                  ? 'bg-yellow-400'
                  : 'bg-blue-400'
              }`}
            />

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Tool call header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
                <span className="text-xs text-gray-400 font-mono w-5 text-right shrink-0">
                  {i + 1}
                </span>
                <ToolBadge name={entry.toolName} />
                {entry.isRetry && (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">
                    retry
                  </span>
                )}
                {entry.errorMsg && (
                  <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                    error
                  </span>
                )}
                <div className="ml-auto flex items-center gap-3 text-xs text-gray-500">
                  {entry.latencyMs != null && (
                    <span className="font-medium">{fmt(entry.latencyMs)}</span>
                  )}
                  {(entry.inputTokens != null || entry.outputTokens != null) && (
                    <span>
                      {(entry.inputTokens ?? 0) + (entry.outputTokens ?? 0)} tok
                      <span className="text-gray-400 ml-1">
                        (in {entry.inputTokens ?? 0} / out {entry.outputTokens ?? 0})
                      </span>
                    </span>
                  )}
                  <span className="text-gray-400">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Input / Output */}
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                <div className="p-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Input
                  </p>
                  <JsonBlock value={entry.toolInput} />
                </div>
                <div className="p-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Output
                  </p>
                  <JsonBlock value={entry.toolOutput} />
                </div>
              </div>

              {/* Error message */}
              {entry.errorMsg && (
                <div className="px-3 py-2 bg-red-50 border-t border-red-100">
                  <p className="text-xs text-red-700 font-mono">{entry.errorMsg}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/traces')
      .then((r) => r.json())
      .then((data: SessionSummary[]) => {
        setSessions(data)
        if (data.length > 0 && !selectedId) setSelectedId(data[0].sessionId)
      })
      .catch(() => setError('Failed to load sessions.'))
      .finally(() => setLoading(false))
  }, [selectedId])

  useEffect(() => {
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
          AD
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Admin — Trace Viewer</p>
          <p className="text-xs text-gray-500">{sessions.length} sessions</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            Refresh
          </button>
          <a
            href="/"
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            ← Chat
          </a>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        <aside className="w-72 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-3 space-y-2">
            {loading && (
              <p className="text-xs text-gray-400 text-center py-8">Loading sessions…</p>
            )}
            {error && (
              <p className="text-xs text-red-500 text-center py-8">{error}</p>
            )}
            {!loading && sessions.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-8">
                No sessions yet. Send a chat message first.
              </p>
            )}
            {sessions.map((s) => (
              <SessionCard
                key={s.sessionId}
                s={s}
                selected={s.sessionId === selectedId}
                onClick={() => setSelectedId(s.sessionId)}
              />
            ))}
          </div>
        </aside>

        {/* Trace detail */}
        <main className="flex-1 overflow-y-auto p-4">
          {selectedId ? (
            <TraceDetail key={selectedId} sessionId={selectedId} />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">
              Select a session to view its trace.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
