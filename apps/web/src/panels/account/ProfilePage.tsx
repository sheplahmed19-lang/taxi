import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input } from "antd";
import { isAxiosError } from "axios";
import { apiClient } from "../../shared/apiClient";

interface Profile {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  role: string;
  status: string;
  referralCode: string | null;
}

interface ProfileFormValues {
  name?: string;
  email?: string;
}

export function ProfilePage() {
  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["my-profile"],
    queryFn: async () => (await apiClient.get<{ data: Profile }>("/users/me")).data.data,
  });
  const [form] = Form.useForm<ProfileFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile) {
      form.setFieldsValue({ name: profile.name ?? undefined, email: profile.email ?? undefined });
    }
  }, [profile, form]);

  async function handleSubmit(values: ProfileFormValues) {
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await apiClient.patch("/users/me", values);
      setSuccess(true);
      await refetch();
    } catch (err) {
      setError(isAxiosError(err) ? (err.response?.data?.error?.message as string | undefined) ?? "Update failed." : "Update failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Profile" loading={isLoading} style={{ maxWidth: 480 }}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {success && <Alert type="success" message="Profile updated." showIcon style={{ marginBottom: 16 }} />}
      <Form<ProfileFormValues> form={form} layout="vertical" onFinish={handleSubmit} disabled={submitting}>
        <Form.Item label="Phone">
          <Input value={profile?.phone} disabled />
        </Form.Item>
        <Form.Item label="Name" name="name">
          <Input placeholder="Your name" />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={[{ type: "email" }]}>
          <Input placeholder="you@example.com" />
        </Form.Item>
        {profile?.referralCode && (
          <Form.Item label="Referral code">
            <Input value={profile.referralCode} disabled />
          </Form.Item>
        )}
        <Button type="primary" htmlType="submit" loading={submitting}>
          Save changes
        </Button>
      </Form>
    </Card>
  );
}
