import { useQuery } from "@tanstack/react-query";
import { Button, Card, Descriptions, Tag, Typography } from "antd";
import { Link, useParams } from "react-router-dom";
import { apiClient } from "../../shared/apiClient";
import { formatMoney } from "../../shared/format";
import { useAccountBasePath } from "./AccountLayout";

interface TripDetail {
  id: string;
  status: string;
  pickupAddress: string | null;
  dropAddress: string | null;
  distanceM: number | null;
  durationS: number | null;
  fareTotal: number | null;
  fareBreakdown: Record<string, number> | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  paidAt: string | null;
  vehicleType: { name: string };
  driver: { id: string; name: string | null; phone: string } | null;
  vehicle: { plate: string; model: string | null; color: string | null } | null;
}

export function TripReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const basePath = useAccountBasePath();

  const { data: trip, isLoading } = useQuery({
    queryKey: ["trip", id],
    queryFn: async () => (await apiClient.get<{ data: TripDetail }>(`/trips/${id}`)).data.data,
    enabled: !!id,
  });

  return (
    <Card
      loading={isLoading}
      title="Trip receipt"
      extra={
        <Link to={basePath}>
          <Button size="small">Back to history</Button>
        </Link>
      }
    >
      {trip && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Status">
              <Tag>{trip.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Pickup">{trip.pickupAddress ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Drop-off">{trip.dropAddress ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Vehicle type">{trip.vehicleType.name}</Descriptions.Item>
            <Descriptions.Item label="Driver">
              {trip.driver ? `${trip.driver.name ?? trip.driver.phone}` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Vehicle">
              {trip.vehicle ? `${trip.vehicle.model ?? ""} ${trip.vehicle.color ?? ""} — ${trip.vehicle.plate}` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Distance">
              {trip.distanceM != null ? `${(trip.distanceM / 1000).toFixed(2)} km` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Duration">
              {trip.durationS != null ? `${Math.round(trip.durationS / 60)} min` : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Payment method">{trip.paymentMethod ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Payment status">{trip.paymentStatus ?? "—"}</Descriptions.Item>
            <Descriptions.Item label="Requested at">
              {trip.requestedAt ? new Date(trip.requestedAt).toLocaleString() : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Completed at">
              {trip.completedAt ? new Date(trip.completedAt).toLocaleString() : "—"}
            </Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5} style={{ marginTop: 16 }}>
            Fare breakdown
          </Typography.Title>
          {trip.fareBreakdown ? (
            <Descriptions column={1} bordered size="small">
              {Object.entries(trip.fareBreakdown).map(([key, value]) => (
                <Descriptions.Item key={key} label={key}>
                  {typeof value === "number" ? formatMoney(value) : String(value)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <Typography.Text type="secondary">Not available.</Typography.Text>
          )}
          <Typography.Title level={4} style={{ marginTop: 16 }}>
            Total: {trip.fareTotal != null ? formatMoney(trip.fareTotal) : "—"}
          </Typography.Title>
        </>
      )}
    </Card>
  );
}
