import { PrismaClient } from '@prisma/client';

// One client per warm lambda; DATABASE_URL points at the pooled (pgbouncer) endpoint.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = db;
export type Db = PrismaClient;
