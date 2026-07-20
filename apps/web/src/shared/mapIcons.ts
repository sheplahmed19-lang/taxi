import L from "leaflet";

/** Small colored dot markers — avoids bundling Leaflet's default marker-icon PNGs. */
function dotIcon(color: string, size = 14): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export const driverIcon = dotIcon("#1677ff", 16);
export const pickupIcon = dotIcon("#52c41a");
export const dropIcon = dotIcon("#f5222d");
export const replayIcon = dotIcon("#722ed1", 18);
