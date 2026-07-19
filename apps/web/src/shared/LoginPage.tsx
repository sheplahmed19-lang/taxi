import { useState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { panelPathForRole } from "./auth";

interface LoginFormValues {
  email: string;
  password: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(values.email, values.password);
      navigate(panelPathForRole(user.role), { replace: true });
    } catch (err) {
      const message = isAxiosError(err) ? (err.response?.data?.error?.message as string | undefined) : undefined;
      setError(message ?? "Sign in failed — check your email and password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={4}>Ride Platform — Staff Login</Typography.Title>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form<LoginFormValues> layout="vertical" onFinish={handleSubmit} disabled={submitting}>
          <Form.Item label="Email" name="email" rules={[{ required: true, type: "email" }]}>
            <Input placeholder="you@company.com" autoComplete="username" />
          </Form.Item>
          <Form.Item label="Password" name="password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
