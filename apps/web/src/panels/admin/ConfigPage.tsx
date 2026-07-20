import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Space, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

interface ConfigRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["admin", "config"],
    queryFn: async () => (await apiClient.get<{ data: { config: ConfigRow[] } }>("/admin/config")).data.data.config,
  });

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => apiClient.patch(`/admin/config/${key}`, { value }),
    onSuccess: () => {
      message.success("Config updated");
      setEditingKey(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "config"] });
    },
    onError: () => message.error("Failed to update — value must be valid JSON"),
  });

  function startEdit(row: ConfigRow) {
    setEditingKey(row.key);
    setDraft(JSON.stringify(row.value));
  }

  function save(key: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      message.error("Value must be valid JSON (e.g. 5, \"text\", true)");
      return;
    }
    update.mutate({ key, value: parsed });
  }

  return (
    <DataTable<ConfigRow>
      loading={isLoading}
      dataSource={config}
      rowKey="key"
      columns={[
        { title: "Key", dataIndex: "key" },
        {
          title: "Value",
          dataIndex: "value",
          render: (value: unknown, row: ConfigRow) =>
            editingKey === row.key ? (
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} onPressEnter={() => save(row.key)} autoFocus />
            ) : (
              JSON.stringify(value)
            ),
        },
        { title: "Updated", dataIndex: "updatedAt", render: (v: string) => new Date(v).toLocaleString() },
        {
          title: "Actions",
          render: (_: unknown, row) =>
            editingKey === row.key ? (
              <Space>
                <Button size="small" type="primary" loading={update.isPending} onClick={() => save(row.key)}>
                  Save
                </Button>
                <Button size="small" onClick={() => setEditingKey(null)}>
                  Cancel
                </Button>
              </Space>
            ) : (
              <Button size="small" onClick={() => startEdit(row)}>
                Edit
              </Button>
            ),
        },
      ]}
    />
  );
}
