"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export interface WardFeature {
  id:            string;
  name:          string;
  score:         number;
  lat:           number;
  lng:           number;
  risk_level:    "CRITICAL" | "HIGH" | "ELEVATED" | "LOW";
  in_flood_zone?: boolean;
  prior_311?:    number;
  watermain_age?: number;
}

export interface IncidentMarker {
  id:         number;
  gps:        { lat: number; lng: number };
  urgency:    string;
  transcript: string;
  timestamp:  string;
}

interface MapViewProps {
  wardScores:  WardFeature[];
  incidents:   IncidentMarker[];
  onWardClick: (ward: WardFeature) => void;
  isDark:      boolean;
}

const URGENCY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  LOW:      "#22c55e",
};

export default function MapView({ wardScores, incidents, onWardClick, isDark }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const markersRef   = useRef<maplibregl.Marker[]>([]);
  const onWardRef    = useRef(onWardClick);
  useEffect(() => { onWardRef.current = onWardClick; }, [onWardClick]);

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style:     isDark
        ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center:  [-79.3832, 43.6532],
      zoom:    10.5,
      minZoom: 9,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      setupSources(map);
      setupLayers(map);
      map.on("click", "ward-fill", (e) => {
        const props = e.features?.[0]?.properties;
        if (props) onWardRef.current(props as WardFeature);
      });
      map.on("mouseenter", "ward-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "ward-fill", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line

  // ── Theme switch ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const newStyle = isDark
      ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      : "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
    map.setStyle(newStyle);
    map.once("style.load", () => {
      setupSources(map);
      setupLayers(map);
    });
  }, [isDark]);

  // ── Ward data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || wardScores.length === 0) return;
    const update = () => {
      const src = map.getSource("wards") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type:     "FeatureCollection",
        features: wardScores.map((w) => ({
          type:       "Feature" as const,
          properties: { ...w },
          geometry:   { type: "Point" as const, coordinates: [w.lng, w.lat] },
        })),
      });
    };
    if (map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [wardScores]);

  // ── Incident markers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    incidents.forEach((inc) => {
      const color = URGENCY_COLOR[inc.urgency] ?? "#f97316";
      const el    = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color};cursor:pointer;animation:pulse 1.5s infinite;`;
      const popup = new maplibregl.Popup({ offset: 12, closeButton: false }).setHTML(
        `<div style="font-family:monospace">
          <b style="color:${color}">${inc.urgency}</b><br/>
          ${inc.transcript.slice(0, 90)}${inc.transcript.length > 90 ? "…" : ""}<br/>
          <span style="font-size:10px;opacity:0.5">${new Date(inc.timestamp).toLocaleTimeString()}</span>
        </div>`
      );
      markersRef.current.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([inc.gps.lng, inc.gps.lat])
          .setPopup(popup)
          .addTo(map)
      );
    });
  }, [incidents]);

  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
      <div ref={containerRef} className="w-full h-full" />
    </>
  );
}

function setupSources(map: maplibregl.Map) {
  if (!map.getSource("wards")) {
    map.addSource("wards", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
}

function setupLayers(map: maplibregl.Map) {
  if (!map.getLayer("ward-fill")) {
    map.addLayer({
      id: "ward-fill", type: "circle", source: "wards",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 13, 28],
        "circle-color": [
          "interpolate", ["linear"], ["get", "score"],
          0,  "#22c55e",
          40, "#eab308",
          60, "#f97316",
          80, "#ef4444",
        ],
        "circle-opacity": 0.5,
        "circle-stroke-color": [
          "interpolate", ["linear"], ["get", "score"],
          0, "#22c55e", 40, "#eab308", 60, "#f97316", 80, "#ef4444",
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("ward-label")) {
    map.addLayer({
      id: "ward-label", type: "symbol", source: "wards", minzoom: 11,
      layout: {
        "text-field":      ["concat", ["get", "name"], "\n", ["to-string", ["get", "score"]], "/100"],
        "text-size":       10,
        "text-anchor":     "top",
        "text-offset":     [0, 1.2],
        "text-font":       ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-max-width":  8,
      },
      paint: {
        "text-color":       "#ffffff",
        "text-halo-color":  "rgba(0,0,0,0.7)",
        "text-halo-width":  1.5,
      },
    });
  }
}
