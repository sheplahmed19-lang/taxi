import { useQuery } from "@tanstack/react-query";
import { Card, Col, Row, Statistic } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiClient } from "../../shared/apiClient";
import { formatMoney } from "../../shared/format";

interface DashboardStats {
  tripsToday: number;
  revenueToday: number;
  activeDrivers: number;
  completionRate: number;
}

export function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: async () => (await apiClient.get<{ data: DashboardStats }>("/admin/dashboard")).data.data,
    refetchInterval: 30_000,
  });

  const chartData = data ? [{ metric: "Trips today", value: data.tripsToday }, { metric: "Active drivers", value: data.activeDrivers }] : [];

  return (
    <>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="Trips today" value={data?.tripsToday ?? 0} loading={isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Revenue today" value={data ? formatMoney(data.revenueToday) : 0} prefix="$" loading={isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Active drivers" value={data?.activeDrivers ?? 0} loading={isLoading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Completion rate" value={data?.completionRate ?? 0} suffix="%" loading={isLoading} />
          </Card>
        </Col>
      </Row>
      <Card title="Today's activity" style={{ marginTop: 16 }} loading={isLoading}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="metric" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" fill="#1677ff" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
