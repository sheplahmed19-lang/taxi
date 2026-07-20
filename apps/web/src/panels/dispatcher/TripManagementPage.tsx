import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Select, Space, Tag, message } from "antd";
import { Link } from "react-router-dom";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

interface TripRow {
  id: string;
  status: string;
  vehicleTypeId: string;
  driverId: string | null;
  rider: { name: string | null; phone: string };
  driver: { name: string | null; phone: string } | null;
  vehicleType: { name: string };
  createdAt: string;
}

interface OnlineDriver {
  driverId: string;
  name: string | null;
  phone: string;
  vehicleTypeId: string;
  plate: string | null;
}

const STATUS_OPTIONS = [
  "requested",
  "searching",
  "accepted",
  "arrived",
  "started",
  "completed",
  "paid",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "no_drivers_found",
  "expired",
];

const TAG_COLOR: Record<string, string> = {
  paid: "green",
  completed: "green",
  started: "blue",
  accepted: "blue",
  arrived: "blue",
  searching: "gold",
  requested: "gold",
  cancelled_by_rider: "red",
  cancelled_by_driver: "red",
  no_drivers_found: "red",
  expired: "default",
};

const REASSIGNABLE = new Set(["accepted", "arrived"]);
const CANCELLABLE = new Set(["requested", "searching", "accepted", "arrived"]);

export function TripManagementPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [cancellingTrip, setCancellingTrip] = useState<TripRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reassigningTrip, setReassigningTrip] = useState<TripRow | null>(null);
  const [reassignDriverId, setReassignDriverId] = useState<string | undefined>(undefined);

  const { data: trips, isLoading } = useQuery({
    queryKey: ["admin", "trips", status, search],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { trips: TripRow[] } }>("/admin/trips", {
          params: { status, search: search || undefined },
        })
      ).data.data.trips,
  });

  const { data: onlineDrivers } = useQuery({
    queryKey: ["admin", "live", "drivers"],
    queryFn: async () => (await apiClient.get<{ data: { drivers: OnlineDriver[] } }>("/admin/live/drivers")).data.data.drivers,
    enabled: reassigningTrip !== null,
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.post(`/admin/trips/${id}/cancel`, { reason }),
    onSuccess: () => {
      message.success("Trip cancelled");
      setCancellingTrip(null);
      setCancelReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "trips"] });
    },
  });

  const reassign = useMutation({
    mutationFn: ({ id, driverId }: { id: string; driverId: string }) => apiClient.post(`/admin/trips/${id}/reassign`, { driverId }),
    onSuccess: () => {
      message.success("Trip reassigned");
      setReassigningTrip(null);
      setReassignDriverId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["admin", "trips"] });
    },
  });

  const reassignCandidates = onlineDrivers?.filter((d) => d.vehicleTypeId === reassigningTrip?.vehicleTypeId);

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by status"
          style={{ width: 200 }}
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS.map((s) => ({ label: s, value: s }))}
        />
        <Input.Search placeholder="Search rider/driver name or phone" allowClear style={{ width: 280 }} onSearch={setSearch} />
      </Space>

      <DataTable<TripRow>
        loading={isLoading}
        dataSource={trips}
        columns={[
          { title: "Trip", dataIndex: "id", render: (id: string) => <Link to={`/dispatcher/trips/${id}`}>{id.slice(0, 8)}</Link> },
          { title: "Rider", render: (_: unknown, row) => row.rider.name ?? row.rider.phone },
          { title: "Driver", render: (_: unknown, row) => (row.driver ? row.driver.name ?? row.driver.phone : "—") },
          { title: "Vehicle", dataIndex: ["vehicleType", "name"] },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: string) => <Tag color={TAG_COLOR[value] ?? "default"}>{value}</Tag>,
          },
          { title: "Requested", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Space>
                {REASSIGNABLE.has(row.status) && (
                  <Button size="small" onClick={() => setReassigningTrip(row)}>
                    Reassign
                  </Button>
                )}
                {CANCELLABLE.has(row.status) && (
                  <Button size="small" danger onClick={() => setCancellingTrip(row)}>
                    Cancel
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Cancel trip"
        open={cancellingTrip !== null}
        onCancel={() => setCancellingTrip(null)}
        onOk={() => cancellingTrip && cancel.mutate({ id: cancellingTrip.id, reason: cancelReason })}
        okButtonProps={{ danger: true, disabled: cancelReason.trim().length === 0, loading: cancel.isPending }}
      >
        <Input.TextArea rows={3} placeholder="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </Modal>

      <Modal
        title="Reassign trip"
        open={reassigningTrip !== null}
        onCancel={() => setReassigningTrip(null)}
        onOk={() => reassigningTrip && reassignDriverId && reassign.mutate({ id: reassigningTrip.id, driverId: reassignDriverId })}
        okButtonProps={{ disabled: !reassignDriverId, loading: reassign.isPending }}
      >
        <Select
          style={{ width: "100%" }}
          placeholder={reassignCandidates?.length ? "Choose an online driver" : "No other online drivers for this vehicle type"}
          value={reassignDriverId}
          onChange={setReassignDriverId}
          options={reassignCandidates
            ?.filter((d) => d.driverId !== reassigningTrip?.driverId)
            .map((d) => ({ label: `${d.name ?? d.phone}${d.plate ? ` — ${d.plate}` : ""}`, value: d.driverId }))}
        />
      </Modal>
    </>
  );
}
