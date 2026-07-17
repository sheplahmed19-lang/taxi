import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider theme={{ token: { colorPrimary: "#7c3aed" } }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
