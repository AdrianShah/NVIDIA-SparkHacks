import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import RNMapView, { UrlTile, Marker, Circle } from "react-native-maps";

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
  gps: { lat: number; lng: number };
  spatial?: SpatialData | null;
  urgency?: string;
  isActive: boolean;
}

const URGENCY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  LOW:      "#22c55e",
};

const URGENCY_RADIUS: Record<string, number> = {
  CRITICAL: 300,
  HIGH:     200,
  LOW:      120,
};

export default function MapView({ gps, spatial, urgency, isActive }: MapViewProps) {
  const mapRef = useRef<RNMapView>(null);

  useEffect(() => {
    if (!isActive) return;
    mapRef.current?.animateToRegion(
      { latitude: gps.lat, longitude: gps.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      800
    );
  }, [gps, isActive]);

  const color = URGENCY_COLOR[urgency ?? "HIGH"] ?? "#f97316";
  const radius = URGENCY_RADIUS[urgency ?? "HIGH"] ?? 200;

  return (
    <RNMapView
      ref={mapRef}
      style={styles.map}
      initialRegion={{
        latitude: gps.lat,
        longitude: gps.lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
    >
      {/* CartoDB Dark Matter tiles — free, no token */}
      <UrlTile
        urlTemplate="https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
        maximumZ={19}
        flipY={false}
      />

      {/* Incident marker */}
      <Marker
        coordinate={{ latitude: gps.lat, longitude: gps.lng }}
        title="INCIDENT"
        description={`Urgency: ${urgency ?? "—"}`}
        pinColor={color}
      />

      {/* Alert radius circle */}
      {isActive && (
        <Circle
          center={{ latitude: gps.lat, longitude: gps.lng }}
          radius={radius}
          fillColor={`${color}22`}
          strokeColor={color}
          strokeWidth={1.5}
        />
      )}

      {/* Hydrant markers */}
      {spatial?.closest_hydrants?.map((h) =>
        h.lat && h.lng ? (
          <Marker
            key={h.id}
            coordinate={{ latitude: h.lat, longitude: h.lng }}
            title={`Hydrant #${h.id}`}
            description={`${h.distance_meters} m · ${h.status}\n${h.address}`}
            pinColor="#60a5fa"
          />
        ) : null
      )}

      {/* Building marker */}
      {spatial?.building_specs?.lat && spatial.building_specs.lng && (
        <Marker
          coordinate={{
            latitude: spatial.building_specs.lat,
            longitude: spatial.building_specs.lng,
          }}
          title={spatial.building_specs.address}
          description={`Floors: ${spatial.building_specs.floors} · Units: ${spatial.building_specs.units}`}
          pinColor="#fb923c"
        />
      )}
    </RNMapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
