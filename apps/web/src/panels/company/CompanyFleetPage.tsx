import { useQuery } from "@tanstack/react-query";
import { Card, Tabs, Tag } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

interface FleetVehicle {
  id: string;
  plate: string;
  model: string | null;
  color: string | null;
  vehicleType: { name: string };
  currentDriver: { user: { name: string | null; phone: string } } | null;
}

interface FleetDriver {
  userId: string;
  verificationStatus: "pending" | "approved" | "rejected";
  online: boolean;
  user: { name: string | null; phone: string };
  currentVehicle: { plate: string; vehicleType: { name: string } } | null;
}

const STATUS_COLOR: Record<FleetDriver["verificationStatus"], string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
};

export function CompanyFleetPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["company", "my-fleet"],
    queryFn: async () =>
      (await apiClient.get<{ data: { vehicles: FleetVehicle[]; drivers: FleetDriver[] } }>("/admin/my-fleet")).data.data,
  });

  return (
    <Card>
      <Tabs
        items={[
          {
            key: "vehicles",
            label: `Vehicles (${data?.vehicles.length ?? 0})`,
            children: (
              <DataTable<FleetVehicle>
                loading={isLoading}
                dataSource={data?.vehicles}
                columns={[
                  { title: "Plate", dataIndex: "plate" },
                  { title: "Type", dataIndex: ["vehicleType", "name"] },
                  { title: "Model", dataIndex: "model", render: (v: string | null) => v ?? "—" },
                  { title: "Color", dataIndex: "color", render: (v: string | null) => v ?? "—" },
                  {
                    title: "Current driver",
                    render: (_: unknown, row) => row.currentDriver?.user.name ?? row.currentDriver?.user.phone ?? "Unassigned",
                  },
                ]}
              />
            ),
          },
          {
            key: "drivers",
            label: `Drivers (${data?.drivers.length ?? 0})`,
            children: (
              <DataTable<FleetDriver>
                loading={isLoading}
                dataSource={data?.drivers}
                rowKey="userId"
                columns={[
                  { title: "Name", render: (_: unknown, row) => row.user.name ?? "—" },
                  { title: "Phone", dataIndex: ["user", "phone"] },
                  {
                    title: "Verification",
                    dataIndex: "verificationStatus",
                    render: (v: FleetDriver["verificationStatus"]) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
                  },
                  {
                    title: "Online",
                    dataIndex: "online",
                    render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "online" : "offline"}</Tag>,
                  },
                  {
                    title: "Vehicle",
                    render: (_: unknown, row) => (row.currentVehicle ? `${row.currentVehicle.vehicleType.name} — ${row.currentVehicle.plate}` : "—"),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
