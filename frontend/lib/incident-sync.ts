/** Map shared GET /api/incidents records to dashboard UI shapes. */

export interface SharedIncident {
  id: string;
  transcript: string;
  gps: { lat: number; lng: number };
  urgency: string;
  timestamp: string;
  escalated: boolean;
  ward_risk: number;
  legitimate?: boolean;
}

export interface IncidentMarker {
  id: number;
  gps: { lat: number; lng: number };
  urgency: string;
  transcript: string;
  timestamp: string;
}

export interface FeedIncident {
  id: number;
  transcript: string;
  urgency: string;
  timestamp: string;
  escalated: boolean;
  ward_risk: number;
  gps: { lat: number; lng: number };
}

function stableNumericId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash || Date.now();
}

export function mapSharedIncidents(raw: SharedIncident[]): {
  markers: IncidentMarker[];
  feed: FeedIncident[];
  confirmed: number;
} {
  const legitimate = raw.filter((inc) => inc.legitimate !== false);
  const markers: IncidentMarker[] = legitimate.map((inc) => ({
    id: stableNumericId(inc.id),
    gps: inc.gps,
    urgency: inc.urgency,
    transcript: inc.transcript,
    timestamp: inc.timestamp,
  }));
  const feed: FeedIncident[] = legitimate.map((inc) => ({
    id: stableNumericId(inc.id),
    transcript: inc.transcript,
    urgency: inc.urgency,
    timestamp: inc.timestamp,
    escalated: inc.escalated,
    ward_risk: typeof inc.ward_risk === "number" ? inc.ward_risk : 0,
    gps: inc.gps,
  }));
  const confirmed = legitimate.filter((inc) => inc.escalated).length;
  return { markers, feed, confirmed };
}

export function wardRiskScore(wardRisk: unknown): number {
  if (typeof wardRisk === "number") return wardRisk;
  if (wardRisk && typeof wardRisk === "object" && "score" in wardRisk) {
    return Number((wardRisk as { score?: number }).score) || 0;
  }
  return 0;
}
