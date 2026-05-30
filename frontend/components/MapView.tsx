"use client";
import { useEffect, useRef, useState } from "react";

export interface SpatialData {
  closest_hydrants?: Array<{
    id: string;
    distance_meters: number;
    status: string;
    address: string;
    lat: number;
    lng: number;
  }>;
  building_specs?: {
    address: string;
    floors: number;
    units: number;
    distance_meters: number;
    score: number;
    lat?: number;
    lng?: number;
  };
  query_location?: { lat: number; lng: number };
}

interface MapViewProps {
  gps?: { lat: number; lng: number };
  spatial?: SpatialData | null;
  urgency?: string;
  isActive: boolean;
}

const TORONTO: [number, number] = [43.6532, -79.3832];

const URGENCY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  LOW: "#22c55e",
};

const URGENCY_RADIUS: Record<string, number> = {
  CRITICAL: 300,
  HIGH: 200,
  LOW: 120,
};

export default function MapView({ gps, spatial, urgency, isActive }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const incidentMarkerRef = useRef<any>(null);
  const alertCircleRef = useRef<any>(null);
  const hydrantMarkersRef = useRef<any[]>([]);
  const buildingMarkerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    import("leaflet").then((mod) => {
      const L = mod.default;
      LRef.current = L;

      // Fix broken default icon paths in bundled environments
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current!, { zoomControl: true }).setView(TORONTO, 13);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update incident marker + alert ring
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;

    incidentMarkerRef.current?.remove();
    alertCircleRef.current?.remove();

    if (!gps) return;

    const color = URGENCY_COLOR[urgency ?? "HIGH"] ?? "#f97316";

    const el = document.createElement("div");
    el.style.cssText = `
      width:16px; height:16px;
      border-radius:50%;
      background:${color};
      border:2px solid white;
      box-shadow:0 0 0 4px ${color}44;
      ${isActive ? "animation:cv-pulse 1.2s ease-in-out infinite;" : ""}
    `;

    incidentMarkerRef.current = L.marker([gps.lat, gps.lng], {
      icon: L.divIcon({ html: el, className: "", iconSize: [16, 16], iconAnchor: [8, 8] }),
    })
      .bindPopup(
        `<strong>INCIDENT</strong><br/>${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}<br/>Urgency: ${urgency ?? "—"}`
      )
      .addTo(map);

    const radius = URGENCY_RADIUS[urgency ?? "HIGH"] ?? 200;
    alertCircleRef.current = L.circle([gps.lat, gps.lng], {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.12,
      weight: 1.5,
      opacity: 0.5,
    }).addTo(map);

    map.flyTo([gps.lat, gps.lng], 15);
  }, [gps, urgency, isActive, mapReady]);

  // Update hydrant + building markers
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;

    hydrantMarkersRef.current.forEach((m) => m.remove());
    hydrantMarkersRef.current = [];
    buildingMarkerRef.current?.remove();

    if (!spatial) return;

    spatial.closest_hydrants?.forEach((h) => {
      if (!h.lat || !h.lng) return;
      const el = document.createElement("div");
      el.textContent = "▲";
      el.style.cssText =
        "color:#60a5fa;font-size:18px;cursor:pointer;text-shadow:0 0 6px #1d4ed8;line-height:1;";
      el.title = `Hydrant #${h.id} · ${h.distance_meters} m`;

      const marker = L.marker([h.lat, h.lng], {
        icon: L.divIcon({ html: el, className: "", iconSize: [18, 18], iconAnchor: [9, 9] }),
      })
        .bindPopup(
          `<strong>Hydrant #${h.id}</strong><br/>Distance: ${h.distance_meters} m<br/>Status: ${h.status}<br/>${h.address}`
        )
        .addTo(map);

      hydrantMarkersRef.current.push(marker);
    });

    const b = spatial.building_specs;
    if (b?.lat && b?.lng) {
      const el = document.createElement("div");
      el.textContent = "■";
      el.style.cssText =
        "color:#fb923c;font-size:16px;cursor:pointer;text-shadow:0 0 6px #ea580c;line-height:1;";

      buildingMarkerRef.current = L.marker([b.lat, b.lng], {
        icon: L.divIcon({ html: el, className: "", iconSize: [16, 16], iconAnchor: [8, 8] }),
      })
        .bindPopup(
          `<strong>${b.address}</strong><br/>Floors: ${b.floors} · Units: ${b.units}<br/>Score: ${b.score} · Built: ${(b as any).year_built ?? "—"}`
        )
        .addTo(map);
    }
  }, [spatial, mapReady]);

  return (
    <>
      <style>{`
        @keyframes cv-pulse {
          0%,100% { box-shadow:0 0 0 4px rgba(239,68,68,0.3); }
          50%      { box-shadow:0 0 0 8px rgba(239,68,68,0.1); }
        }
        .leaflet-container { background:#1a1a2e; }
        .leaflet-popup-content-wrapper { background:#1e1e2e; color:#e2e8f0; border:1px solid #334155; }
        .leaflet-popup-tip { background:#1e1e2e; }
      `}</style>
      <div ref={containerRef} className="w-full h-full" />
    </>
  );
}
