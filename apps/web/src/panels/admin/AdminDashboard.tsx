import { Card, Col, Row, Statistic } from "antd";

export function AdminDashboard() {
  return (
    <Row gutter={16}>
      <Col span={6}>
        <Card>
          <Statistic title="Trips today" value={0} />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic title="Revenue today" value={0} prefix="$" />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic title="Active drivers" value={0} />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic title="Completion rate" value={0} suffix="%" />
        </Card>
      </Col>
      {/* Real data + Recharts wired up in Phase 4.2 */}
    </Row>
  );
}
