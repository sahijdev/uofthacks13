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
import time


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
    
    time.sleep(1)

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
        msg = llm.invoke(f"You are a structural analysis agent who architects lego builds. Given the user request, provide a list of necessary structures for this build (e.g. a house build may need walls, a chimney, etc. depending on the pieces the user has). Carefully consider the number of pieces available but use most pieces. Return the list with the structures as a comma-separated string and after each structure, include in parentheses the exact number of pieces and which pieces are needed for that structure and a concise description of how the pieces should be connected (e.g. 4 black bricks on top of eachother and 3 red bricks on top of that) and MAKE SURE you include how structures should be built relative to each other. For example, the walls should be on the edge of the foundation but still connected, etc. Ensure the total number of pieces does not exceed the available pieces. User request: \"{state['user_request'].content}\" | pieces available: {state['pieces_list']}.")
    return {"build_plan": msg.content}

def evaluator_agent(state: State):
    grade = evaluator.invoke(f"You are a lego build evaluator. Given the user request: \"{state['user_request'].content}\", and the build plan: \"{state['build_plan']}\", ensure the quality of the build plan. First, verify that the build plan addresses the user request adequately and gives instructions on how to connect the pieces. There MUST be instructions on where structures are relative to eachother and on how to build each structure in the parentheses, otherwise FAIL THE BUILD PLAN. Next, check that the build plan is feasible given the pieces available: {state['pieces_list']} and that it uses exactly the given pieces or less. Finally, check if the build plan physically makes sense. That is, can all the pieces connect to eachother and can each structure connect to eachother without falling apart? This is the most important part. Make sure pieces do not intersect or take up the same physical space, and make sure the build plan actually encompasses the user request. Evaluate the build plan in this way.")
    return {"grade": grade.grade, "feedback": grade.feedback}

