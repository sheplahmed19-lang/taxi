import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Empty, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { apiClient } from "../../shared/apiClient";
import { formatMoney } from "../../shared/format";
import { useAccountBasePath } from "./AccountLayout";

interface TripListItem {
  id: string;
  status: string;
  pickupAddress: string | null;
  dropAddress: string | null;
  fareTotal: number | null;
  paymentMethod: string | null;
  createdAt: string;
  vehicleType: { name: string };
  rider: { id: string; name: string | null; phone: string };
  driver: { id: string; name: string | null; phone: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  paid: "green",
  completed: "blue",
  cancelled_by_rider: "red",
  cancelled_by_driver: "red",
  no_drivers_found: "red",
};

export function RideHistoryPage() {
  const basePath = useAccountBasePath();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<TripListItem[][]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["my-trips", cursor],
    queryFn: async () =>
      (await apiClient.get<{ data: { trips: TripListItem[] } }>("/trips", { params: { cursor } })).data.data.trips,
  });

  const currentPageIndex = pages.length;
  const trips = data ?? pages[currentPageIndex - 1] ?? [];

  function handleNextPage() {
    if (!data || data.length === 0) return;
    setPages((prev) => [...prev, data]);
    setCursor(data[data.length - 1]!.id);
  }

  function handleFirstPage() {
    setPages([]);
    setCursor(undefined);
  }

  if (!isLoading && trips.length === 0 && pages.length === 0) {
    return (
      <Card>
        <Empty description="No rides yet" />
      </Card>
    );
  }

  return (
    <Card
      title="Ride history"
      loading={isLoading}
      extra={
        pages.length > 0 && (
          <Button size="small" onClick={handleFirstPage}>
            Back to latest
          </Button>
        )
      }
    >
      {trips.map((trip) => (
        <Link key={trip.id} to={`${basePath}/trips/${trip.id}`} style={{ display: "block", marginBottom: 12 }}>
          <Card size="small" hoverable>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <Typography.Text strong>{trip.pickupAddress ?? "Pickup"}</Typography.Text>
                <Typography.Text type="secondary"> → {trip.dropAddress ?? "Drop-off"}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    {trip.vehicleType.name} · {new Date(trip.createdAt).toLocaleString()}
                  </Typography.Text>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Tag color={STATUS_COLOR[trip.status] ?? "default"}>{trip.status}</Tag>
                <div>{trip.fareTotal != null ? formatMoney(trip.fareTotal) : "—"}</div>
              </div>
            </div>
          </Card>
        </Link>
      ))}
      {data && data.length > 0 && (
        <Button block onClick={handleNextPage}>
          Load more
        </Button>
      )}
    </Card>
  );
}
