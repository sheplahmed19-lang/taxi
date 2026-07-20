import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Image, Input, Modal, Segmented, Space, Tag, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

interface DriverRow {
  userId: string;
  verificationStatus: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  user: { id: string; name: string | null; phone: string; email: string | null };
  currentVehicle: { plate: string; model: string | null; vehicleType: { name: string } } | null;
}

interface DriverDocument {
  type: string;
  url: string;
}

const STATUS_COLOR: Record<DriverRow["verificationStatus"], string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
};

export function DriversPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [documentsDriverId, setDocumentsDriverId] = useState<string | null>(null);

  const { data: drivers, isLoading } = useQuery({
    queryKey: ["admin", "drivers", status],
    queryFn: async () =>
      (
        await apiClient.get<{ data: DriverRow[] }>("/admin/drivers", {
          params: status === "all" ? {} : { status },
        })
      ).data.data,
  });

  const { data: documents, isLoading: documentsLoading } = useQuery({
    queryKey: ["admin", "drivers", documentsDriverId, "documents"],
    queryFn: async () =>
      (await apiClient.get<{ data: { documents: DriverDocument[] } }>(`/admin/drivers/${documentsDriverId}/documents`))
        .data.data.documents,
    enabled: documentsDriverId !== null,
  });

  const approve = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/admin/drivers/${userId}/approve`),
    onSuccess: () => {
      message.success("Driver approved");
      void queryClient.invalidateQueries({ queryKey: ["admin", "drivers"] });
    },
  });

  const reject = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      apiClient.post(`/admin/drivers/${userId}/reject`, { reason }),
    onSuccess: () => {
      message.success("Driver rejected");
      setRejectingId(null);
      setRejectReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "drivers"] });
    },
  });

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Segmented
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          options={[
            { label: "Pending", value: "pending" },
            { label: "Approved", value: "approved" },
            { label: "Rejected", value: "rejected" },
            { label: "All", value: "all" },
          ]}
        />
      </Space>

      <DataTable<DriverRow>
        loading={isLoading}
        dataSource={drivers}
        rowKey="userId"
        columns={[
          { title: "Name", dataIndex: ["user", "name"], render: (name: string | null) => name ?? "—" },
          { title: "Phone", dataIndex: ["user", "phone"] },
          { title: "Email", dataIndex: ["user", "email"], render: (email: string | null) => email ?? "—" },
          {
            title: "Vehicle",
            render: (_: unknown, row) =>
              row.currentVehicle ? `${row.currentVehicle.vehicleType.name} — ${row.currentVehicle.plate}` : "—",
          },
          {
            title: "Status",
            dataIndex: "verificationStatus",
            render: (value: DriverRow["verificationStatus"]) => <Tag color={STATUS_COLOR[value]}>{value}</Tag>,
          },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Space>
                <Button size="small" onClick={() => setDocumentsDriverId(row.userId)}>
                  Documents
                </Button>
                {row.verificationStatus !== "approved" && (
                  <Button size="small" type="primary" loading={approve.isPending} onClick={() => approve.mutate(row.userId)}>
                    Approve
                  </Button>
                )}
                {row.verificationStatus !== "rejected" && (
                  <Button size="small" danger onClick={() => setRejectingId(row.userId)}>
                    Reject
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Reject driver"
        open={rejectingId !== null}
        onCancel={() => setRejectingId(null)}
        onOk={() => rejectingId && reject.mutate({ userId: rejectingId, reason: rejectReason })}
        okButtonProps={{ danger: true, disabled: rejectReason.trim().length === 0, loading: reject.isPending }}
      >
        <Input.TextArea
          rows={3}
          placeholder="Reason for rejection"
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      <Modal
        title="Driver documents"
        open={documentsDriverId !== null}
        onCancel={() => setDocumentsDriverId(null)}
        footer={null}
      >
        {documentsLoading ? (
          "Loading…"
        ) : !documents || documents.length === 0 ? (
          <Empty description="No documents uploaded yet" />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            {documents.map((doc) => (
              <div key={doc.type}>
                <div style={{ marginBottom: 4, fontWeight: 600, textTransform: "capitalize" }}>
                  {doc.type.replace(/_/g, " ")}
                </div>
                <Image src={doc.url} width="100%" style={{ maxHeight: 300, objectFit: "contain" }} />
              </div>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
}
