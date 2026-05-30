/** Map shared GET /api/incidents records to mobile map markers. */

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

export interface MobileIncidentMarker {
  id: string;
  lat: number;
  lng: number;
  urgency: string;
  transcript: string;
  timestamp: string;
}

export function mapSharedIncidents(raw: SharedIncident[]): MobileIncidentMarker[] {
  return raw
    .filter((inc) => inc.legitimate !== false)
    .map((inc) => ({
      id: inc.id,
      lat: inc.gps.lat,
      lng: inc.gps.lng,
      urgency: inc.urgency,
      transcript: inc.transcript,
      timestamp: inc.timestamp,
    }));
}
