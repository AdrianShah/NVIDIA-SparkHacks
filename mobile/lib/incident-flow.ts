/** Two-step Human-in-the-Loop incident API (predict → confirm → finalize). */

import { API_URL as CONFIGURED_API_URL } from "../config/api";

const API_URL = CONFIGURED_API_URL || "http://localhost:8080";

export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface PredictResult {
  prediction_id: string;
  hazard_type: string;
  confidence: number;
}

export interface FinalizeResult {
  report: string;
  urgency: string;
  vision: Record<string, unknown>;
  spatial: Record<string, unknown>;
  environmental_risk?: Record<string, unknown>;
  ward_risk?: Record<string, unknown> | number;
  compound_risk?: Record<string, unknown>;
  escalated?: boolean;
  escalation_reason?: string;
  performance?: Record<string, unknown>;
  legitimate?: boolean;
}

export class IncidentFlowError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "IncidentFlowError";
  }
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function predictIncident(
  frame_b64: string,
  gps: GpsCoords
): Promise<PredictResult> {
  const res = await fetch(`${API_URL}/api/incident/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame_b64, gps }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new IncidentFlowError(
      String(data.detail ?? "Vision prediction failed"),
      res.status
    );
  }
  return {
    prediction_id: String(data.prediction_id ?? ""),
    hazard_type: String(data.hazard_type ?? "Unknown"),
    confidence: Number(data.confidence ?? 0),
  };
}

export interface FinalizeParams {
  prediction_id: string;
  confirmed: boolean;
  gps: GpsCoords;
  user_correction?: string;
}

export async function finalizeIncident(params: FinalizeParams): Promise<FinalizeResult> {
  const body: Record<string, unknown> = {
    prediction_id: params.prediction_id,
    confirmed: params.confirmed,
    gps: params.gps,
  };
  if (!params.confirmed && params.user_correction?.trim()) {
    body.user_correction = params.user_correction.trim();
  }

  const res = await fetch(`${API_URL}/api/incident/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new IncidentFlowError(
      String(data.detail ?? "Finalize failed"),
      res.status
    );
  }
  return data as unknown as FinalizeResult;
}

export function wardRiskScore(wardRisk: FinalizeResult["ward_risk"]): number {
  if (typeof wardRisk === "number") return wardRisk;
  if (wardRisk && typeof wardRisk === "object" && "score" in wardRisk) {
    return Number((wardRisk as { score?: number }).score) || 0;
  }
  return 0;
}
