-- CreateIndex
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries"("created_at");

-- CreateIndex
CREATE INDEX "trips_created_at_idx" ON "trips"("created_at");

-- CreateIndex
CREATE INDEX "trips_paid_at_idx" ON "trips"("paid_at");
