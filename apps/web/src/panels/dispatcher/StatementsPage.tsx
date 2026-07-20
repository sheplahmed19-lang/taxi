import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";
import { formatMoney } from "../../shared/format";

interface StatementRow {
  id: string;
  driverId: string;
  periodStart: string;
  periodEnd: string;
  tripCount: number;
  totalEarnings: number;
  totalCommission: number;
  downloadUrl: string;
  driver: { user: { name: string | null; phone: string } };
}

export function StatementsPage() {
  const { data: statements, isLoading } = useQuery({
    queryKey: ["admin", "statements"],
    queryFn: async () => (await apiClient.get<{ data: { statements: StatementRow[] } }>("/admin/statements")).data.data.statements,
  });

  return (
    <DataTable<StatementRow>
      loading={isLoading}
      dataSource={statements}
      columns={[
        { title: "Driver", render: (_: unknown, row) => row.driver.user.name ?? row.driver.user.phone },
        {
          title: "Period",
          render: (_: unknown, row) => `${new Date(row.periodStart).toLocaleDateString()} – ${new Date(row.periodEnd).toLocaleDateString()}`,
        },
        { title: "Trips", dataIndex: "tripCount" },
        { title: "Gross earnings", dataIndex: "totalEarnings", render: (v: number) => `$${formatMoney(v)}` },
        { title: "Commission", dataIndex: "totalCommission", render: (v: number) => `$${formatMoney(v)}` },
        {
          title: "Net",
          render: (_: unknown, row) => `$${formatMoney(row.totalEarnings - row.totalCommission)}`,
        },
        {
          title: "",
          render: (_: unknown, row) => (
            <Button size="small" href={row.downloadUrl} target="_blank" rel="noreferrer">
              Download
            </Button>
          ),
        },
      ]}
    />
  );
}
