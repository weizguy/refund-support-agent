import { NextResponse } from 'next/server'
import { prisma } from '@lib/prisma'

export interface SessionSummary {
  sessionId: string
  startedAt: string
  toolCallCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalLatencyMs: number
  hadRetry: boolean
  hadError: boolean
  /** Extracted from first successful lookupCustomer toolOutput in this session. */
  customerName: string | null
}

export async function GET() {
  // 1. Aggregate per session
  const groups = await prisma.traceLog.groupBy({
    by: ['sessionId'],
    _count: { id: true },
    _sum: { inputTokens: true, outputTokens: true, latencyMs: true },
    _min: { createdAt: true },
    orderBy: { _min: { createdAt: 'desc' } },
    take: 100,
  })

  if (groups.length === 0) return NextResponse.json([])

  const sessionIds = groups.map((g) => g.sessionId)

  // 2. Retry / error flags per session
  const flagRows = await prisma.traceLog.findMany({
    where: {
      sessionId: { in: sessionIds },
      OR: [{ isRetry: true }, { errorMsg: { not: null } }],
    },
    select: { sessionId: true, isRetry: true, errorMsg: true },
  })
  const retrySet = new Set(flagRows.filter((r) => r.isRetry).map((r) => r.sessionId))
  const errorSet = new Set(flagRows.filter((r) => r.errorMsg).map((r) => r.sessionId))

  // 3. Customer name from first successful lookupCustomer per session
  const customerRows = await prisma.traceLog.findMany({
    where: { sessionId: { in: sessionIds }, toolName: 'lookupCustomer' },
    select: { sessionId: true, toolOutput: true },
    orderBy: { createdAt: 'asc' },
    distinct: ['sessionId'],
  })
  const customerNameBySession = new Map<string, string>()
  for (const row of customerRows) {
    const out = row.toolOutput as Record<string, unknown> | null
    if (out?.found === true && typeof out.name === 'string') {
      customerNameBySession.set(row.sessionId, out.name)
    }
  }

  const summaries: SessionSummary[] = groups.map((g) => ({
    sessionId: g.sessionId,
    startedAt: g._min.createdAt!.toISOString(),
    toolCallCount: g._count.id,
    totalInputTokens: g._sum.inputTokens ?? 0,
    totalOutputTokens: g._sum.outputTokens ?? 0,
    totalLatencyMs: g._sum.latencyMs ?? 0,
    hadRetry: retrySet.has(g.sessionId),
    hadError: errorSet.has(g.sessionId),
    customerName: customerNameBySession.get(g.sessionId) ?? null,
  }))

  return NextResponse.json(summaries)
}
