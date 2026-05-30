"""
CivicVox-Omni LangGraph state machine.
Four nodes: Orchestrator → Vision (optional) → Localizer → Compiler → END
All LLM calls target a local OpenAI-compatible inference server (NVIDIA NIM / vLLM / Ollama).
"""
import json
import logging
import os
import re
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from backend.data.toronto_loader import get_building_specs, get_closest_hydrants

logger = logging.getLogger(__name__)

LOCAL_LLM_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:8000/v1")
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "meta/llama-3.2-11b-vision-instruct")

llm = ChatOpenAI(
    base_url=LOCAL_LLM_URL,
    api_key="not-needed",
    model=LOCAL_LLM_MODEL,
    temperature=0,
    max_retries=2,
)


class AgentState(TypedDict):
    messages: list[BaseMessage]
    video_frames_base64: list[str]
    gps_coordinates: dict
    vision_analysis: dict
    spatial_data_results: dict
    next_step: str
    urgency_level: str
    final_dispatch_report: str


def _strip_json_fences(raw: str) -> str:
    """Strip ```json ... ``` markdown fences that open-weight models frequently emit."""
    return re.sub(r"```[\w]*\n?|```", "", raw).strip()


def _safe_json(raw: str, fallback: dict) -> dict:
    try:
        return json.loads(_strip_json_fences(raw))
    except (json.JSONDecodeError, ValueError):
        logger.warning("JSON parse failed on: %r", raw[:200])
        return fallback


# ── Node 1: Orchestrator ──────────────────────────────────────────────────────

ORCHESTRATOR_SYSTEM = """You are an emergency triage orchestrator for the City of Toronto.
Analyse the citizen report and decide routing.
Output ONLY valid JSON — no explanation, no markdown:
{ "requires_vision": bool, "urgency_level": "LOW" | "HIGH" | "CRITICAL" }"""


def orchestrator_node(state: AgentState) -> dict:
    transcript = state["messages"][-1].content if state["messages"] else "No report provided"

    response = llm.invoke([
        SystemMessage(content=ORCHESTRATOR_SYSTEM),
        HumanMessage(content=f'Citizen report: "{transcript}"'),
    ])

    parsed = _safe_json(
        response.content,
        {"requires_vision": bool(state.get("video_frames_base64")), "urgency_level": "HIGH"},
    )

    has_frame = bool(state.get("video_frames_base64"))
    next_step = "vision" if (parsed.get("requires_vision") and has_frame) else "localizer"

    return {
        "next_step": next_step,
        "urgency_level": parsed.get("urgency_level", "HIGH"),
    }


# ── Node 2: Vision Agent ──────────────────────────────────────────────────────

VISION_SYSTEM = """You are a computer vision system analysing emergency video frames.
Output ONLY valid JSON — no markdown, no explanation:
{
  "hazard_type": str,
  "severity_scale": int (1-10),
  "water_depth_m": float or null,
  "structural_risk": bool,
  "location_cues": str
}"""


def vision_node(state: AgentState) -> dict:
    transcript = state["messages"][-1].content if state["messages"] else ""
    frame_b64 = (state.get("video_frames_base64") or [None])[-1]

    if frame_b64:
        content = [
            {"type": "text", "text": f"Emergency context: {transcript}. Analyse this frame:"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}},
        ]
    else:
        content = f"No frame available. Context: {transcript}"

    response = llm.invoke([
        SystemMessage(content=VISION_SYSTEM),
        HumanMessage(content=content),
    ])

    parsed = _safe_json(
        response.content,
        {
            "hazard_type": "Unknown",
            "severity_scale": 5,
            "water_depth_m": None,
            "structural_risk": False,
            "location_cues": "",
        },
    )

    return {"vision_analysis": parsed, "next_step": "localizer"}


# ── Node 3: Localizer Agent ───────────────────────────────────────────────────

def localizer_node(state: AgentState) -> dict:
    gps = state.get("gps_coordinates") or {}
    lat = float(gps.get("lat", 43.6532))
    lng = float(gps.get("lng", -79.3832))

    hydrants = get_closest_hydrants(lat, lng, n=3)
    building = get_building_specs(lat, lng)

    return {
        "spatial_data_results": {
            "closest_hydrants": hydrants,
            "building_specs": building,
            "query_location": {"lat": lat, "lng": lng},
        },
        "next_step": "compiler",
    }


# ── Node 4: Report Compiler ───────────────────────────────────────────────────

COMPILER_SYSTEM = """You are Toronto Emergency Command. Generate a concise, priority-coded dispatch protocol.
Structure your response with these sections:
## THREAT CLASSIFICATION
## PERIMETER & ACCESS
## INFRASTRUCTURE ASSETS
## BUILDING INTELLIGENCE
## CREW DISPATCH
Be precise and actionable. Use exact distances where provided."""


def compiler_node(state: AgentState) -> dict:
    transcript = state["messages"][-1].content if state["messages"] else ""
    vision = state.get("vision_analysis") or {}
    spatial = state.get("spatial_data_results") or {}
    urgency = state.get("urgency_level", "HIGH")

    context = (
        f"URGENCY LEVEL: {urgency}\n"
        f"CITIZEN REPORT: {transcript}\n\n"
        f"VISION ANALYSIS:\n{json.dumps(vision, indent=2)}\n\n"
        f"SPATIAL INTELLIGENCE:\n{json.dumps(spatial, indent=2)}"
    )

    response = llm.invoke([
        SystemMessage(content=COMPILER_SYSTEM),
        HumanMessage(content=context),
    ])

    return {
        "final_dispatch_report": response.content,
        "next_step": "END",
    }


# ── Graph Construction ────────────────────────────────────────────────────────

def _route(state: AgentState) -> str:
    return state.get("next_step", "localizer")


def build_graph() -> "CompiledGraph":
    workflow = StateGraph(AgentState)

    workflow.add_node("orchestrator", orchestrator_node)
    workflow.add_node("vision", vision_node)
    workflow.add_node("localizer", localizer_node)
    workflow.add_node("compiler", compiler_node)

    workflow.set_entry_point("orchestrator")

    workflow.add_conditional_edges(
        "orchestrator",
        _route,
        {"vision": "vision", "localizer": "localizer"},
    )
    workflow.add_edge("vision", "localizer")
    workflow.add_edge("localizer", "compiler")
    workflow.add_edge("compiler", END)

    return workflow.compile()


civic_vox_engine = build_graph()
