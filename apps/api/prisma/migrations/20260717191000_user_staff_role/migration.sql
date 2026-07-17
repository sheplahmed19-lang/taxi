-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staff_role_id" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_staff_role_id_fkey" FOREIGN KEY ("staff_role_id") REFERENCES "staff_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
