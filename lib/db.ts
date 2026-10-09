import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Prisma's 5s default fails interactive transactions on a cold
    // connection (first request after a deploy or restart).
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

