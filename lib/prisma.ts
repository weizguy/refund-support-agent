import { PrismaClient } from '@prisma/client'

// Singleton pattern — prevents connection pool exhaustion in Next.js dev mode
// where modules are hot-reloaded and a new PrismaClient would be created each time.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
