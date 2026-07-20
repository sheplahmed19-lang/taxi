// reports module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { toCsv } from "../../shared/csv.js";

export interface FinancialReportRow {
  date: string;
  tripsCompleted: number;
  grossFare: number;
  commission: number;
  driverEarnings: number;
}

export interface FinancialReport {
  rows: FinancialReportRow[];
  totals: Omit<FinancialReportRow, "date">;
}

/** Daily breakdown of paid trips, gross fare, commission, and driver earnings in [from, to]. */
export async function getFinancialReport(from: Date, to: Date): Promise<FinancialReport> {
  const [trips, ledgerEntries] = await Promise.all([
    prisma.trip.findMany({
      where: { paidAt: { gte: from, lte: to }, paymentStatus: "paid" },
      select: { paidAt: true, fareTotal: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { createdAt: { gte: from, lte: to }, type: { in: ["commission", "ride_earning"] }, tripId: { not: null } },
      select: { type: true, debit: true, credit: true, createdAt: true },
    }),
  ]);

  const byDate = new Map<string, FinancialReportRow>();
  function bucket(date: string): FinancialReportRow {
    let row = byDate.get(date);
    if (!row) {
      row = { date, tripsCompleted: 0, grossFare: 0, commission: 0, driverEarnings: 0 };
      byDate.set(date, row);
    }
    return row;
  }

  for (const trip of trips) {
    const row = bucket(trip.paidAt!.toISOString().slice(0, 10));
    row.tripsCompleted += 1;
    row.grossFare += trip.fareTotal ?? 0;
  }
  // ride_earning is credited as the trip's full gross fare (for a cash trip,
  // that's what the driver already holds in hand); commission is a separate
  // debit for what they owe the platform out of it. Net driver earnings —
  // what they actually keep — is the difference, same convention
  // jobs/weeklyStatements.ts uses for a driver's own statement.
  for (const entry of ledgerEntries) {
    const row = bucket(entry.createdAt.toISOString().slice(0, 10));
    if (entry.type === "commission") {
      row.commission += entry.debit;
      row.driverEarnings -= entry.debit;
    } else {
      row.driverEarnings += entry.credit;
    }
  }

  const rows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const totals = rows.reduce(
    (acc, r) => ({
      tripsCompleted: acc.tripsCompleted + r.tripsCompleted,
      grossFare: acc.grossFare + r.grossFare,
      commission: acc.commission + r.commission,
      driverEarnings: acc.driverEarnings + r.driverEarnings,
    }),
    { tripsCompleted: 0, grossFare: 0, commission: 0, driverEarnings: 0 },
  );

  return { rows, totals };
}

export function financialReportToCsv(report: FinancialReport): string {
  return toCsv(report.rows, ["date", "tripsCompleted", "grossFare", "commission", "driverEarnings"]);
}

export interface OperationsReport {
  tripsByStatus: Record<string, number>;
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  completionRate: number;
  avgFare: number;
  avgDistanceM: number;
}

/** Trip-status breakdown and operational averages for trips *requested* in [from, to]. */
export async function getOperationsReport(from: Date, to: Date): Promise<OperationsReport> {
  const trips = await prisma.trip.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { status: true, fareTotal: true, distanceM: true },
  });

  const tripsByStatus: Record<string, number> = {};
  let completedTrips = 0;
  let cancelledTrips = 0;
  let fareSum = 0;
  let fareCount = 0;
  let distanceSum = 0;
  let distanceCount = 0;

  for (const trip of trips) {
    tripsByStatus[trip.status] = (tripsByStatus[trip.status] ?? 0) + 1;
    if (trip.status === "completed" || trip.status === "paid") completedTrips += 1;
    if (trip.status === "cancelled_by_rider" || trip.status === "cancelled_by_driver") cancelledTrips += 1;
    if (trip.fareTotal !== null) {
      fareSum += trip.fareTotal;
      fareCount += 1;
    }
    if (trip.distanceM !== null) {
      distanceSum += trip.distanceM;
      distanceCount += 1;
    }
  }

  return {
    tripsByStatus,
    totalTrips: trips.length,
    completedTrips,
    cancelledTrips,
    completionRate: trips.length > 0 ? Math.round((completedTrips / trips.length) * 1000) / 10 : 0,
    avgFare: fareCount > 0 ? Math.round(fareSum / fareCount) : 0,
    avgDistanceM: distanceCount > 0 ? Math.round(distanceSum / distanceCount) : 0,
  };
}

export function operationsReportToCsv(report: OperationsReport): string {
  const rows = Object.entries(report.tripsByStatus).map(([status, count]) => ({ status, count }));
  return toCsv(rows, ["status", "count"]);
}
