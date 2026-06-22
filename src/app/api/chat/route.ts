import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runAgent } from '@lib/agent/loop'
import type { AgentMessage } from '@lib/agent/types'

export interface ChatRequest {
  /** Authenticated customer ID — injected into the system prompt, never overridable by the user. */
  customerId: string
  message: string
  /** Omit on the first turn; pass back the value returned by the previous response. */
  sessionId?: string
  /** Full history from the previous response — enables multi-turn conversation. */
  history?: AgentMessage[]
}

export interface ChatResponse {
  response: string
  sessionId: string
  updatedHistory: AgentMessage[]
}

export async function POST(req: NextRequest) {
  let body: ChatRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { customerId, message, sessionId: incoming, history } = body

  if (!customerId || typeof customerId !== 'string' || customerId.trim() === '') {
    return NextResponse.json({ error: 'customerId is required and must be a non-empty string.' }, { status: 400 })
  }

  if (!message || typeof message !== 'string' || message.trim() === '') {
    return NextResponse.json({ error: 'message is required and must be a non-empty string.' }, { status: 400 })
  }

  const sessionId = incoming ?? randomUUID()

  try {
    const result = await runAgent({
      sessionId,
      customerId: customerId.trim(),
      userMessage: message.trim(),
      history: history ?? [],
    })

    const responseBody: ChatResponse = {
      response: result.response,
      sessionId,
      updatedHistory: result.updatedHistory,
    }

    return NextResponse.json(responseBody)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[chat] session=${sessionId} error:`, message)
    return NextResponse.json({ error: 'Agent encountered an error. Please try again.' }, { status: 500 })
  }
}
