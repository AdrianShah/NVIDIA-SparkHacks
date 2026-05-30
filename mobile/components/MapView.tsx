import React, { useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import RNMapView, { UrlTile, Marker, Circle, Callout } from "react-native-maps";

export interface WardScore {
  id:            string;
  name:          string;
  score:         number;
  lat:           number;
  lng:           number;
  risk_level:    "CRITICAL" | "HIGH" | "ELEVATED" | "LOW";
  in_flood_zone?: boolean;
  prior_311?:    number;
  watermain_age?: number;
  construction?: boolean;
}

export interface BuildingPoint {
  address: string;
  score:   number;
  ward:    string;
  floors:  number;
  lat:     number;
  lng:     number;
}

export interface SpatialData {
  closest_hydrants?: Array<{
    id: string; distance_meters: number; status: string; address: string; lat: number; lng: number;
  }>;
  building_specs?: { address: string; floors: number; compliance_score?: number; distance_meters?: number };
  prior_311_calls?: number;
  in_flood_zone?: boolean;
}

interface MapViewProps {
  gps:          { lat: number; lng: number };
  wardScores:   WardScore[];
  buildings?:   BuildingPoint[];
  spatial?:     SpatialData | null;
  incidents?:   Array<{ lat: number; lng: number; urgency: string; transcript: string }>;
  isDark:       boolean;
  isActive:     boolean;
  urgency?:     string;
  onWardPress:  (ward: WardScore) => void;
}

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH:     "#f97316",
  ELEVATED: "#eab308",
  LOW:      "#22c55e",
};

// Building compliance colour (red = failing, yellow = borderline)
function buildingColor(score: number): string {
  if (score < 35) return "#ef4444";
  if (score < 55) return "#f97316";
  return "#eab308";
}

export default function MapView({ gps, wardScores, buildings = [], spatial, incidents, isDark, isActive, urgency, onWardPress }: MapViewProps) {
  const mapRef = useRef<RNMapView>(null);

  const tileUrl = isDark
    ? "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
    : "https://a.basemaps.cartocdn.com/positron/{z}/{x}/{y}.png";

  const incidentColor = RISK_COLOR[urgency ?? "HIGH"] ?? "#f97316";

  return (
    <RNMapView
      ref={mapRef}
      style={styles.map}
      initialRegion={{ latitude: gps.lat, longitude: gps.lng, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
    >
      <UrlTile urlTemplate={tileUrl} maximumZ={19} flipY={false} />

      {/* ── Ward risk zones ── */}
      {wardScores.map((ward) => {
        const color = RISK_COLOR[ward.risk_level];
        const radius = ward.risk_level === "CRITICAL" ? 2000
                     : ward.risk_level === "HIGH"     ? 1600
                     : ward.risk_level === "ELEVATED" ? 1200 : 900;
        return (
          <React.Fragment key={ward.id}>
            <Circle
              center={{ latitude: ward.lat, longitude: ward.lng }}
              radius={radius}
              fillColor={`${color}28`}
              strokeColor={color}
              strokeWidth={1.5}
            />
            <Marker
              coordinate={{ latitude: ward.lat, longitude: ward.lng }}
              onPress={() => onWardPress(ward)}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={[styles.wardDot, { backgroundColor: color, borderColor: color }]}>
                <Text style={styles.wardScore}>{ward.score.toFixed(0)}</Text>
              </View>
              <Callout tooltip onPress={() => onWardPress(ward)}>
                <View style={styles.callout}>
                  <Text style={[styles.calloutTitle, { color }]}>{ward.risk_level}</Text>
                  <Text style={styles.calloutName}>{ward.name}</Text>
                  <Text style={styles.calloutScore}>Risk: {ward.score.toFixed(0)}/100</Text>
                  {ward.construction && <Text style={[styles.calloutScore, { color: "#f97316" }]}>⚠ Active construction</Text>}
                  <Text style={styles.calloutHint}>Tap for details →</Text>
                </View>
              </Callout>
            </Marker>
          </React.Fragment>
        );
      })}

      {/* ── At-risk buildings (small dots) ── */}
      {buildings.map((b, i) => (
        <Marker
          key={`b-${i}`}
          coordinate={{ latitude: b.lat, longitude: b.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={[styles.buildingDot, { backgroundColor: buildingColor(b.score) }]} />
          <Callout tooltip>
            <View style={styles.callout}>
              <Text style={[styles.calloutTitle, { color: buildingColor(b.score) }]}>
                RentSafe: {b.score}/100
              </Text>
              <Text style={styles.calloutName} numberOfLines={2}>{b.address}</Text>
              {b.floors > 0 && <Text style={styles.calloutScore}>{b.floors} floors</Text>}
            </View>
          </Callout>
        </Marker>
      ))}

      {/* ── User location ── */}
      <Marker coordinate={{ latitude: gps.lat, longitude: gps.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
        <View style={styles.myLocation} />
      </Marker>

      {/* ── Active incident radius ── */}
      {isActive && (
        <Circle
          center={{ latitude: gps.lat, longitude: gps.lng }}
          radius={250}
          fillColor={`${incidentColor}22`}
          strokeColor={incidentColor}
          strokeWidth={2}
        />
      )}

      {/* ── Hydrant markers after incident ── */}
      {spatial?.closest_hydrants?.map((h) =>
        h.lat && h.lng ? (
          <Marker key={h.id} coordinate={{ latitude: h.lat, longitude: h.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.hydrantDot} />
          </Marker>
        ) : null
      )}

      {/* ── Past incident markers ── */}
      {incidents?.map((inc, i) => (
        <Marker key={`inc-${i}`} coordinate={{ latitude: inc.lat, longitude: inc.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.incidentDot, { backgroundColor: RISK_COLOR[inc.urgency] ?? "#f97316" }]} />
        </Marker>
      ))}
    </RNMapView>
  );
}

const styles = StyleSheet.create({
  map:          { flex: 1 },
  wardDot:      { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: "center", justifyContent: "center", opacity: 0.9 },
  wardScore:    { color: "#fff", fontSize: 9, fontFamily: "monospace", fontWeight: "700" },
  buildingDot:  { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: "#00000066" },
  callout:      { backgroundColor: "#0d1f2d", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#134e4a", minWidth: 140, maxWidth: 200 },
  calloutTitle: { fontFamily: "monospace", fontSize: 11, fontWeight: "700" },
  calloutName:  { color: "#e5e7eb", fontFamily: "monospace", fontSize: 10, marginTop: 3 },
  calloutScore: { color: "#9ca3af", fontFamily: "monospace", fontSize: 10, marginTop: 2 },
  calloutHint:  { color: "#2dd4bf", fontFamily: "monospace", fontSize: 9, marginTop: 6 },
  myLocation:   { width: 12, height: 12, borderRadius: 6, backgroundColor: "#3b82f6", borderWidth: 2, borderColor: "#fff" },
  hydrantDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#60a5fa", borderWidth: 1, borderColor: "#fff" },
  incidentDot:  { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "#fff" },
});
