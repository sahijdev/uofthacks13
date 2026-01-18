from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain.messages import HumanMessage, AIMessage, AnyMessage
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import Literal
import os
import backboard
from fastapi.responses import StreamingResponse
import json


# Graph state
class State(TypedDict):
    user_request: AnyMessage
    pieces_list: str
    build_plan: str
    feedback: str
    grade: str
    final_script: str

# Schema for structured output to use in evaluation
class Feedback(BaseModel):
    grade: Literal["pass", "fail"] = Field(
        description="Decide if the build plan is adequate.",
    )
    feedback: str = Field(
        description="If the build plan is not adequate, provide feedback on how to improve it.",
    )

def stream_workflow(user_request: str, pieces_list: str):
    """
    Generator that yields SSE events with JSON messages
    for each step of the workflow: architect, evaluator, builder.
    """
    state: State = {
        "user_request": HumanMessage(content=user_request),
        "pieces_list": pieces_list,
        "build_plan": "",
        "feedback": "",
        "grade": "",
        "final_script": "",
    }

    # 1️⃣ Architect step
    msg = architect_agent(state)
    state["build_plan"] = msg["build_plan"]
    yield f"data: {json.dumps({'step': 'architect', 'message': state['build_plan'][:200] + '...'})}\n\n"

    # 2️⃣ Evaluator step
    eval_result = evaluator_agent(state)
    state.update(eval_result)
    yield f"data: {json.dumps({'step': 'evaluator', 'message': state['feedback'][:200] + '...'})}\n\n"

    # Loop back if evaluation fails
    if state["grade"] == "fail":
        yield f"data: {json.dumps({'step': 'architect', 'message': 'correcting architecture based on evaluator feedback' + '...'})}\n\n"

    # 3️⃣ Builder step
    yield from builder_agent(state)

    yield f"data: {json.dumps({'step': 'finalizing', 'message': 'Build workflow complete!', 'final_script': state['final_script']})}\n\n"



# Agent functions
def architect_agent(state: State):
    msg = ''
    if state.get("feedback"):
        msg = llm.invoke(f"You are a structural analysis agent who architects lego builds. Rework the build plan by taking into account the feedback. Listen to the feedback and add the feedback. Build plan : \"{state['build_plan']}\". | Feedback: \"{state['feedback']}\".")
    else:
        msg = llm.invoke(f"You are a structural analysis agent who architects lego builds. Given the user request, provide a list of necessary structures for this build (e.g. a house build may need walls, a chimney, etc. depending on the pieces the user has). Carefully consider the number of pieces available. Return the list with the structures as a comma-separated string and after each structure, include in parentheses the exact number of pieces and which pieces are needed for that structure and a concise description of how the pieces should be connected (e.g. 4 black bricks on top of eachother and 3 red bricks on top of that) and MAKE SURE you include how structures should be built relative to each other. For example, the walls should be on the edge of the foundation but still connected, etc. Ensure the total number of pieces does not exceed the available pieces. User request: \"{state['user_request'].content}\" | pieces available: {state['pieces_list']}.")
    
    return {"build_plan": msg.content}

def evaluator_agent(state: State):
    grade = evaluator.invoke(f"You are a lego build evaluator. Given the user request: \"{state['user_request'].content}\", and the build plan: \"{state['build_plan']}\", ensure the quality of the build plan. First, verify that the build plan addresses the user request adequately and gives instructions on how to connect the pieces. There MUST be instructions on where structures are relative to eachother and on how to build each structure in the parentheses, otherwise FAIL THE BUILD PLAN. Next, check that the build plan is feasible given the pieces available: {state['pieces_list']} and that it uses exactly the given pieces or less. Finally, check if the build plan physically makes sense. That is, can all the pieces connect to eachother and can each structure connect to eachother without falling apart? This is the most important part. Make sure pieces do not intersect or take up the same physical space, and make sure the build plan actually encompasses the user request. Evaluate the build plan in this way.")
    return {"grade": grade.grade, "feedback": grade.feedback}

