import { NextResponse } from 'next/server'
import { prisma } from '@lib/prisma'

export interface CustomerSummary {
  id: string
  name: string
  email: string
}

export async function GET() {
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(customers satisfies CustomerSummary[])
}
