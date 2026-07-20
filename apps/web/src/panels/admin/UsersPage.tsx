import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Select, Space, Tag, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

type Role = "rider" | "driver" | "staff" | "admin" | "fleet_owner" | "dispatcher";
type Status = "active" | "suspended" | "banned";

interface UserRow {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  role: Role;
  status: Status;
  staffRoleId: string | null;
  staffRole: { id: string; name: string } | null;
}

interface StaffRoleOption {
  id: string;
  name: string;
}

const STATUS_COLOR: Record<Status, string> = { active: "green", suspended: "gold", banned: "red" };

export function UsersPage() {
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<Role | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin", "users", roleFilter, search],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { users: UserRow[] } }>("/admin/users", {
          params: { role: roleFilter, search: search || undefined },
        })
      ).data.data.users,
  });

  const { data: staffRoles } = useQuery({
    queryKey: ["admin", "roles", "options"],
    queryFn: async () =>
      (await apiClient.get<{ data: { roles: StaffRoleOption[] } }>("/admin/roles")).data.data.roles,
  });

  const create = useMutation({
    mutationFn: (values: { phone: string; email: string; password: string; name: string; role: Role }) =>
      apiClient.post("/admin/users", values),
    onSuccess: () => {
      message.success("Staff account created");
      setCreateOpen(false);
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, name, staffRoleId }: { id: string; name?: string; staffRoleId?: string | null }) =>
      apiClient.patch(`/admin/users/${id}`, { name, staffRoleId }),
    onSuccess: () => {
      message.success("User updated");
      setEditingUser(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => apiClient.post(`/admin/users/${id}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by role"
          style={{ width: 180 }}
          value={roleFilter}
          onChange={setRoleFilter}
          options={["rider", "driver", "staff", "admin", "fleet_owner", "dispatcher"].map((r) => ({ label: r, value: r }))}
        />
        <Input.Search
          placeholder="Search name/email/phone"
          allowClear
          style={{ width: 260 }}
          onSearch={setSearch}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          New staff account
        </Button>
      </Space>

      <DataTable<UserRow>
        loading={isLoading}
        dataSource={users}
        columns={[
          { title: "Name", dataIndex: "name", render: (v: string | null) => v ?? "—" },
          { title: "Phone", dataIndex: "phone" },
          { title: "Email", dataIndex: "email", render: (v: string | null) => v ?? "—" },
          { title: "Role", dataIndex: "role" },
          { title: "Staff role", dataIndex: ["staffRole", "name"], render: (v: string | undefined) => v ?? "—" },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: Status) => <Tag color={STATUS_COLOR[value]}>{value}</Tag>,
          },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setEditingUser(row);
                    editForm.setFieldsValue({ name: row.name, staffRoleId: row.staffRoleId ?? undefined });
                  }}
                >
                  Edit
                </Button>
                {row.status === "active" ? (
                  <Button size="small" danger loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: row.id, status: "suspended" })}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="small" loading={setStatus.isPending} onClick={() => setStatus.mutate({ id: row.id, status: "active" })}>
                    Reactivate
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="New staff account"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={create.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone" rules={[{ required: true }]}>
            <Input placeholder="+201000000000" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]} initialValue="staff">
            <Select options={["staff", "admin", "fleet_owner", "dispatcher"].map((r) => ({ label: r, value: r }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Edit user"
        open={editingUser !== null}
        onCancel={() => setEditingUser(null)}
        onOk={() => editForm.submit()}
        confirmLoading={update.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => editingUser && update.mutate({ id: editingUser.id, ...values })}
        >
          <Form.Item name="name" label="Name">
            <Input />
          </Form.Item>
          <Form.Item name="staffRoleId" label="Staff role">
            <Select
              allowClear
              options={staffRoles?.map((r) => ({ label: r.name, value: r.id }))}
              placeholder="No role assigned"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
