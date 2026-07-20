import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Divider, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { apiClient } from "../../shared/apiClient";

interface VehicleType {
  id: string;
  name: string;
}

interface OnlineDriver {
  driverId: string;
  name: string | null;
  phone: string;
  vehicleTypeId: string;
  plate: string | null;
}

interface BookedTrip {
  id: string;
  status: string;
  driverId: string | null;
}

interface ManualBookingFormValues {
  phone: string;
  name?: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress?: string;
  dropLat: number;
  dropLng: number;
  dropAddress?: string;
  vehicleTypeId: string;
  paymentMethod: "cash" | "wallet" | "card";
  driverId?: string;
}

export function ManualBookingPage() {
  const [form] = Form.useForm<ManualBookingFormValues>();
  const [vehicleTypeId, setVehicleTypeId] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<BookedTrip | null>(null);

  const { data: vehicleTypes } = useQuery({
    queryKey: ["vehicles", "types"],
    queryFn: async () => (await apiClient.get<{ data: { types: VehicleType[] } }>("/vehicles/types")).data.data.types,
  });

  const { data: onlineDrivers } = useQuery({
    queryKey: ["admin", "live", "drivers"],
    queryFn: async () => (await apiClient.get<{ data: { drivers: OnlineDriver[] } }>("/admin/live/drivers")).data.data.drivers,
    refetchInterval: 15_000,
  });

  const matchingDrivers = onlineDrivers?.filter((d) => !vehicleTypeId || d.vehicleTypeId === vehicleTypeId);

  const book = useMutation({
    mutationFn: (values: ManualBookingFormValues) =>
      apiClient.post<{ data: BookedTrip }>("/dispatch/manual-booking", {
        phone: values.phone,
        name: values.name,
        pickup: { lat: values.pickupLat, lng: values.pickupLng, address: values.pickupAddress },
        drop: { lat: values.dropLat, lng: values.dropLng, address: values.dropAddress },
        vehicleTypeId: values.vehicleTypeId,
        paymentMethod: values.paymentMethod,
        driverId: values.driverId,
      }),
    onSuccess: (res) => {
      setResult(res.data.data);
      form.resetFields();
      setVehicleTypeId(undefined);
    },
  });

  return (
    <Card title="Book a ride for a phone number" style={{ maxWidth: 640 }}>
      {result && (
        <Alert
          style={{ marginBottom: 16 }}
          type={result.driverId ? "success" : "info"}
          showIcon
          message={result.driverId ? "Trip booked and assigned" : "Trip booked, searching for a driver"}
          description={
            <>
              Status: {result.status}. <Link to={`/dispatcher/trips/${result.id}`}>View trip</Link>
            </>
          }
          closable
          onClose={() => setResult(null)}
        />
      )}

      <Form form={form} layout="vertical" onFinish={(values) => book.mutate(values)}>
        <Form.Item name="phone" label="Rider phone" rules={[{ required: true }]}>
          <Input placeholder="+201000000000" />
        </Form.Item>
        <Form.Item name="name" label="Rider name (optional)">
          <Input />
        </Form.Item>

        <Divider orientation="left" plain>
          Pickup
        </Divider>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item name="pickupLat" label="Lat" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} step={0.0001} />
          </Form.Item>
          <Form.Item name="pickupLng" label="Lng" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} step={0.0001} />
          </Form.Item>
        </Space.Compact>
        <Form.Item name="pickupAddress" label="Pickup address (optional)">
          <Input />
        </Form.Item>

        <Divider orientation="left" plain>
          Drop-off
        </Divider>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item name="dropLat" label="Lat" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} step={0.0001} />
          </Form.Item>
          <Form.Item name="dropLng" label="Lng" rules={[{ required: true }]} style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} step={0.0001} />
          </Form.Item>
        </Space.Compact>
        <Form.Item name="dropAddress" label="Drop-off address (optional)">
          <Input />
        </Form.Item>

        <Divider orientation="left" plain>
          Ride
        </Divider>
        <Form.Item name="vehicleTypeId" label="Vehicle type" rules={[{ required: true }]}>
          <Select
            options={vehicleTypes?.map((vt) => ({ label: vt.name, value: vt.id }))}
            onChange={(value: string) => {
              setVehicleTypeId(value);
              form.setFieldValue("driverId", undefined);
            }}
          />
        </Form.Item>
        <Form.Item name="paymentMethod" label="Payment method" rules={[{ required: true }]} initialValue="cash">
          <Select options={["cash", "wallet", "card"].map((m) => ({ label: m, value: m }))} />
        </Form.Item>
        <Form.Item
          name="driverId"
          label="Assign a specific driver (optional)"
          extra="Leave blank to dispatch to the nearest available driver automatically."
        >
          <Select
            allowClear
            placeholder={matchingDrivers?.length ? "Choose an online driver" : "No online drivers for this vehicle type"}
            options={matchingDrivers?.map((d) => ({
              label: `${d.name ?? d.phone}${d.plate ? ` — ${d.plate}` : ""}`,
              value: d.driverId,
            }))}
          />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={book.isPending}>
            Book ride
          </Button>
        </Form.Item>
      </Form>

      {book.isError && (
        <Typography.Text type="danger">
          {(book.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
            "Booking failed"}
        </Typography.Text>
      )}
    </Card>
  );
}
