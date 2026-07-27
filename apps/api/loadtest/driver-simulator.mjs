// Phase 5.1 load test: connects every seeded driver from .fixtures.json as a
// real Socket.IO client, streams periodic driver:location pings for the
// run's duration, and auto-accepts any trip:request offer it receives so
// dispatch-load.js's trips actually reach "accepted" instead of cycling
// through every online driver's offer timeout. Run alongside (before)
// dispatch-load.js, not after.
import { readFileSync } from "node:fs";
import { io } from "socket.io-client";

const BASE_URL = process.env.LOADTEST_BASE_URL ?? "http://localhost:4000";
const DURATION_S = Number(process.env.LOADTEST_DURATION_S ?? 60);
const LOCATION_INTERVAL_MS = Number(process.env.LOADTEST_LOCATION_INTERVAL_MS ?? 4000);

const fixtures = JSON.parse(readFileSync(new URL("./.fixtures.json", import.meta.url), "utf8"));

const CENTER = fixtures.pickup;
let connected = 0;
let connectFailed = 0;
let locationPingsSent = 0;
let offersAccepted = 0;

function jitter(point, maxKm) {
  const deg = maxKm * 0.009;
  return { lat: point.lat + (Math.random() * 2 - 1) * deg, lng: point.lng + (Math.random() * 2 - 1) * deg };
}

function connectDriver(driver) {
  return new Promise((resolve) => {
    const socket = io(`${BASE_URL}/app`, { auth: { token: driver.token }, reconnection: true, timeout: 5000 });

    socket.on("connect", () => {
      connected++;
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      connectFailed++;
      console.error(`driver ${driver.id} connect_error:`, err.message);
      resolve(null);
    });
    socket.on("trip:request", (payload) => {
      socket.emit("trip:driver_response", { tripId: payload.trip.id, accept: true });
      offersAccepted++;
    });
  });
}

async function main() {
  console.log(`Connecting ${fixtures.drivers.length} simulated drivers to ${BASE_URL}...`);
  const sockets = await Promise.all(fixtures.drivers.map(connectDriver));
  const live = sockets.filter(Boolean);
  console.log(`Connected: ${connected}, failed: ${connectFailed}`);

  const pingInterval = setInterval(() => {
    for (const socket of live) {
      const pos = jitter(CENTER, 3);
      socket.emit("driver:location", { ...pos, heading: Math.random() * 360, speed: 20, ts: Date.now() });
      locationPingsSent++;
    }
  }, LOCATION_INTERVAL_MS);

  await new Promise((resolve) => setTimeout(resolve, DURATION_S * 1000));

  clearInterval(pingInterval);
  for (const socket of live) socket.disconnect();

  console.log("--- driver-simulator results ---");
  console.log(`Connected: ${connected}/${fixtures.drivers.length} (${connectFailed} failed)`);
  console.log(`Location pings sent: ${locationPingsSent}`);
  console.log(`Trip offers auto-accepted: ${offersAccepted}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
