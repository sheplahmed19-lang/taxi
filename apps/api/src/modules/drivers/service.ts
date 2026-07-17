// drivers module service — business logic lives here.
// Other modules must only import from this file, never from routes.ts or internals.
import { prisma } from "../../db/index.js";
import { uploadObject } from "../../shared/storage.js";
import { NotFoundError } from "../../shared/errors.js";

export interface RegisterDriverInput {
  name?: string;
  email?: string;
  vehicleTypeId: string;
  plate: string;
  model?: string;
  color?: string;
  year?: number;
}

/**
 * Driver in-app registration: personal info (merged into the User row),
 * vehicle info (new Vehicle), and a DriverProfile reset to `pending`
 * verification. Documents are uploaded separately via uploadDriverDocument.
 */
export async function registerDriver(userId: string, data: RegisterDriverInput) {
  return prisma.$transaction(async (tx) => {
    if (data.name !== undefined || data.email !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: { name: data.name, email: data.email },
      });
    }

    // DriverProfile must exist before Vehicle.driverId can reference it.
    await tx.driverProfile.upsert({
      where: { userId },
      update: { verificationStatus: "pending", rejectionReason: null },
      create: { userId, verificationStatus: "pending" },
    });

    const vehicle = await tx.vehicle.create({
      data: {
        driverId: userId,
        vehicleTypeId: data.vehicleTypeId,
        plate: data.plate,
        model: data.model,
        color: data.color,
        year: data.year,
      },
    });

    return tx.driverProfile.update({
      where: { userId },
      data: { vehicleId: vehicle.id },
      include: { currentVehicle: true },
    });
  });
}

export async function uploadDriverDocument(
  userId: string,
  docType: string,
  file: { buffer: Buffer; mimetype: string; originalname: string },
) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) {
    throw new NotFoundError("Driver profile not found — register first");
  }

  const { key } = await uploadObject(`driver-documents/${userId}`, file);
  const documents = { ...((profile.documents as Record<string, string> | null) ?? {}), [docType]: key };

  return prisma.driverProfile.update({
    where: { userId },
    data: { documents },
  });
}

export async function getDriverProfile(userId: string) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    include: { currentVehicle: { include: { vehicleType: true } } },
  });
  if (!profile) {
    throw new NotFoundError("Driver profile not found");
  }
  return profile;
}
