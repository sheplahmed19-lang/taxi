import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Form, Input, Select, message } from "antd";
import { apiClient } from "../../shared/apiClient";

interface Zone {
  id: string;
  name: string;
}

interface BroadcastFormValues {
  title: string;
  body: string;
  segment: "all_riders" | "all_drivers" | "zone";
  zoneId?: string;
}

export function BroadcastComposerPage() {
  const [form] = Form.useForm<BroadcastFormValues>();
  const segment = Form.useWatch("segment", form);

  const { data: zones } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await apiClient.get<{ data: { zones: Zone[] } }>("/zones")).data.data.zones,
    enabled: segment === "zone",
  });

  const send = useMutation({
    mutationFn: (values: BroadcastFormValues) => apiClient.post<{ data: { recipientCount: number } }>("/admin/broadcasts", values),
    onSuccess: (res) => {
      message.success(`Broadcast sent to ${res.data.data.recipientCount} recipient(s)`);
      form.resetFields();
    },
  });

  return (
    <Card title="Compose a broadcast" style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" onFinish={(values) => send.mutate(values)}>
        <Form.Item name="title" label="Title" rules={[{ required: true, max: 120 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="body" label="Message" rules={[{ required: true, max: 1000 }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="segment" label="Audience" rules={[{ required: true }]} initialValue="all_riders">
          <Select
            options={[
              { label: "All riders", value: "all_riders" },
              { label: "All drivers", value: "all_drivers" },
              { label: "Online drivers in a zone", value: "zone" },
            ]}
          />
        </Form.Item>
        {segment === "zone" && (
          <Form.Item name="zoneId" label="Zone" rules={[{ required: true }]}>
            <Select options={zones?.map((z) => ({ label: z.name, value: z.id }))} />
          </Form.Item>
        )}
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={send.isPending}>
            Send broadcast
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
