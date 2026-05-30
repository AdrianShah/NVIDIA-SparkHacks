"""
Delation LangGraph state machine — 4 nodes, 3 models.
Orchestrator (Mistral Nemotron) → Vision (Llama 4 Maverick, optional)
  → Localizer (GeoPandas/cuSpatial, no LLM) → Compiler (Nemotron Nano 30B)
"""
import json
import logging
import os
import re
from typing import Literal, TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from backend.data.toronto_loader import (
    check_flood_zone,
    get_building_specs,
    get_closest_hydrants,
    get_prior_311_calls,
    get_ward_risk_score,
)

logger = logging.getLogger(__name__)

LOCAL_LLM_URL      = os.environ.get("LOCAL_LLM_URL",      "http://localhost:8000/v1")
ORCHESTRATOR_MODEL = os.environ.get("ORCHESTRATOR_MODEL", "mistral-nemo")
VISION_MODEL       = os.environ.get("VISION_MODEL",       "llama3.2-vision")
COMPILER_MODEL     = os.environ.get("COMPILER_MODEL",     "nemotron-mini")
MOCK_MODE          = os.environ.get("MOCK_MODE", "false").lower() == "true"


def _make_llm(model: str) -> ChatOpenAI:
    return ChatOpenAI(
        base_url=LOCAL_LLM_URL,
        api_key="not-needed",
        model=model,
        temperature=0,
        max_retries=2,
    )


def _strip_json(raw: str) -> str:
    return re.sub(r"```[\w]*\n?|```", "", raw).strip()


def _safe_json(raw: str, fallback: dict) -> dict:
    try:
        return json.loads(_strip_json(raw))
    except (json.JSONDecodeError, ValueError):
        logger.warning("JSON parse failed: %r", raw[:200])
        return fallback


class AgentState(TypedDict):
    messages:             list[BaseMessage]
    video_frames_base64:  list[str]
    gps_coordinates:      dict
    vision_analysis:      dict
    spatial_data_results: dict
    ward_risk_score:      float
    next_step:            str
    urgency_level:        str
    escalated:            bool
    is_legitimate:        bool
    final_dispatch_report: str


# ── Node 1: Orchestrator ──────────────────────────────────────────────────────

ORCHESTRATOR_SYSTEM = """You are an emergency triage AI for the City of Toronto.
Analyse the citizen report and decide:
1. Is this a legitimate emergency or civic issue? (not spam/test/gibberish)
2. Does it require visual analysis?
3. What is the urgency level?

Output ONLY valid JSON — no markdown fences:
{
  "is_legitimate": bool,
  "requires_vision": bool,
  "urgency_level": "LOW" | "HIGH" | "CRITICAL"
}"""


def orchestrator_node(state: AgentState) -> dict:
    transcript = state["messages"][-1].content if state["messages"] else ""

    if MOCK_MODE:
        parsed = {"is_legitimate": True, "requires_vision": bool(state.get("video_frames_base64")), "urgency_level": "HIGH"}
    else:
        llm = _make_llm(ORCHESTRATOR_MODEL)
        resp = llm.invoke([
            SystemMessage(content=ORCHESTRATOR_SYSTEM),
            HumanMessage(content=f'Citizen report: "{transcript}"'),
        ])
        parsed = _safe_json(resp.content, {"is_legitimate": True, "requires_vision": False, "urgency_level": "HIGH"})

    has_frame = bool(state.get("video_frames_base64"))
    legitimate = parsed.get("is_legitimate", True)
    next_step  = "vision" if (legitimate and parsed.get("requires_vision") and has_frame) else (
                 "localizer" if legitimate else "end")

    return {
        "is_legitimate": legitimate,
        "next_step":     next_step,
        "urgency_level": parsed.get("urgency_level", "HIGH"),
    }


# ── Node 2: Vision Agent ──────────────────────────────────────────────────────

VISION_SYSTEM = """You are a computer vision AI analysing an emergency frame for the City of Toronto.
Output ONLY valid JSON — no markdown fences:
{
  "hazard_type": str,
  "severity_scale": int (1-10),
  "water_depth_m": float | null,
  "structural_risk": bool,
  "location_cues": str
}"""