def builder_agent(state: State):
    # ==============================
    # Step 1: Normalize build plan
    # ==============================
    normalize_prompt = f"""
You are an assistant that converts a freeform LEGO build plan into a numbered list of discrete structures.

Each step MUST include:
- Structure name
- Pieces needed
- How it connects to previous structures

Original build plan:
{state['build_plan']}

Return ONLY the list in this format:
1. Structure name (pieces: ...): instructions...
2. Structure name (pieces: ...): instructions...
"""
    normalized_list_msg = llm.invoke(normalize_prompt)

    build_steps = [
        step.strip()
        for step in normalized_list_msg.content.split("\n")
        if step.strip()
    ]

    # ==============================
    # Step 2: Incremental Brick DSL generation
    # ==============================
    dsl_lines: list[str] = []

    # Compact state for the LLM (NOT full code)
    placed_summary: list[str] = []

    for step in build_steps:
        structure_name = step.split(":", 1)[0].strip()

        existing = (
            "\n".join(f"- {s}" for s in placed_summary)
            if placed_summary
            else "- none"
        )

        step_prompt = f"""
You are a LEGO build compiler.

Your output MUST be written in the following BRICK DSL.
DO NOT output OpenSCAD.
DO NOT explain anything.
ONLY output valid DSL lines.

============================================================
BRICK DSL FORMAT (REQUIRED):

brick("2x2", xStud=0, yStud=0, zLevel=0, rot=[270,0,0], color=[0.9,0.1,0.1]);
brick("2x2", xMm=12.3, yMm=7.0, zMm=19.2, rot=[270,0,0], color=[1,1,0]);

Supported fields:
- kind: first argument (e.g. "2x2")
- position: either (xStud, yStud, zLevel) OR (xMm, yMm, zMm)
- rotation: rot=[270,0,0] ALWAYS
- color: color=[r,g,b] (0..1)
============================================================

Already placed structures:
{existing}

Now add this structure:
{step}

Rules:
- All bricks must connect physically to existing ones
- No overlaps or intersections
- Positions must be consistent with previous placements
- Prefer stud-based placement (xStud/yStud/zLevel) unless rotation requires mm
- Use reasonable LEGO colors

Return ONLY Brick DSL lines for THIS structure.
"""
        step_msg = llm_reasoning.invoke(step_prompt)
        step_dsl = step_msg.text.strip()

        if step_dsl:
            dsl_lines.append(step_dsl)
            placed_summary.append(structure_name)

        yield f"data: {json.dumps({'step': 'builder', 'message': step_dsl[:200]+'...'})}\n\n"

    # ==============================
    # Step 3: Final DSL script
    # ==============================
    final_script = "\n".join(dsl_lines)
    state["final_script"] = final_script
    yield f"data: {json.dumps({'step': 'builder', 'message': 'Final script completed!'})}\n\n"


# Conditional edge function
def route_evaluator(state: State):
    if state["grade"] == "pass":
        return "Accepted"
    elif state["grade"] == "fail":
        return "Rejected + Feedback"
    

load_dotenv()
llm = ChatGroq(model="meta-llama/llama-4-maverick-17b-128e-instruct")
llm_reasoning = ChatGoogleGenerativeAI(model="gemini-2.5-flash-lite")
evaluator = llm.with_structured_output(Feedback)

state_graph = StateGraph(State)
state_graph.add_node("architect_agent", architect_agent)
state_graph.add_node("evaluator_agent", evaluator_agent)
state_graph.add_node("builder_agent", builder_agent)    

state_graph.add_edge(START, "architect_agent")
state_graph.add_edge("architect_agent", "evaluator_agent")
state_graph.add_conditional_edges(
    "evaluator_agent",
    route_evaluator,
    {  
        "Accepted": "builder_agent",
        "Rejected + Feedback": "architect_agent",
    },
)
state_graph.add_edge("builder_agent", END)

workflow = state_graph.compile()
