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

def call_workflow(user_request: str, pieces_list: str):
    state = workflow.invoke(
    {"user_request": HumanMessage(content=user_request),
     "pieces_list": pieces_list}
    )
    return state["final_script"]

# Agent functions
def architect_agent(state: State):
    msg = ''
    if state.get("feedback"):
        msg = llm.invoke(f"You are a structural analysis agent who architects lego builds. Rework the build plan by taking into account the feedback. Listen to the feedback and add the feedback. Build plan : \"{state['build_plan']}\". | Feedback: \"{state['feedback']}\".")
    else:
        msg = llm.invoke(f"You are a structural analysis agent who architects lego builds. Given the user request, provide a list of necessary structures for this build (e.g. a house build may need walls, a chimney, etc. depending on the pieces the user has). Carefully consider the number of pieces available. Return the list with the structures as a comma-separated string and after each structure, include in parentheses the exact number of pieces and which pieces are needed for that structure and a concise description of how the pieces should be connected (e.g. 4 black bricks on top of eachother and 3 red bricks on top of that) and MAKE SURE you include how structures should be built relative to each other. For example, the walls should be on the edge of the foundation but still connected, etc. Ensure the total number of pieces does not exceed the available pieces. User request: \"{state['user_request'].content}\" | pieces available: {state['pieces_list']}.")
    
    print(msg.content)
    print("----------------------------")
    return {"build_plan": msg.content}

def evaluator_agent(state: State):
    grade = evaluator.invoke(f"You are a lego build evaluator. Given the user request: \"{state['user_request'].content}\", and the build plan: \"{state['build_plan']}\", ensure the quality of the build plan. First, verify that the build plan addresses the user request adequately and gives instructions on how to connect the pieces. There MUST be instructions on where structures are relative to eachother and on how to build each structure in the parentheses, otherwise FAIL THE BUILD PLAN. Next, check that the build plan is feasible given the pieces available: {state['pieces_list']} and that it uses exactly the given pieces or less. Finally, check if the build plan physically makes sense. That is, can all the pieces connect to eachother and can each structure connect to eachother without falling apart? This is the most important part. Make sure pieces do not intersect or take up the same physical space, and make sure the build plan actually encompasses the user request. Evaluate the build plan in this way.")
    print(grade.feedback)
    print("----------------------------")
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
    # Step 2: Incremental OpenSCAD build
    # ==============================
    openscad_parts: list[str] = []

    # Compact summary state sent to the LLM (NOT full code)
    built_structures: list[str] = []

    for i, step in enumerate(build_steps):
        # Extract a concise structure identifier (before colon)
        structure_name = step.split(":", 1)[0].strip()

        structure_summary = (
            "\n".join(f"- {s}" for s in built_structures)
            if built_structures
            else "- none"
        )

        step_prompt = f"""
You are a LEGO OpenSCAD builder.

Already built structures:
{structure_summary}

Now add this structure:
{step}

Rules:
- Use ONLY the LEGO brick template below
- Ensure all pieces connect physically
- Ensure NO overlaps or intersections
- Position relative to existing structures

Return ONLY the OpenSCAD code for THIS structure.

LEGO brick template:
// 2x2 brick
module lego_brick(x_studs, y_studs){{
   brick_x = x_studs * 8; brick_y = y_studs * 8;
   difference(){{
      cube([brick_x, brick_y, 9.6]);
      translate([1.6, 1.6, 1.6])
         cube([brick_x-3.2, brick_y-3.2, 9.6]);
   }}
   for (x=[0:x_studs-1])
      for (y=[0:y_studs-1])
         translate([x*8+4, y*8+4, 9.6])
            cylinder(h=1.8, d=4.8, $fn=40);
}}
"""
        step_code_msg = llm_reasoning.invoke(step_prompt)
        step_code = step_code_msg.text.strip()

        # Append results
        openscad_parts.append(step_code)
        built_structures.append(structure_name)

        # Optional debug output
        print(f"Added: {structure_name}")
        print("----------------------------")

    # ==============================
    # Step 3: Final script
    # ==============================
    return {"final_script": "\n\n".join(openscad_parts)}

# Conditional edge function
def route_evaluator(state: State):
    if state["grade"] == "pass":
        return "Accepted"
    elif state["grade"] == "fail":
        return "Rejected + Feedback"
    

load_dotenv()
llm = ChatGroq(model="meta-llama/llama-4-maverick-17b-128e-instruct")
llm_reasoning = ChatGroq(model="llama-3.3-70b-versatile")
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