def vision_node(state: AgentState) -> dict:
    transcript = state["messages"][-1].content if state["messages"] else ""
    frame_b64  = (state.get("video_frames_base64") or [None])[-1]

    if MOCK_MODE or not frame_b64:
        parsed = {"hazard_type": "Flooding", "severity_scale": 7, "water_depth_m": 0.2, "structural_risk": False, "location_cues": "street level"}
    else:
        llm = _make_llm(VISION_MODEL)
        content = [
            {"type": "text", "text": f"Emergency: {transcript}. Analyse this frame:"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
        ]
        resp = llm.invoke([SystemMessage(content=VISION_SYSTEM), HumanMessage(content=content)])
        parsed = _safe_json(resp.content, {"hazard_type": "Unknown", "severity_scale": 5,
                                            "water_depth_m": None, "structural_risk": False, "location_cues": ""})

    return {"vision_analysis": parsed, "next_step": "localizer"}


# ── Node 3: Localizer (GIS — no LLM) ─────────────────────────────────────────

def localizer_node(state: AgentState) -> dict:
    gps = state.get("gps_coordinates") or {}
    lat = float(gps.get("lat", 43.6532))
    lng = float(gps.get("lng", -79.3832))

    hydrants      = get_closest_hydrants(lat, lng, n=3)
    building      = get_building_specs(lat, lng)
    ward_score    = get_ward_risk_score(lat, lng)
    prior_311     = get_prior_311_calls(lat, lng, radius_m=200)
    in_flood_zone = check_flood_zone(lat, lng)

    hazard    = state.get("vision_analysis", {}).get("hazard_type", "").lower()
    escalated = (
        ward_score > 70 and (
            (in_flood_zone and "flood" in hazard) or
            state.get("urgency_level") == "CRITICAL"
        )
    )

    return {
        "spatial_data_results": {
            "closest_hydrants": hydrants,
            "building_specs":   building,
            "prior_311_calls":  prior_311,
            "in_flood_zone":    in_flood_zone,
        },
        "ward_risk_score": ward_score,
        "escalated":       escalated,
        "next_step":       "compiler",
    }


# ── Node 4: Report Compiler ───────────────────────────────────────────────────

COMPILER_SYSTEM = """You are Toronto Emergency Command AI running on the ASUS GX10 (NVIDIA GB10 Grace Blackwell).
Generate a concise, priority-coded dispatch protocol. Be precise and actionable.
Structure your response with these exact sections:
## THREAT CLASSIFICATION
## PERIMETER & ACCESS
## INFRASTRUCTURE ASSETS
## BUILDING INTELLIGENCE
## CREW DISPATCH
## RISK UPDATE"""


def compiler_node(state: AgentState) -> dict:
    spatial   = state.get("spatial_data_results") or {}
    vision    = state.get("vision_analysis") or {}
    urgency   = state.get("urgency_level", "HIGH")
    score     = state.get("ward_risk_score", 0.0)
    new_score = min(score + (20 if state.get("escalated") else 0), 100)
    transcript = state["messages"][-1].content if state["messages"] else ""

    prediction_line = (
        f"\n⚠ PREDICTION CONFIRMED — Ward was pre-flagged at {score:.0f}/100. "
        f"Citizen report confirms risk. Score elevated to {new_score:.0f}/100."
        if state.get("escalated") else ""
    )

    prompt = f"""URGENCY: {urgency}
CITIZEN REPORT: {transcript}
VISION ANALYSIS: {json.dumps(vision)}
CLOSEST HYDRANTS: {json.dumps(spatial.get('closest_hydrants', []))}
BUILDING SPECS: {json.dumps(spatial.get('building_specs', {}))}
PRIOR 311 CALLS (200m radius): {spatial.get('prior_311_calls', 0)}
IN FLOOD STUDY AREA: {spatial.get('in_flood_zone', False)}
WARD RISK SCORE: {score:.0f}/100 → updated to {new_score:.0f}/100
{prediction_line}

Generate the full dispatch protocol now."""

    if MOCK_MODE:
        report = f"""## THREAT CLASSIFICATION
{urgency} priority incident. {vision.get('hazard_type', 'Emergency')} reported. Severity {vision.get('severity_scale', 5)}/10.

## PERIMETER & ACCESS
Recommend {100 if urgency == 'CRITICAL' else 50}m perimeter. Use nearest arterial road for crew access.

## INFRASTRUCTURE ASSETS
{len(spatial.get('closest_hydrants', []))} hydrant(s) within range. Nearest at {spatial.get('closest_hydrants', [{}])[0].get('distance_meters', '?')}m.

## BUILDING INTELLIGENCE
{f"Building compliance score: {spatial.get('building_specs', {}).get('compliance_score', 'N/A')}/100." if spatial.get('building_specs') else "No building data available."}

## CREW DISPATCH
Dispatch 1 pumper unit. {prior_311} prior 311 call(s) at this location.

## RISK UPDATE
Ward risk score: {score:.0f} → {new_score:.0f}/100. {"PREDICTION CONFIRMED." if state.get("escalated") else ""}"""
    else:
        llm  = _make_llm(COMPILER_MODEL)
        resp = llm.invoke([SystemMessage(content=COMPILER_SYSTEM), HumanMessage(content=prompt)])
        report = resp.content

    return {
        "final_dispatch_report": report,
        "ward_risk_score":       new_score,
        "next_step":             "end",
    }


# fix the reference in mock mode
def compiler_node(state: AgentState) -> dict:  # noqa: F811
    spatial    = state.get("spatial_data_results") or {}
    vision     = state.get("vision_analysis") or {}
    urgency    = state.get("urgency_level", "HIGH")
    score      = state.get("ward_risk_score", 0.0)
    new_score  = min(score + (20 if state.get("escalated") else 0), 100)
    transcript = state["messages"][-1].content if state["messages"] else ""
    prior_311  = spatial.get("prior_311_calls", 0)

    prediction_line = (
        f"\n⚠ PREDICTION CONFIRMED — Ward was pre-flagged at {score:.0f}/100. "
        f"Citizen report confirms risk. Score elevated to {new_score:.0f}/100."
        if state.get("escalated") else ""
    )

    if MOCK_MODE:
        hydrants = spatial.get("closest_hydrants", [])
        hydrant_str = f"Nearest at {hydrants[0].get('distance_meters', '?')}m" if hydrants else "No hydrants found"
        bldg = spatial.get("building_specs", {})
        report = (
            f"## THREAT CLASSIFICATION\n"
            f"{urgency} priority. {vision.get('hazard_type', 'Emergency')} — severity {vision.get('severity_scale', 5)}/10.\n\n"
            f"## PERIMETER & ACCESS\n"
            f"Recommended perimeter: {150 if urgency == 'CRITICAL' else 75}m radius.\n\n"
            f"## INFRASTRUCTURE ASSETS\n"
            f"{len(hydrants)} hydrant(s) identified. {hydrant_str}.\n\n"
            f"## BUILDING INTELLIGENCE\n"
            f"{f'Compliance score: {bldg.get(chr(99)+chr(111)+chr(109)+chr(112)+chr(108)+chr(105)+chr(97)+chr(110)+chr(99)+chr(101)+chr(95)+chr(115)+chr(99)+chr(111)+chr(114)+chr(101), chr(78)+chr(47)+chr(65))}/100. Floors: {bldg.get(chr(102)+chr(108)+chr(111)+chr(111)+chr(114)+chr(115), 0)}.' if bldg else 'No building data.'}\n\n"
            f"## CREW DISPATCH\n"
            f"Dispatch 1 pumper + 1 rescue unit. {prior_311} prior 311 call(s) nearby.\n\n"
            f"## RISK UPDATE\n"
            f"Ward score: {score:.0f} → {new_score:.0f}/100.{prediction_line}"
        )
    else:
        prompt = (
            f"URGENCY: {urgency}\nCITIZEN REPORT: {transcript}\n"
            f"VISION: {json.dumps(vision)}\n"
            f"HYDRANTS: {json.dumps(spatial.get('closest_hydrants', []))}\n"
            f"BUILDING: {json.dumps(spatial.get('building_specs', {}))}\n"
            f"PRIOR 311 CALLS: {prior_311}\nIN FLOOD ZONE: {spatial.get('in_flood_zone', False)}\n"
            f"WARD RISK SCORE: {score:.0f} → {new_score:.0f}/100\n{prediction_line}\n\n"
            "Generate the full dispatch protocol now."
        )
        llm    = _make_llm(COMPILER_MODEL)
        resp   = llm.invoke([SystemMessage(content=COMPILER_SYSTEM), HumanMessage(content=prompt)])
        report = resp.content

    return {"final_dispatch_report": report, "ward_risk_score": new_score, "next_step": "end"}


# ── Routing ───────────────────────────────────────────────────────────────────

def _route(state: AgentState) -> Literal["vision", "localizer", "compiler", "__end__"]:
    return {"vision": "vision", "localizer": "localizer",
            "compiler": "compiler", "end": "__end__"}.get(
        state.get("next_step", ""), "__end__")


# ── Build graph ───────────────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(AgentState)
    g.add_node("orchestrator", orchestrator_node)
    g.add_node("vision",       vision_node)
    g.add_node("localizer",    localizer_node)
    g.add_node("compiler",     compiler_node)
    g.set_entry_point("orchestrator")
    g.add_conditional_edges("orchestrator", _route)
    g.add_conditional_edges("vision",       _route)
    g.add_conditional_edges("localizer",    _route)
    g.add_conditional_edges("compiler",     _route)
    return g.compile()


delation_engine = build_graph()