def builder_agent(state: State):
    # ==============================
    # Step 2: One-shot OpenSCAD build
    # ==============================
    one_shot_scad_prompt = f"""
You are a LEGO OpenSCAD builder.

Your task is to generate the complete OpenSCAD code for the following build steps.
Use the LEGO brick template provided, and make sure:
- All bricks connect physically
- No overlaps or intersections
- Use studs as coordinates (1 stud = 8mm)
- Height layers = 9.6mm per brick
- Use all pieces listed
- Return ONLY OpenSCAD code, no explanations

Here's the build plan: {state['build_plan']}
""" + """

LEGO brick template:
// x_studs by y_studs brick, height = 9.6mm, stud diameter = 4.8mm
module lego_brick(x_studs, y_studs){
    brick_x = x_studs * 8;
    brick_y = y_studs * 8;
    difference(){
        cube([brick_x, brick_y, 9.6]);
        translate([1.6, 1.6, 1.6])
            cube([brick_x-3.2, brick_y-3.2, 9.6]);
    }
    for (x=[0:x_studs-1])
        for (y=[0:y_studs-1])
            translate([x*8+4, y*8+4, 9.6])
                cylinder(h=1.8, d=4.8, $fn=40);
}
"""
    yield f"data: {json.dumps({'step': 'builder', 'message': 'Generating full OpenSCAD script...'})}\n\n"
    full_scad_msg = llm_reasoning.invoke(one_shot_scad_prompt)
    full_scad_script = full_scad_msg.text.strip()

    # ==============================
    # Step 3: Translate to Brick DSL
    # ==============================
    one_shot_prompt = f"""
Take this OpenSCAD script and output a complete, valid BRICK DSL script.
Translate each brick and each brick position EXACTLY how they are in the OpenSCAD script.

This is all the dimensions of the lego pieces: this is the dimesions of all the lego pieces, Dimensions of all supported kinds I’ll list (nx×ny studs) → footprint X×Z in mm → height. I’ll give nominal and with your default wall_gap=0.02. Bricks (height = 9.6 mm, studs = yes) 1x1 → 8×8 → h 9.6 (7.98×7.98 with gap) 1x2 → 8×16 → h 9.6 (7.98×15.98) 1x3 → 8×24 → h 9.6 (7.98×23.98) 1x4 → 8×32 → h 9.6 (7.98×31.98) 1x5 → 8×40 → h 9.6 (7.98×39.98) 1x6 → 8×48 → h 9.6 (7.98×47.98) 1x8 → 8×64 → h 9.6 (7.98×63.98) 1x10 → 8×80 → h 9.6 (7.98×79.98) 1x12 → 8×96 → h 9.6 (7.98×95.98) 2x2 → 16×16 → h 9.6 (15.98×15.98) 2x3 → 16×24 → h 9.6 (15.98×23.98) 2x4 → 16×32 → h 9.6 (15.98×31.98) 2x6 → 16×48 → h 9.6 (15.98×47.98) 2x8 → 16×64 → h 9.6 (15.98×63.98) 2x10 → 16×80 → h 9.6 (15.98×79.98) 2x12 → 16×96 → h 9.6 (15.98×95.98) 3x3 → 24×24 → h 9.6 (23.98×23.98) 3x4 → 24×32 → h 9.6 (23.98×31.98) 3x6 → 24×48 → h 9.6 (23.98×47.98) 4x4 → 32×32 → h 9.6 (31.98×31.98) 4x6 → 32×48 → h 9.6 (31.98×47.98) 4x8 → 32×64 → h 9.6 (31.98×63.98) Plates (height = 3.2 mm, studs = yes) plate_1x1 → 8×8 → h 3.2 (7.98×7.98) plate_1x2 → 8×16 → h 3.2 (7.98×15.98) plate_1x3 → 8×24 → h 3.2 (7.98×23.98) plate_1x4 → 8×32 → h 3.2 (7.98×31.98) plate_1x6 → 8×48 → h 3.2 (7.98×47.98) plate_1x8 → 8×64 → h 3.2 (7.98×63.98) plate_2x2 → 16×16 → h 3.2 (15.98×15.98) plate_2x3 → 16×24 → h 3.2 (15.98×23.98) plate_2x4 → 16×32 → h 3.2 (15.98×31.98) plate_2x6 → 16×48 → h 3.2 (15.98×47.98) plate_2x8 → 16×64 → h 3.2 (15.98×63.98) plate_2x10 → 16×80 → h 3.2 (15.98×79.98) plate_3x3 → 24×24 → h 3.2 (23.98×23.98) plate_4x4 → 32×32 → h 3.2 (31.98×31.98) Tiles (height = 3.2 mm, studs = no) Same footprints as plates, but no studs: tile_1x1 → 8×8 → h 3.2 (7.98×7.98) tile_1x2 → 8×16 → h 3.2 (7.98×15.98) tile_1x3 → 8×24 → h 3.2 (7.98×23.98) tile_1x4 → 8×32 → h 3.2 (7.98×31.98) 

You are a LEGO STRUCTURE DSL GENERATOR for the following renderer.

ABSOLUTE COORDINATE SYSTEM (do not reinterpret):
- Three.js convention: X/Z is the floor plane, Y is vertical.
- Each brick’s position is the MIN-CORNER of its footprint (not center).
- xMm and zMm specify the footprint’s lower-left corner on the X/Z grid.
- yMm specifies the bottom height level.
- rot is [a,b,c] in DEGREES. It rotates around the X, then Y, then Z axis (intrinsic XYZ order) about the MIN-CORNER pivot.
- Do NOT use any other rotation field (no rotY, no quaternion, no radians).

OPENSCAD → THREE.JS AXIS FIX (CRITICAL, HARD):
- Geometry is generated in OpenSCAD (Z-up), then imported to Three.js (Y-up) with a fixed conversion:
  geo.rotateX(-90 degrees).
- Therefore: ALL coordinates (xMm,yMm,zMm) and ALL rotations rot=[a,b,c] in the DSL are specified in the FINAL Three.js coordinate system AFTER that conversion.
- You must NOT “compensate” for the OpenSCAD coordinate system. Do NOT swap axes. Do NOT rotate parts by ±90° to “fix” up-axis.
- Consequence: To place pieces upright on the ground plane, the default orientation is rot=[0,0,0] (upright brick/plate/tile).
- You must NEVER use rot=[90,0,0] or rot=[270,0,0] for standard upright bricks/plates/tiles/torso/legs/arms unless the user explicitly asks for a sideways/lying piece.
- When in doubt, set rot=[0,0,0] for all parts except when you intentionally want to swap footprint X/Z, in which case only change rot[1] (Y rotation) to 90 or 270.
- Allowed “normal build” rotations:
  - Upright pieces: rot must be exactly one of [0,0,0], [0,90,0], [0,180,0], [0,270,0].
  - rot[0] and rot[2] MUST stay 0 for normal LEGO builds unless explicitly requested.


GRID + SNAP (HARD):
- STUD_PITCH = 8.0 mm
- PLATE_H = 3.2 mm
- BRICK_H = 9.6 mm
- Every xMm and zMm MUST be an integer multiple of 8.0 exactly. NO decimals. Example: 0, 8, 16, 24, ...
- Every yMm MUST be an integer multiple of 3.2 exactly. Allowed set: 3.2*k for integer k >= 0. Example: 0, 3.2, 6.4, 9.6, ...
- rot must be [a,b,c] where each of a,b,c is exactly one of 0, 90, 180, 270. No other angles.

ALLOWED PIECES ONLY (HARD):
Use ONLY these kinds (exact spelling):
1x1,1x2,1x3,1x4,1x5,1x6,1x8,1x10,1x12,
2x2,2x3,2x4,2x6,2x8,2x10,2x12,
3x3,3x4,3x6,
4x4,4x6,4x8,
plate_1x1,plate_1x2,plate_1x3,plate_1x4,plate_1x6,plate_1x8,
plate_2x2,plate_2x3,plate_2x4,plate_2x6,plate_2x8,plate_2x10,
plate_3x3,plate_4x4,
tile_1x1,tile_1x2,tile_1x3,tile_1x4,tile_1x6,
tile_2x2,tile_2x3,tile_2x4,tile_2x6,
slope_45_1x2,slope_45_2x2,slope_45_2x3,slope_45_2x4,slope_45_3x2,slope_45_3x3

This means <kind> should only be brick dimensions and not include brick colour or any other details.

FOOTPRINT RULES (HARD):
- A piece kind "AxB" has unrotated footprint:
  sizeX = 8*A mm, sizeZ = 8*B mm.
- rot affects footprint ONLY through Y-rotation (b = rot[1]):
  If b is 0 or 180: footprint size is (8*A) by (8*B).
  If b is 90 or 270: footprint size is (8*B) by (8*A).
- xMm,zMm MUST remain the MIN-CORNER AFTER applying rot[1]. Never center, never add half-stud offsets.
- rot[0] (X rotation) and rot[2] (Z rotation) are allowed but MUST NOT cause any non-grid translation. The pivot is always the MIN-CORNER.
ROTATION INTERPRETATION (HARD):
- rot=[a,b,c] means rotate around X by a, then around Y by b, then around Z by c, about the MIN-CORNER pivot, in the FINAL Three.js coordinate system.
- For footprint math and support checks, ONLY b=rot[1] matters (Y rotation). a and c MUST be 0 for “normal builds”.

STACKING / SUPPORT (HARD):
- No floating pieces.
- For any piece with yMm > 0:
  It must be supported by pieces whose TOP surface is exactly at yMm.
  Support means: the overlap area (in X/Z projection) between the piece footprint and the union of supporting footprints is at least 50% of the piece footprint area.
- Plates/tiles/bricks/slopes all count as support like any other piece.
- Pieces that are rotated in X or Z (rot[0] or rot[2] nonzero) still must satisfy the same support rule using their footprint computed from rot[1].

OUTPUT FORMAT (HARD):
- Output ONLY lines in this exact form:
  brick("<kind>", xMm=<number>, yMm=<number>, zMm=<number>, rot=[a,b,c], color=[r,g,b]);
- NO comments. NO blank lines. NO JSON. NO explanations.
- xMm and zMm must be integers (no decimal point).
- yMm must be printed with exactly one decimal place when needed (e.g., 3.2, 6.4, 9.6) or as 0.
- a,b,c must be integers in 0,90,180,270.
- r,g,b are decimals in [0,1] with at most 2 decimal places.

SELF-CHECK (MANDATORY):
Before outputting, verify every line satisfies ALL HARD constraints:
- kind in allowed list
- xMm,zMm are integers and multiples of 8
- yMm is exactly 3.2*k
- rot=[a,b,c] with a,b,c in 0,90,180,270
- support rule satisfied
If ANY constraint would be violated, discard the entire output and regenerate until perfect.


Here is the OpenSCAD script to translate:
{full_scad_script}

Return ONLY the complete Brick DSL script for the entire build.
"""
    yield f"data: {json.dumps({'step': 'builder', 'message': 'Translating OpenSCAD to Brick DSL...'})}\n\n"
    translated_script = llm_reasoning.invoke(one_shot_prompt)
    state["final_script"] = translated_script.content
    yield f"data: {json.dumps({'step': 'builder', 'message': 'Final script completed!'})}\n\n"


# Conditional edge function
def route_evaluator(state: State):
    if state["grade"] == "pass":
        return "Accepted"
    elif state["grade"] == "fail":
        return "Rejected + Feedback"
    

load_dotenv()
llm = ChatGroq(model="meta-llama/llama-4-scout-17b-16e-instruct")
llm_reasoning = ChatGoogleGenerativeAI(model="gemini-3-flash-preview")
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
