import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Tag, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

interface Permission {
  id: string;
  key: string;
  description: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  rolePermissions: Array<{ permissionId: string; permission: Permission }>;
}

export function RolesPage() {
  const queryClient = useQueryClient();
  const [modalRole, setModalRole] = useState<RoleRow | "new" | null>(null);
  const [form] = Form.useForm();

  const { data: roles, isLoading } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: async () => (await apiClient.get<{ data: { roles: RoleRow[] } }>("/admin/roles")).data.data.roles,
  });

  const { data: permissions } = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: async () => (await apiClient.get<{ data: { permissions: Permission[] } }>("/admin/permissions")).data.data.permissions,
  });

  const create = useMutation({
    mutationFn: (values: { name: string; description?: string; permissionIds: string[] }) =>
      apiClient.post("/admin/roles", values),
    onSuccess: () => {
      message.success("Role created");
      close();
      void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: { id: string; name: string; description?: string; permissionIds: string[] }) =>
      apiClient.patch(`/admin/roles/${id}`, values),
    onSuccess: () => {
      message.success("Role updated");
      close();
      void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/roles/${id}`),
    onSuccess: () => {
      message.success("Role deleted");
      void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: () => message.error("Can't delete a role that's still assigned to a user"),
  });

  function close() {
    setModalRole(null);
    form.resetFields();
  }

  function openEdit(role: RoleRow) {
    setModalRole(role);
    form.setFieldsValue({
      name: role.name,
      description: role.description,
      permissionIds: role.rolePermissions.map((rp) => rp.permissionId),
    });
  }

  function openCreate() {
    setModalRole("new");
    form.resetFields();
  }

  function submit(values: { name: string; description?: string; permissionIds: string[] }) {
    if (modalRole === "new") {
      create.mutate(values);
    } else if (modalRole) {
      update.mutate({ id: modalRole.id, ...values });
    }
  }

  return (
    <>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={openCreate}>
        New role
      </Button>

      <DataTable<RoleRow>
        loading={isLoading}
        dataSource={roles}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Description", dataIndex: "description", render: (v: string | null) => v ?? "—" },
          {
            title: "Permissions",
            render: (_: unknown, row) => (
              <Space wrap>
                {row.rolePermissions.map((rp) => (
                  <Tag key={rp.permissionId}>{rp.permission.key}</Tag>
                ))}
              </Space>
            ),
          },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Space>
                <Button size="small" onClick={() => openEdit(row)}>
                  Edit
                </Button>
                <Popconfirm title="Delete this role?" onConfirm={() => remove.mutate(row.id)}>
                  <Button size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={modalRole === "new" ? "New role" : "Edit role"}
        open={modalRole !== null}
        onCancel={close}
        onOk={() => form.submit()}
        confirmLoading={create.isPending || update.isPending}
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="permissionIds" label="Permissions" initialValue={[]}>
            <Checkbox.Group
              options={permissions?.map((p) => ({ label: p.key, value: p.id }))}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
