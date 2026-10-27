// Dev helper: imports N synthetic tracks into the local DB and prints how much space they take.
//   DATABASE_URL=postgresql://...localhost... npx tsx scripts/measure-size.ts 1507
import { PrismaClient } from '@prisma/client';
import { systemClock } from '../src/lib/clock';
import { newId } from '../src/lib/ids';
import { importPlaylist } from '../src/lib/services/importer';

if (!/(localhost|127\.0\.0\.1)/.test(process.env.DATABASE_URL ?? '')) throw new Error('Local databases only.');
const n = Number(process.argv[2] ?? 1507);
const db = new PrismaClient();

async function main() {
  const before = (await db.$queryRaw<{ s: bigint }[]>`select pg_database_size(current_database()) as s`)[0]!.s;
  const user = await db.user.create({ data: { id: newId('usr'), email: `size-${Date.now()}@example.com` } });
  const t0 = Date.now();
  const tracks = Array.from({ length: n }, (_, i) => ({
    id: `${Date.now().toString(36)}${i.toString(36)}`.padEnd(22, 'x').slice(0, 22),
    title: `Realistic Track Title Number ${i}`,
    artists: ['Marwan Moussa', 'Afroto'],
    album: 'A Typical Album Name',
    addedAt: '2024-05-30T00:00:00.000Z',
  }));
  const r = await importPlaylist({ db, clock: systemClock }, user.id, { name: `Size test ${n}`, seedRecent: true, tracks });
  const after = (await db.$queryRaw<{ s: bigint }[]>`select pg_database_size(current_database()) as s`)[0]!.s;
  const rel = await db.$queryRaw<{ t: string; s: bigint }[]>`
    select relname as t, pg_total_relation_size(c.oid) as s from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and relkind = 'r' and relname in ('Track','PlaylistTrack','DiscoveryEvent') order by s desc`;
  console.log(JSON.stringify({ tracks: n, result: r, ms: Date.now() - t0, deltaBytes: Number(after - before), perTrackBytes: Math.round(Number(after - before) / n), tables: rel.map((x) => ({ t: x.t, kb: Math.round(Number(x.s) / 1024) })) }, null, 1));
  await db.user.delete({ where: { id: user.id } }); // cleanup (cascades)
}
main().finally(() => db.$disconnect());
