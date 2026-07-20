import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Descriptions, Empty, Slider, Space, Tag } from "antd";
import { CaretRightOutlined, PauseOutlined } from "@ant-design/icons";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { apiClient } from "../../shared/apiClient";
import { formatMoney } from "../../shared/format";
import { driverIcon, dropIcon, pickupIcon, replayIcon } from "../../shared/mapIcons";

interface RoutePoint {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

interface TripDetail {
  id: string;
  status: string;
  fareTotal: number | null;
  distanceM: number | null;
  durationS: number | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  createdAt: string;
  rider: { name: string | null; phone: string };
  driver: { name: string | null; phone: string } | null;
  vehicleType: { name: string };
  vehicle: { plate: string; model: string | null } | null;
  pickup: { lat: number; lng: number } | null;
  drop: { lat: number; lng: number } | null;
  route: RoutePoint[];
}

export function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: trip, isLoading } = useQuery({
    queryKey: ["admin", "trips", id],
    queryFn: async () => (await apiClient.get<{ data: TripDetail }>(`/admin/trips/${id}`)).data.data,
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!playing || !trip || trip.route.length === 0) return;
    timerRef.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= trip.route.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, trip]);

  if (isLoading || !trip) {
    return <Card loading={isLoading}>{!isLoading && <Empty description="Trip not found" />}</Card>;
  }

  const route = trip.route;
  const current = route[index];
  const center: [number, number] = trip.pickup ? [trip.pickup.lat, trip.pickup.lng] : [30.05, 31.23];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions title={`Trip ${trip.id.slice(0, 8)}`} bordered size="small" column={2}>
          <Descriptions.Item label="Status">
            <Tag>{trip.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Requested">{new Date(trip.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Rider">{trip.rider.name ?? trip.rider.phone}</Descriptions.Item>
          <Descriptions.Item label="Driver">{trip.driver ? (trip.driver.name ?? trip.driver.phone) : "Unassigned"}</Descriptions.Item>
          <Descriptions.Item label="Vehicle">
            {trip.vehicleType.name}
            {trip.vehicle ? ` — ${trip.vehicle.plate}` : ""}
          </Descriptions.Item>
          <Descriptions.Item label="Payment">
            {trip.paymentMethod ?? "—"} ({trip.paymentStatus ?? "—"})
          </Descriptions.Item>
          <Descriptions.Item label="Fare">{trip.fareTotal !== null ? `$${formatMoney(trip.fareTotal)}` : "—"}</Descriptions.Item>
          <Descriptions.Item label="Distance / duration">
            {trip.distanceM !== null ? `${(trip.distanceM / 1000).toFixed(2)} km` : "—"} /{" "}
            {trip.durationS !== null ? `${Math.round(trip.durationS / 60)} min` : "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Route replay">
        <MapContainer center={center} zoom={13} style={{ height: "50vh", width: "100%", marginBottom: 16 }}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {trip.pickup && <Marker position={[trip.pickup.lat, trip.pickup.lng]} icon={pickupIcon} />}
          {trip.drop && <Marker position={[trip.drop.lat, trip.drop.lng]} icon={dropIcon} />}
          {route.length > 1 && <Polyline positions={route.map((p) => [p.lat, p.lng])} color="#722ed1" />}
          {current && <Marker position={[current.lat, current.lng]} icon={route.length > 0 ? replayIcon : driverIcon} />}
        </MapContainer>

        {route.length === 0 ? (
          <Empty description="No location pings were recorded for this trip" />
        ) : (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space>
              <Button
                icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                onClick={() => setPlaying((p) => !p)}
                disabled={route.length < 2}
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <span>
                {current ? new Date(current.recordedAt).toLocaleTimeString() : "—"} ({index + 1}/{route.length})
              </span>
            </Space>
            <Slider
              min={0}
              max={Math.max(route.length - 1, 0)}
              value={index}
              onChange={(value) => {
                setPlaying(false);
                setIndex(value);
              }}
            />
          </Space>
        )}
      </Card>
    </>
  );
}
