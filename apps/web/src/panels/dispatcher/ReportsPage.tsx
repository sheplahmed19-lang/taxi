import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, DatePicker, Space, Statistic, Table } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { apiClient } from "../../shared/apiClient";
import { formatMoney } from "../../shared/format";

const { RangePicker } = DatePicker;

interface FinancialReportRow {
  date: string;
  tripsCompleted: number;
  grossFare: number;
  commission: number;
  driverEarnings: number;
}

interface FinancialReport {
  rows: FinancialReportRow[];
  totals: Omit<FinancialReportRow, "date">;
}

interface OperationsReport {
  tripsByStatus: Record<string, number>;
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  completionRate: number;
  avgFare: number;
  avgDistanceM: number;
}

async function downloadCsv(path: string, from: string, to: string, filename: string) {
  const response = await apiClient.get(path, { params: { from, to, format: "csv" }, responseType: "blob" });
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, "day"), dayjs()]);
  const from = range[0].toISOString();
  const to = range[1].toISOString();

  const { data: financial, isLoading: financialLoading } = useQuery({
    queryKey: ["reports", "financial", from, to],
    queryFn: async () => (await apiClient.get<{ data: FinancialReport }>("/reports/financial", { params: { from, to } })).data.data,
  });

  const { data: operations, isLoading: operationsLoading } = useQuery({
    queryKey: ["reports", "operations", from, to],
    queryFn: async () => (await apiClient.get<{ data: OperationsReport }>("/reports/operations", { params: { from, to } })).data.data,
  });

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <RangePicker value={range} onChange={(value) => value?.[0] && value[1] && setRange([value[0], value[1]])} />
      </Card>

      <Card
        title="Financial"
        style={{ marginBottom: 16 }}
        loading={financialLoading}
        extra={
          <Button icon={<DownloadOutlined />} onClick={() => downloadCsv("/reports/financial", from, to, "financial-report.csv")}>
            Download CSV
          </Button>
        }
      >
        <Space size="large" style={{ marginBottom: 16 }}>
          <Statistic title="Trips completed" value={financial?.totals.tripsCompleted ?? 0} />
          <Statistic title="Gross fare" value={financial ? formatMoney(financial.totals.grossFare) : 0} prefix="$" />
          <Statistic title="Commission" value={financial ? formatMoney(financial.totals.commission) : 0} prefix="$" />
          <Statistic title="Driver earnings" value={financial ? formatMoney(financial.totals.driverEarnings) : 0} prefix="$" />
        </Space>
        <Table<FinancialReportRow>
          size="small"
          rowKey="date"
          dataSource={financial?.rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Date", dataIndex: "date" },
            { title: "Trips", dataIndex: "tripsCompleted" },
            { title: "Gross fare", dataIndex: "grossFare", render: (v: number) => `$${formatMoney(v)}` },
            { title: "Commission", dataIndex: "commission", render: (v: number) => `$${formatMoney(v)}` },
            { title: "Driver earnings", dataIndex: "driverEarnings", render: (v: number) => `$${formatMoney(v)}` },
          ]}
        />
      </Card>

      <Card
        title="Operations"
        loading={operationsLoading}
        extra={
          <Button icon={<DownloadOutlined />} onClick={() => downloadCsv("/reports/operations", from, to, "operations-report.csv")}>
            Download CSV
          </Button>
        }
      >
        <Space size="large" style={{ marginBottom: 16 }} wrap>
          <Statistic title="Total trips" value={operations?.totalTrips ?? 0} />
          <Statistic title="Completed" value={operations?.completedTrips ?? 0} />
          <Statistic title="Cancelled" value={operations?.cancelledTrips ?? 0} />
          <Statistic title="Completion rate" value={operations?.completionRate ?? 0} suffix="%" />
          <Statistic title="Avg fare" value={operations ? formatMoney(operations.avgFare) : 0} prefix="$" />
          <Statistic title="Avg distance" value={operations ? (operations.avgDistanceM / 1000).toFixed(2) : 0} suffix="km" />
        </Space>
        <Table
          size="small"
          rowKey="status"
          dataSource={operations ? Object.entries(operations.tripsByStatus).map(([status, count]) => ({ status, count })) : []}
          pagination={false}
          columns={[
            { title: "Status", dataIndex: "status" },
            { title: "Count", dataIndex: "count" },
          ]}
        />
      </Card>
    </>
  );
}
