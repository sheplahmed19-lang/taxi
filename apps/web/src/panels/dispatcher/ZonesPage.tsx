import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Popconfirm, Space, Switch, Tag, message } from "antd";
import { MapContainer, Polygon, Tooltip, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import { apiClient } from "../../shared/apiClient";
import { DataTable } from "../../shared/DataTable";

const MAP_CENTER: [number, number] = [30.05, 31.23];

interface LatLng {
  lat: number;
  lng: number;
}

interface Zone {
  id: string;
  name: string;
  active: boolean;
  fareOverrides: Record<string, unknown> | null;
  polygon: LatLng[];
}

interface ZoneFormValues {
  name: string;
  active: boolean;
  fareOverrides: string;
}

/**
 * Wires up leaflet-draw directly against the underlying Leaflet map instance
 * (via useMap) rather than a React wrapper package — leaflet-draw has no
 * actively-maintained React bindings compatible with react-leaflet v4.
 */
function DrawControl({ onCreated }: { onCreated: (points: LatLng[]) => void }) {
  const map = useMap();
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  useEffect(() => {
    const featureGroup = new L.FeatureGroup();
    map.addLayer(featureGroup);

    const drawControl = new L.Control.Draw({
      position: "topright",
      draw: {
        polygon: { allowIntersection: false, showArea: true },
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup, remove: false },
    });
    map.addControl(drawControl);

    function handleCreated(e: L.LeafletEvent) {
      const layer = (e as L.LeafletEvent & { layer: L.Polygon }).layer;
      featureGroup.clearLayers();
      featureGroup.addLayer(layer);
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]) ?? [];
      onCreatedRef.current(latlngs.map((p) => ({ lat: p.lat, lng: p.lng })));
    }

    map.on(L.Draw.Event.CREATED, handleCreated);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.removeControl(drawControl);
      map.removeLayer(featureGroup);
    };
  }, [map]);

  return null;
}

export function ZonesPage() {
  const queryClient = useQueryClient();
  const [drawnPolygon, setDrawnPolygon] = useState<LatLng[] | null>(null);
  const [createForm] = Form.useForm<ZoneFormValues>();
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editForm] = Form.useForm<ZoneFormValues>();

  const { data: zones } = useQuery({
    queryKey: ["zones"],
    queryFn: async () => (await apiClient.get<{ data: { zones: Zone[] } }>("/zones")).data.data.zones,
  });

  function invalidateZones() {
    void queryClient.invalidateQueries({ queryKey: ["zones"] });
  }

  const create = useMutation({
    mutationFn: (values: ZoneFormValues) =>
      apiClient.post("/zones", {
        name: values.name,
        active: values.active,
        fareOverrides: JSON.parse(values.fareOverrides || "{}"),
        polygon: drawnPolygon,
      }),
    onSuccess: () => {
      message.success("Zone created");
      setDrawnPolygon(null);
      createForm.resetFields();
      invalidateZones();
    },
    onError: () => message.error("Couldn't create the zone — check the fare overrides are valid JSON"),
  });

  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ZoneFormValues }) =>
      apiClient.patch(`/zones/${id}`, {
        name: values.name,
        active: values.active,
        fareOverrides: JSON.parse(values.fareOverrides || "{}"),
      }),
    onSuccess: () => {
      message.success("Zone updated");
      setEditingZone(null);
      invalidateZones();
    },
    onError: () => message.error("Couldn't update the zone — check the fare overrides are valid JSON"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/zones/${id}`),
    onSuccess: () => {
      message.success("Zone deleted");
      invalidateZones();
    },
  });

  return (
    <>
      <Card
        title="Draw a new zone"
        style={{ marginBottom: 16 }}
        extra={
          drawnPolygon && (
            <Button
              size="small"
              onClick={() => {
                setDrawnPolygon(null);
                createForm.resetFields();
              }}
            >
              Discard drawing
            </Button>
          )
        }
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="Use the polygon tool (top-right of the map) to draw a new zone, then fill in the form below to save it."
        />
        <MapContainer center={MAP_CENTER} zoom={11} style={{ height: "50vh", width: "100%", marginBottom: 16 }}>
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {zones?.map((z) => (
            <Polygon key={z.id} positions={z.polygon.map((p) => [p.lat, p.lng])} pathOptions={{ color: z.active ? "#1677ff" : "#999" }}>
              <Tooltip>{z.name}</Tooltip>
            </Polygon>
          ))}
          <DrawControl onCreated={setDrawnPolygon} />
        </MapContainer>

        <Form
          form={createForm}
          layout="inline"
          onFinish={(values) => create.mutate(values)}
          disabled={!drawnPolygon}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Zone name" />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item name="fareOverrides" label="Fare overrides (JSON)" initialValue="{}">
            <Input placeholder='e.g. {"baseFare": 600}' style={{ width: 220 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={create.isPending} disabled={!drawnPolygon}>
              Save zone
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="Zones">
        <DataTable<Zone>
          dataSource={zones}
          columns={[
            { title: "Name", dataIndex: "name" },
            {
              title: "Active",
              dataIndex: "active",
              render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "active" : "inactive"}</Tag>,
            },
            {
              title: "Fare overrides",
              dataIndex: "fareOverrides",
              render: (v: Record<string, unknown> | null) => (v && Object.keys(v).length ? JSON.stringify(v) : "—"),
            },
            {
              title: "Actions",
              render: (_: unknown, row) => (
                <Space>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingZone(row);
                      editForm.setFieldsValue({ name: row.name, active: row.active, fareOverrides: JSON.stringify(row.fareOverrides ?? {}) });
                    }}
                  >
                    Edit
                  </Button>
                  <Popconfirm title="Delete this zone?" onConfirm={() => remove.mutate(row.id)}>
                    <Button size="small" danger>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {editingZone && (
        <EditZoneModal
          zone={editingZone}
          form={editForm}
          loading={update.isPending}
          onCancel={() => setEditingZone(null)}
          onSubmit={(values) => update.mutate({ id: editingZone.id, values })}
        />
      )}
    </>
  );
}

function EditZoneModal({
  zone,
  form,
  loading,
  onCancel,
  onSubmit,
}: {
  zone: Zone;
  form: ReturnType<typeof Form.useForm<ZoneFormValues>>[0];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (values: ZoneFormValues) => void;
}) {
  return (
    <Card
      title={`Edit ${zone.name}`}
      style={{ position: "fixed", top: 80, right: 24, width: 360, zIndex: 1000, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}
      extra={
        <Button size="small" onClick={onCancel}>
          Close
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="active" label="Active" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="fareOverrides" label="Fare overrides (JSON)">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
