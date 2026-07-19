import axios, { type InternalAxiosRequestConfig } from "axios";
import { clearSession, loadSession, saveSession } from "./auth";

export const apiClient = axios.create({
  baseURL: "/api/v1",
});

apiClient.interceptors.request.use((config) => {
  const session = loadSession();
  if (session) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let refreshInFlight: Promise<string> | null = null;

/** Plain axios (not apiClient) — avoids recursing back into these same interceptors. */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { data } = await axios.post("/api/v1/auth/refresh", { refreshToken });
  return data.data.accessToken as string;
}

// On a 401, try exactly once to refresh the access token and replay the
// original request; on refresh failure, drop the session and bounce to login.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as RetriableConfig | undefined;
    const session = loadSession();

    if (error.response?.status !== 401 || !original || original._retried || !session) {
      return Promise.reject(error);
    }
    original._retried = true;

    try {
      refreshInFlight ??= refreshAccessToken(session.refreshToken);
      const accessToken = await refreshInFlight;
      saveSession({ ...session, accessToken });
      original.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(original);
    } catch (refreshError) {
      clearSession();
      window.location.href = "/login";
      return Promise.reject(refreshError);
    } finally {
      refreshInFlight = null;
    }
  },
);
