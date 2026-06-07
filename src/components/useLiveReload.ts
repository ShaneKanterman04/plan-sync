"use client";

import { useEffect, useRef, useState } from "react";

export function useLiveReload({
  url,
  load,
  disconnectMessage,
}: {
  url: string;
  load: () => void | Promise<void>;
  disconnectMessage: string;
}) {
  const [connectionError, setConnectionError] = useState("");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    load();
    const source = new EventSource(url);
    sourceRef.current = source;
    source.addEventListener("ready", () => setConnectionError(""));
    source.addEventListener("changed", () => {
      setConnectionError("");
      load();
    });
    source.onerror = () => setConnectionError(disconnectMessage);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      source.close();
      sourceRef.current = null;
      window.removeEventListener("focus", onFocus);
    };
  }, [disconnectMessage, load, url]);

  useEffect(() => {
    if (!connectionError) return;
    const id = window.setInterval(() => {
      load();
    }, 2_000);
    return () => window.clearInterval(id);
  }, [connectionError, load]);

  return connectionError;
}
