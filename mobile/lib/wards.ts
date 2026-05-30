import type { WardScore } from "../components/MapView";

/** Normalize GET /api/risk-map records for the mobile map. */
export function normalizeWards(raw: unknown[]): WardScore[] {
  return raw
    .map((item): WardScore | null => {
      if (!item || typeof item !== "object") return null;
      const w = item as Record<string, unknown>;
      const lat = typeof w.lat === "number" ? w.lat : NaN;
      const lng = typeof w.lng === "number" ? w.lng : NaN;
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
      const risk =
        (typeof w.risk_level === "string" && w.risk_level) ||
        (typeof w.level === "string" && w.level) ||
        "LOW";
      return {
        id: String(w.id ?? w.ward_id ?? ""),
        name: String(w.name ?? w.ward_name ?? "Unknown ward"),
        score: Number(w.score ?? 0),
        lat,
        lng,
        risk_level: risk as WardScore["risk_level"],
        in_flood_zone: Boolean(w.in_flood_zone),
        prior_311: typeof w.prior_311 === "number" ? w.prior_311 : 0,
        watermain_age:
          typeof w.watermain_age === "number" ? w.watermain_age : undefined,
      };
    })
    .filter((w): w is WardScore => w !== null);
}
