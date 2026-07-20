import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Select, Space, Tag, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";
import { formatMoney } from "../../shared/format";

interface PayoutRow {
  id: string;
  driverId: string;
  amount: number;
  status: "requested" | "approved" | "paid" | "rejected";
  method: string | null;
  rejectionReason: string | null;
  createdAt: string;
  driver: { user: { name: string | null; phone: string } };
}

const STATUS_COLOR: Record<PayoutRow["status"], string> = {
  requested: "gold",
  approved: "blue",
  paid: "green",
  rejected: "red",
};

export function PayoutsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PayoutRow["status"] | undefined>("requested");
  const [rejecting, setRejecting] = useState<PayoutRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [markingPaid, setMarkingPaid] = useState<PayoutRow | null>(null);
  const [payoutMethod, setPayoutMethod] = useState("bank_transfer");

  const { data: payouts, isLoading } = useQuery({
    queryKey: ["admin", "payouts", status],
    queryFn: async () =>
      (await apiClient.get<{ data: { payouts: PayoutRow[] } }>("/admin/payouts", { params: { status } })).data.data.payouts,
  });

  const approve = useMutation({
    mutationFn: (id: string) => apiClient.post(`/admin/payouts/${id}/approve`),
    onSuccess: () => {
      message.success("Payout approved");
      void queryClient.invalidateQueries({ queryKey: ["admin", "payouts"] });
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiClient.post(`/admin/payouts/${id}/reject`, { reason }),
    onSuccess: () => {
      message.success("Payout rejected");
      setRejecting(null);
      setRejectReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "payouts"] });
    },
  });

  const markPaid = useMutation({
    mutationFn: ({ id, method }: { id: string; method: string }) => apiClient.post(`/admin/payouts/${id}/paid`, { method }),
    onSuccess: () => {
      message.success("Payout marked as paid");
      setMarkingPaid(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "payouts"] });
    },
  });

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter by status"
          style={{ width: 200 }}
          value={status}
          onChange={setStatus}
          options={["requested", "approved", "paid", "rejected"].map((s) => ({ label: s, value: s }))}
        />
      </Space>

      <DataTable<PayoutRow>
        loading={isLoading}
        dataSource={payouts}
        columns={[
          { title: "Driver", render: (_: unknown, row) => row.driver.user.name ?? row.driver.user.phone },
          { title: "Amount", dataIndex: "amount", render: (v: number) => `$${formatMoney(v)}` },
          {
            title: "Status",
            dataIndex: "status",
            render: (v: PayoutRow["status"]) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
          },
          { title: "Method", dataIndex: "method", render: (v: string | null) => v ?? "—" },
          { title: "Requested", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
          {
            title: "Actions",
            render: (_: unknown, row) =>
              row.status === "requested" ? (
                <Space>
                  <Button size="small" type="primary" loading={approve.isPending} onClick={() => approve.mutate(row.id)}>
                    Approve
                  </Button>
                  <Button size="small" danger onClick={() => setRejecting(row)}>
                    Reject
                  </Button>
                </Space>
              ) : row.status === "approved" ? (
                <Button size="small" type="primary" onClick={() => setMarkingPaid(row)}>
                  Mark paid
                </Button>
              ) : null,
          },
        ]}
      />

      <Modal
        title="Reject payout"
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onOk={() => rejecting && reject.mutate({ id: rejecting.id, reason: rejectReason })}
        okButtonProps={{ danger: true, disabled: rejectReason.trim().length === 0, loading: reject.isPending }}
      >
        <Input.TextArea rows={3} placeholder="Reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>

      <Modal
        title="Mark payout as paid"
        open={markingPaid !== null}
        onCancel={() => setMarkingPaid(null)}
        onOk={() => markingPaid && markPaid.mutate({ id: markingPaid.id, method: payoutMethod })}
        okButtonProps={{ loading: markPaid.isPending }}
      >
        <Select
          style={{ width: "100%" }}
          value={payoutMethod}
          onChange={setPayoutMethod}
          options={["bank_transfer", "cash", "mobile_wallet"].map((m) => ({ label: m, value: m }))}
        />
      </Modal>
    </>
  );
}
