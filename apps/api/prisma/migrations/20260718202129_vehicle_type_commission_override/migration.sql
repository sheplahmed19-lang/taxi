-- Prisma's schema-diff engine doesn't know about the hand-written GiST
-- indexes from the init migration (they're not expressible in schema.prisma
-- — see that migration's comment), so `prisma migrate dev` proposed dropping
-- all five here. That would be a real regression, not just a diff quirk —
-- intentionally NOT applying those DROP INDEX statements.

-- AlterTable
ALTER TABLE "vehicle_types" ADD COLUMN     "commission_pct" INTEGER;
