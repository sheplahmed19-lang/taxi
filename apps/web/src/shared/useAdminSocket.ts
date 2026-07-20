import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { loadSession } from "./auth";

/**
 * One /admin namespace connection per mounted page. Live ops pages read
 * driver/trip deltas off this socket (admin:driver_location, admin:driver_status,
 * admin:trip_new, admin:trip_status — see docs/socket-events.md) on top of an
 * initial REST snapshot.
 */
export function useAdminSocket(): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  if (!socketRef.current) {
    const session = loadSession();
    if (session) {
      socketRef.current = io("/admin", { auth: { token: session.accessToken } });
    }
  }

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  return socketRef.current;
}
