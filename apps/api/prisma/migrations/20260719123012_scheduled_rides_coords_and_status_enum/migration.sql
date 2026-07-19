-- CreateEnum
CREATE TYPE "ScheduledRideStatus" AS ENUM ('pending', 'dispatched', 'cancelled');

-- AlterTable
ALTER TABLE "scheduled_rides" ADD COLUMN     "drop_lat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "drop_lng" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "payment_method" "PaymentMethod" NOT NULL,
ADD COLUMN     "pickup_lat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "pickup_lng" DOUBLE PRECISION NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "ScheduledRideStatus" NOT NULL DEFAULT 'pending';
