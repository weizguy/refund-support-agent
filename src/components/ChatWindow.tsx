'use client'

import { useEffect, useRef, useState } from 'react'
import type { CustomerSummary } from '@/app/api/customers/route'

// History is opaque to the UI — we receive it from the API and pass it back.
type AgentHistory = unknown[]

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ─── Minimal markdown renderer ────────────────────────────────────────────────
// Handles the patterns the agent actually produces: **bold**, `code`,
// - bullet lists, blank lines between paragraphs.

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      nodes.push(
        <ul key={key} className="list-disc ml-4 space-y-0.5 my-1">
          {listItems}
        </ul>,
      )
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    const key = String(i)
    if (/^[-*] /.test(line)) {
      listItems.push(<li key={key}>{renderInline(line.slice(2))}</li>)
      return
    }
    flushList(`list-${i}`)

    if (line.trim() === '') {
      nodes.push(<div key={key} className="h-2" />)
    } else if (line.startsWith('### ')) {
      nodes.push(<p key={key} className="font-semibold mt-1">{renderInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      nodes.push(<p key={key} className="font-bold mt-1">{renderInline(line.slice(3))}</p>)
    } else {
      nodes.push(<p key={key}>{renderInline(line)}</p>)
    }
  })

  flushList('list-end')
  return <div className="space-y-0.5">{nodes}</div>
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm shadow-sm'
        }`}
      >
        {isUser ? msg.content : <Markdown text={msg.content} />}
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatWindow() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [customerId, setCustomerId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [history, setHistory] = useState<AgentHistory>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Fetch customer list on mount
  useEffect(() => {
    fetch('/api/customers')
      .then((r) => r.json())
      .then((data: CustomerSummary[]) => {
        setCustomers(data)
        if (data.length > 0) setCustomerId(data[0].id)
      })
      .catch(() => setError('Failed to load customer list.'))
  }, [])

  // Scroll to bottom whenever messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Reset conversation when customer changes
  const handleCustomerChange = (id: string) => {
    setCustomerId(id)
    setMessages([])
    setSessionId(undefined)
    setHistory([])
    setError(null)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || !customerId || isLoading) return

    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, message: text, sessionId, history }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setMessages((prev) => prev.slice(0, -1)) // remove the optimistic user message
        return
      }

      setSessionId(data.sessionId)
      setHistory(data.updatedHistory)
      setMessages((prev) => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      setError('Network error. Please try again.')
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const selectedCustomer = customers.find((c) => c.id === customerId)

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
          RS
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Refund Support</p>
          <p className="text-xs text-gray-500 truncate">
            {selectedCustomer ? `${selectedCustomer.name} · ${selectedCustomer.email}` : 'Loading…'}
          </p>
        </div>
        <div className="ml-auto shrink-0">
          <select
            value={customerId}
            onChange={(e) => handleCustomerChange(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Select customer"
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-2">
            <p className="text-sm">Hi {selectedCustomer?.name?.split(' ')[0] ?? 'there'}!</p>
            <p className="text-xs">How can I help you today?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isLoading && <TypingIndicator />}
        {error && (
          <div className="text-center">
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 inline-block">
              {error}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
        {sessionId && (
          <p className="text-xs text-gray-400 mb-2 font-mono truncate">
            Session: {sessionId}
          </p>
        )}
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            disabled={isLoading || !customerId}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={send}
            disabled={isLoading || !input.trim() || !customerId}
            className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
