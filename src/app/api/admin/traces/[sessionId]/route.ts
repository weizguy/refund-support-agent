import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@lib/prisma'

export interface TraceEntry {
  id: string
  toolName: string | null
  toolInput: unknown
  toolOutput: unknown
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  isRetry: boolean
  errorMsg: string | null
  createdAt: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params

  const rows = await prisma.traceLog.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  const entries: TraceEntry[] = rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    toolInput: r.toolInput,
    toolOutput: r.toolOutput,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    isRetry: r.isRetry,
    errorMsg: r.errorMsg,
    createdAt: r.createdAt.toISOString(),
  }))

  return NextResponse.json(entries)
}
