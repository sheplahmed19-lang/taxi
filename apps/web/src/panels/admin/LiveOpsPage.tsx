import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, DatePicker, Space, Switch, Typography } from "antd";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import dayjs, { type Dayjs } from "dayjs";
import { Link } from "react-router-dom";
import { apiClient } from "../../shared/apiClient";
import { useAdminSocket } from "../../shared/useAdminSocket";
import { driverIcon, dropIcon, pickupIcon } from "../../shared/mapIcons";

const { RangePicker } = DatePicker;

const MAP_CENTER: [number, number] = [30.05, 31.23];

interface OnlineDriver {
  driverId: string;
  name: string | null;
  phone: string;
  vehicleTypeName: string;
  plate: string | null;
  lat: number;
  lng: number;
}

interface ActiveTrip {
  tripId: string;
  status: string;
  riderName: string | null;
  driverName: string | null;
  vehicleTypeName: string;
  pickup: { lat: number; lng: number } | null;
  drop: { lat: number; lng: number } | null;
  driverLocation: { lat: number; lng: number } | null;
}

interface HeatmapPoint {
  lat: number;
  lng: number;
}

function HeatLayer({ points }: { points: HeatmapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const layer = L.heatLayer(
      points.map((p) => [p.lat, p.lng, 0.6] as [number, number, number]),
      { radius: 22, blur: 18 },
    );
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);
  return null;
}

interface LiveOpsPageProps {
  /** Trip marker popup links use this — dispatcher mounts this same page under /dispatcher and needs /dispatcher/trips/:id, not /admin/trips/:id. */
  basePath?: string;
}

