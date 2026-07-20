import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, InputNumber, Modal, Space, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";
import { formatMoney } from "../../shared/format";

interface OweRow {
  driverId: string;
  amount: number;
  driver: { user: { name: string | null; phone: string } };
}

export function OwePage() {
  const queryClient = useQueryClient();
  const [adjusting, setAdjusting] = useState<OweRow | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const { data: report, isLoading } = useQuery({
    queryKey: ["admin", "owe"],
    queryFn: async () => (await apiClient.get<{ data: { report: OweRow[] } }>("/admin/owe")).data.data.report,
  });

  const adjust = useMutation({
    mutationFn: ({ driverId, delta: d, reason: r }: { driverId: string; delta: number; reason: string }) =>
      apiClient.post(`/admin/owe/${driverId}/adjust`, { delta: d, reason: r }),
    onSuccess: () => {
      message.success("Owe amount adjusted");
      setAdjusting(null);
      setDelta(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "owe"] });
    },
  });

  return (
    <>
      <DataTable<OweRow>
        loading={isLoading}
        dataSource={report}
        rowKey="driverId"
        columns={[
          { title: "Driver", render: (_: unknown, row) => row.driver.user.name ?? row.driver.user.phone },
          { title: "Amount owed", dataIndex: "amount", render: (v: number) => `$${formatMoney(v)}` },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Button size="small" onClick={() => setAdjusting(row)}>
                Adjust
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="Adjust owe amount"
        open={adjusting !== null}
        onCancel={() => setAdjusting(null)}
        onOk={() => adjusting && delta !== null && adjust.mutate({ driverId: adjusting.driverId, delta, reason })}
        okButtonProps={{ disabled: delta === null || reason.trim().length === 0, loading: adjust.isPending }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            Delta (positive adds to the owed amount, negative reduces it — minor units, e.g. cents/piastres)
            <InputNumber style={{ width: "100%" }} value={delta} onChange={setDelta} />
          </div>
          <Input.TextArea rows={3} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Space>
      </Modal>
    </>
  );
}
