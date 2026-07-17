import { Button, Card, Form, Input, Typography } from "antd";

export function LoginPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4}>Ride Platform — Staff Login</Typography.Title>
        <Form layout="vertical">
          <Form.Item label="Email" name="email">
            <Input placeholder="you@company.com" />
          </Form.Item>
          <Form.Item label="Password" name="password">
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            Sign in
          </Button>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Wired to POST /auth/staff/login in Phase 0.3 + Phase 4.1.
        </Typography.Text>
      </Card>
    </div>
  );
}
