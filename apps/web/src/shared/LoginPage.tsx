import { useState } from "react";
import { CarOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Segmented, Tabs, Typography } from "antd";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { panelPathForRole } from "./auth";
import { brand } from "./theme";

interface StaffLoginValues {
  email: string;
  password: string;
}

function errorMessage(err: unknown, fallback: string): string {
  return (isAxiosError(err) ? (err.response?.data?.error?.message as string | undefined) : undefined) ?? fallback;
}

function StaffLoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: StaffLoginValues) {
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(values.email, values.password);
      navigate(panelPathForRole(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Sign in failed — check your email and password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Form<StaffLoginValues> layout="vertical" onFinish={handleSubmit} disabled={submitting}>
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
    </>
  );
}

function RiderDriverLoginForm() {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequestOtp() {
    setError(null);
    setSubmitting(true);
    try {
      await requestOtp(phone);
      setStage("otp");
    } catch (err) {
      setError(errorMessage(err, "Couldn't send an OTP to that number."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp() {
    setError(null);
    setSubmitting(true);
    try {
      const user = await verifyOtp(phone, otp, role);
      navigate(panelPathForRole(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Invalid or expired code."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {stage === "phone" ? (
        <Form layout="vertical" onFinish={handleRequestOtp} disabled={submitting}>
          <Form.Item label="I am a">
            <Segmented
              block
              value={role}
              onChange={(v) => setRole(v as "rider" | "driver")}
              options={[
                { label: "Rider", value: "rider" },
                { label: "Driver", value: "driver" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Phone number" required>
            <Input
              placeholder="+201000000000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting} disabled={!phone}>
            Send code
          </Button>
        </Form>
      ) : (
        <Form layout="vertical" onFinish={handleVerifyOtp} disabled={submitting}>
          <Typography.Paragraph type="secondary">Enter the code sent to {phone}.</Typography.Paragraph>
          {/* Plain input, not Input.OTP: the backend's OTP length is a configurable
              system_config value (otp_length, default 4, CLAUDE.md rule 10) — a
              fixed-length OTP box grid would never fire its onChange (and so never
              enable the submit button) unless it happened to match exactly. */}
          <Form.Item label="Code" required>
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              inputMode="numeric"
              autoFocus
              placeholder="1234"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting} disabled={otp.length < 4}>
            Verify &amp; sign in
          </Button>
          <Button type="link" block onClick={() => setStage("phone")} disabled={submitting}>
            Use a different number
          </Button>
        </Form>
      )}
    </>
  );
}

export function LoginPage() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        padding: 24,
        background: `radial-gradient(1200px circle at 15% 10%, rgba(79,70,229,0.16), transparent 55%),
                     radial-gradient(900px circle at 100% 100%, rgba(245,158,11,0.14), transparent 50%),
                     ${brand.pageBg}`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 16px rgba(79, 70, 229, 0.28)",
            }}
          >
            <CarOutlined style={{ color: "#fff", fontSize: 22 }} />
          </div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Ride Platform
          </Typography.Title>
        </div>
        <Card
          style={{ boxShadow: "0 8px 30px rgba(16, 24, 40, 0.08)", border: "1px solid #EEF0F5" }}
          styles={{ body: { padding: 28 } }}
        >
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
            Welcome back
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
            Sign in to manage your rides.
          </Typography.Paragraph>
          <Tabs
            defaultActiveKey="rider-driver"
            items={[
              { key: "rider-driver", label: "Rider / Driver", children: <RiderDriverLoginForm /> },
              { key: "staff", label: "Staff", children: <StaffLoginForm /> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
