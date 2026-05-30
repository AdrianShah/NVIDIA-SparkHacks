"use client";
import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

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

const TORONTO: [number, number] = [-79.3832, 43.6532];

const URGENCY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  LOW: "#22c55e",
};

export default function MapView({ gps, spatial, urgency, isActive }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const incidentMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const hydrantMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const buildingMarkerRef = useRef<mapboxgl.Marker | null>(null);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: TORONTO,
      zoom: 13,
    });

    map.on("load", () => {
      // Alert radius circle layer
      map.addSource("alert-circle", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "alert-fill",
        type: "circle",
        source: "alert-circle",
        paint: {
          "circle-radius": 0,
          "circle-color": "#ef4444",
          "circle-opacity": 0.12,
          "circle-stroke-color": "#ef4444",
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.5,
        },
      });
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update incident marker + alert ring
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    incidentMarkerRef.current?.remove();

    if (!gps) return;

    const el = document.createElement("div");
    el.style.cssText = `
      width: 16px; height: 16px;
      border-radius: 50%;
      background: ${URGENCY_COLOR[urgency ?? "HIGH"] ?? "#f97316"};
      border: 2px solid white;
      box-shadow: 0 0 0 4px ${URGENCY_COLOR[urgency ?? "HIGH"] ?? "#f97316"}44;
    `;
    if (isActive) {
      el.style.animation = "mapboxgl-pin-pulse 1.2s ease-in-out infinite";
    }

    incidentMarkerRef.current = new mapboxgl.Marker({ element: el })
      .setLngLat([gps.lng, gps.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 12 }).setHTML(
          `<strong>INCIDENT</strong><br/>${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}<br/>Urgency: ${urgency ?? "—"}`
        )
      )
      .addTo(map);

    map.flyTo({ center: [gps.lng, gps.lat], zoom: 15, speed: 1.4 });

    // Update alert radius layer (pixels — approximate 300 m at zoom 15)
    const radiusPx = urgency === "CRITICAL" ? 90 : urgency === "HIGH" ? 60 : 35;
    try {
      const source = map.getSource("alert-circle") as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [gps.lng, gps.lat] },
              properties: {},
            },
          ],
        });
        map.setPaintProperty("alert-fill", "circle-radius", radiusPx);
        map.setPaintProperty("alert-fill", "circle-color", URGENCY_COLOR[urgency ?? "HIGH"] ?? "#ef4444");
        map.setPaintProperty("alert-fill", "circle-stroke-color", URGENCY_COLOR[urgency ?? "HIGH"] ?? "#ef4444");
      }
    } catch {}
  }, [gps, urgency, isActive]);

  // Update hydrant markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    hydrantMarkersRef.current.forEach((m) => m.remove());
    hydrantMarkersRef.current = [];
    buildingMarkerRef.current?.remove();

    if (!spatial) return;

    // Hydrant markers (blue triangles)
    spatial.closest_hydrants?.forEach((h) => {
      if (!h.lat || !h.lng) return;
      const el = document.createElement("div");
      el.textContent = "▲";
      el.style.cssText = "color:#60a5fa; font-size:18px; cursor:pointer; text-shadow:0 0 6px #1d4ed8;";
      el.title = `Hydrant #${h.id} · ${h.distance_meters} m`;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([h.lng, h.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 8 }).setHTML(
            `<strong>Hydrant #${h.id}</strong><br/>Distance: ${h.distance_meters} m<br/>Status: ${h.status}<br/>${h.address}`
          )
        )
        .addTo(map);

      hydrantMarkersRef.current.push(marker);
    });

    // Building marker (orange square)
    const b = spatial.building_specs;
    if (b?.lat && b?.lng) {
      const el = document.createElement("div");
      el.textContent = "■";
      el.style.cssText = "color:#fb923c; font-size:16px; cursor:pointer; text-shadow:0 0 6px #ea580c;";

      buildingMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([b.lng, b.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 8 }).setHTML(
            `<strong>${b.address}</strong><br/>Floors: ${b.floors} · Units: ${b.units}<br/>Score: ${b.score} · Built: ${(b as any).year_built ?? "—"}`
          )
        )
        .addTo(map);
    }
  }, [spatial]);

  return <div ref={containerRef} className="w-full h-full" />;
}