export function LiveOpsPage({ basePath = "/admin" }: LiveOpsPageProps) {
  const socket = useAdminSocket();

  const [showDrivers, setShowDrivers] = useState(true);
  const [showTrips, setShowTrips] = useState(true);
  const [showDemandHeat, setShowDemandHeat] = useState(false);
  const [showSupplyHeat, setShowSupplyHeat] = useState(false);
  const [demandRange, setDemandRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, "day"), dayjs()]);

  const { data: driversSnapshot } = useQuery({
    queryKey: ["admin", "live", "drivers"],
    queryFn: async () => (await apiClient.get<{ data: { drivers: OnlineDriver[] } }>("/admin/live/drivers")).data.data.drivers,
    refetchInterval: 20_000,
  });

  const { data: tripsSnapshot } = useQuery({
    queryKey: ["admin", "live", "trips"],
    queryFn: async () => (await apiClient.get<{ data: { trips: ActiveTrip[] } }>("/admin/live/trips")).data.data.trips,
    refetchInterval: 10_000,
  });

  const { data: demandHeat } = useQuery({
    queryKey: ["admin", "heatmap", "demand", demandRange[0].toISOString(), demandRange[1].toISOString()],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { points: HeatmapPoint[] } }>("/admin/heatmap/demand", {
          params: { from: demandRange[0].toISOString(), to: demandRange[1].toISOString() },
        })
      ).data.data.points,
    enabled: showDemandHeat,
  });

  const { data: supplyHeat } = useQuery({
    queryKey: ["admin", "heatmap", "supply"],
    queryFn: async () => (await apiClient.get<{ data: { points: HeatmapPoint[] } }>("/admin/heatmap/supply")).data.data.points,
    enabled: showSupplyHeat,
    refetchInterval: 20_000,
  });

  const [driverPatches, setDriverPatches] = useState<Record<string, { lat: number; lng: number }>>({});
  const [offlineDriverIds, setOfflineDriverIds] = useState<Set<string>>(new Set());
  const [tripPatches, setTripPatches] = useState<Record<string, { status: string }>>({});

  useEffect(() => {
    setDriverPatches({});
    setOfflineDriverIds(new Set());
    setTripPatches({});
  }, [driversSnapshot, tripsSnapshot]);

  useEffect(() => {
    if (!socket) return;

    function onDriverLocation(payload: { driverId: string; lat: number; lng: number }) {
      setDriverPatches((prev) => ({ ...prev, [payload.driverId]: { lat: payload.lat, lng: payload.lng } }));
    }
    function onDriverStatus(payload: { driverId: string; online: boolean }) {
      if (!payload.online) {
        setOfflineDriverIds((prev) => new Set(prev).add(payload.driverId));
      }
    }
    function onTripStatus(payload: { tripId: string; status: string }) {
      setTripPatches((prev) => ({ ...prev, [payload.tripId]: { status: payload.status } }));
    }

    socket.on("admin:driver_location", onDriverLocation);
    socket.on("admin:driver_status", onDriverStatus);
    socket.on("admin:trip_status", onTripStatus);
    socket.on("admin:trip_new", () => undefined);

    return () => {
      socket.off("admin:driver_location", onDriverLocation);
      socket.off("admin:driver_status", onDriverStatus);
      socket.off("admin:trip_status", onTripStatus);
    };
  }, [socket]);

  const drivers = useMemo(() => {
    return (driversSnapshot ?? [])
      .filter((d) => !offlineDriverIds.has(d.driverId))
      .map((d) => ({ ...d, ...driverPatches[d.driverId] }));
  }, [driversSnapshot, driverPatches, offlineDriverIds]);

  const TERMINAL_STATUSES = new Set(["paid", "completed", "cancelled_by_rider", "cancelled_by_driver", "no_drivers_found", "expired"]);
  const trips = useMemo(() => {
    return (tripsSnapshot ?? [])
      .map((t) => ({ ...t, status: tripPatches[t.tripId]?.status ?? t.status }))
      .filter((t) => !TERMINAL_STATUSES.has(t.status));
  }, [tripsSnapshot, tripPatches]);

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Space>
            <Switch checked={showDrivers} onChange={setShowDrivers} />
            <Typography.Text>Online drivers ({drivers.length})</Typography.Text>
          </Space>
          <Space>
            <Switch checked={showTrips} onChange={setShowTrips} />
            <Typography.Text>Active trips ({trips.length})</Typography.Text>
          </Space>
          <Space>
            <Switch checked={showSupplyHeat} onChange={setShowSupplyHeat} />
            <Typography.Text>Supply heat (live)</Typography.Text>
          </Space>
          <Space>
            <Switch checked={showDemandHeat} onChange={setShowDemandHeat} />
            <Typography.Text>Demand heat</Typography.Text>
            <RangePicker
              size="small"
              value={demandRange}
              disabled={!showDemandHeat}
              onChange={(range) => range?.[0] && range[1] && setDemandRange([range[0], range[1]])}
            />
          </Space>
        </Space>
      </Card>

      <MapContainer center={MAP_CENTER} zoom={12} style={{ height: "70vh", width: "100%" }}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {showDrivers && (
          <MarkerClusterGroup chunkedLoading>
            {drivers.map((d) => (
              <Marker key={d.driverId} position={[d.lat, d.lng]} icon={driverIcon}>
                <Popup>
                  <strong>{d.name ?? d.phone}</strong>
                  <br />
                  {d.vehicleTypeName} — {d.plate ?? "no plate on file"}
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>
        )}

        {showTrips &&
          trips.map((t) => (
            <div key={t.tripId}>
              {t.pickup && (
                <Marker position={[t.pickup.lat, t.pickup.lng]} icon={pickupIcon}>
                  <Popup>
                    Trip <Link to={`${basePath}/trips/${t.tripId}`}>{t.tripId.slice(0, 8)}</Link>
                    <br />
                    Status: {t.status}
                    <br />
                    Rider: {t.riderName ?? "—"}, Driver: {t.driverName ?? "unassigned"}
                  </Popup>
                </Marker>
              )}
              {t.drop && <Marker position={[t.drop.lat, t.drop.lng]} icon={dropIcon} />}
              {t.driverLocation && t.pickup && (
                <Polyline positions={[[t.driverLocation.lat, t.driverLocation.lng], [t.pickup.lat, t.pickup.lng]]} color="#1677ff" dashArray="4 6" />
              )}
            </div>
          ))}

        {showDemandHeat && demandHeat && <HeatLayer points={demandHeat} />}
        {showSupplyHeat && supplyHeat && <HeatLayer points={supplyHeat} />}
      </MapContainer>
    </>
  );
}
