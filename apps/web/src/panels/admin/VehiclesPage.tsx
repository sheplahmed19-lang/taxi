import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Modal, Switch, Tabs, Tag, message } from "antd";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";
import { formatMoney } from "../../shared/format";

interface VehicleType {
  id: string;
  name: string;
  seats: number;
  baseFare: number;
  perKm: number;
  perMin: number;
  minFare: number;
  commissionPct: number | null;
  active: boolean;
}

interface Vehicle {
  id: string;
  plate: string;
  model: string | null;
  color: string | null;
  year: number | null;
  vehicleType: { id: string; name: string };
  currentDriver: { user: { name: string | null; phone: string } } | null;
}

function VehicleTypesTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleType | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const { data: types, isLoading } = useQuery({
    queryKey: ["admin", "vehicle-types"],
    queryFn: async () => (await apiClient.get<{ data: { types: VehicleType[] } }>("/admin/vehicle-types")).data.data.types,
  });

  const create = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiClient.post("/admin/vehicle-types", values),
    onSuccess: () => {
      message.success("Vehicle type created");
      setCreateOpen(false);
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: { id: string } & Record<string, unknown>) =>
      apiClient.patch(`/admin/vehicle-types/${id}`, values),
    onSuccess: () => {
      message.success("Vehicle type updated");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "vehicle-types"] });
    },
  });

  return (
    <>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => setCreateOpen(true)}>
        New vehicle type
      </Button>

      <DataTable<VehicleType>
        loading={isLoading}
        dataSource={types}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Seats", dataIndex: "seats" },
          { title: "Base fare", dataIndex: "baseFare", render: formatMoney },
          { title: "Per km", dataIndex: "perKm", render: formatMoney },
          { title: "Per min", dataIndex: "perMin", render: formatMoney },
          { title: "Min fare", dataIndex: "minFare", render: formatMoney },
          {
            title: "Active",
            dataIndex: "active",
            render: (active: boolean) => <Tag color={active ? "green" : "default"}>{active ? "active" : "inactive"}</Tag>,
          },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Button
                size="small"
                onClick={() => {
                  setEditing(row);
                  editForm.setFieldsValue(row);
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="New vehicle type"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={create.isPending}
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="seats" label="Seats" initialValue={4} rules={[{ required: true }]}>
            <InputNumber min={1} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="baseFare" label="Base fare (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="perKm" label="Per km (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="perMin" label="Per min (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="minFare" label="Min fare (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Edit vehicle type"
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={update.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => editing && update.mutate({ id: editing.id, ...values })}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="baseFare" label="Base fare (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="perKm" label="Per km (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="perMin" label="Per min (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="minFare" label="Min fare (minor units)" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function VehiclesTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [editForm] = Form.useForm();

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ["admin", "vehicles"],
    queryFn: async () => (await apiClient.get<{ data: { vehicles: Vehicle[] } }>("/admin/vehicles")).data.data.vehicles,
  });

  const update = useMutation({
    mutationFn: ({ id, ...values }: { id: string } & Record<string, unknown>) =>
      apiClient.patch(`/admin/vehicles/${id}`, values),
    onSuccess: () => {
      message.success("Vehicle updated");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "vehicles"] });
    },
  });

  return (
    <>
      <DataTable<Vehicle>
        loading={isLoading}
        dataSource={vehicles}
        columns={[
          { title: "Plate", dataIndex: "plate" },
          { title: "Type", dataIndex: ["vehicleType", "name"] },
          { title: "Model", dataIndex: "model", render: (v: string | null) => v ?? "—" },
          { title: "Color", dataIndex: "color", render: (v: string | null) => v ?? "—" },
          {
            title: "Driver",
            render: (_: unknown, row) => row.currentDriver?.user.name ?? row.currentDriver?.user.phone ?? "—",
          },
          {
            title: "Actions",
            render: (_: unknown, row) => (
              <Button
                size="small"
                onClick={() => {
                  setEditing(row);
                  editForm.setFieldsValue(row);
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="Edit vehicle"
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={update.isPending}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => editing && update.mutate({ id: editing.id, ...values })}
        >
          <Form.Item name="plate" label="Plate">
            <Input />
          </Form.Item>
          <Form.Item name="model" label="Model">
            <Input />
          </Form.Item>
          <Form.Item name="color" label="Color">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function VehiclesPage() {
  return (
    <Tabs
      items={[
        { key: "types", label: "Vehicle types", children: <VehicleTypesTab /> },
        { key: "vehicles", label: "Vehicles", children: <VehiclesTab /> },
      ]}
    />
  );
}
