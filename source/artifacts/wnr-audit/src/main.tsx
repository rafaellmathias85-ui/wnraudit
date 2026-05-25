import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, "");

setBaseUrl(appBasePath);

if (appBasePath && typeof window !== "undefined") {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      return nativeFetch(`${appBasePath}${input}`, init);
    }

    return nativeFetch(input, init);
  };
}

createRoot(document.getElementById("root")!).render(<App />);
