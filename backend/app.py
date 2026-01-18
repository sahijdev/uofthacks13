from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import cv2
from PIL import Image
import io
import numpy as np
import requests
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pydantic import BaseModel
from agent import stream_workflow


load_dotenv()
client = genai.Client()

DEBUG_SHOW = False  # set True to pop up per-brick crops locally

brick_recognition_url = "https://api.brickognize.com/predict/parts/"

app = FastAPI()
thing = "every piece"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Build(BaseModel):
    title: str
    prompt: str

class SuggestionsRequest(BaseModel):
    prompts: list[str] = []
    inventory: list[str] = []

class PersonaRequest(BaseModel):
    prompts: list[str] = []

# @app.post("/prompt")
# async def save_build(build: Build):
#     script = stream_workflow(build.prompt, test)
#     # print("Started generating")
#     # """response = client.models.generate_  content(
#     #     model="gemini-2.5-flash-lite",
#     #       contents=
#     #   'Take the follow OPEN SCAD script and change each brick into the following form: 1) Your OpenSCAD input should be a BRICK DSL. Example supported lines: brick("2x2", xStud=0, yStud=0, zLevel=0, rotY=0, color [0.9,0.1,0.1]); brick("2x2", xMm=12.3, yMm=7.0, zMm=19.2, rot=[0,90,0], color=[1,1,0]); Supported fields: | kind: "2x2" (first argument) | position: either (xStud,yStud,zLevel) OR (xMm,yMm,zMm) | rotation: rotY=deg OR rot=[rx,ry,rz] | color: color=[r,g,b] (0..1). Only output the final code NOTHING ELSE. Here is the script:' + openscad_script,
#     # )"""
#     # print(openscad_script)
#     return {"status": "ok", "prompt_received": script}

@app.get("/test")
def test():
    return "TEST"

@app.get("/stream_build")
async def stream_build(prompt: str = Query(...)):
    pieces = thing
    return StreamingResponse(stream_workflow(prompt, pieces),
                             media_type="text/event-stream")

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    global thing

    """
    Detect Lego bricks by color masks, merge overlapping detections,
    and optionally show each crop.
    """
    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",

        contents=[
            types.Part.from_bytes(
                data=await file.read(),
                mime_type="image/jpeg",
            ),
            "Give me a list of all the lego pieces and their count in this image without any extra words. Place a bullet point (*) before each item. After the item name, place a colon followed by a space followed by the number of pieces, start off each line with the colour of the block, followed by the brick type, followed by a colon, followed by a space, and finally the number of bricks. and make sure to place a newline after each item. Do not go past 100 different blocks. Each block must be categorized into the following types: 1x1, 1x2, 1x3, 1x4, 1x6, 1x8, 2x2, 2x3, 2x4, 2x6, 2x8, 2x10, 3x3, 4x4, plate_1x2, plate_1x4, plate_2x2, plate_2x4, plate_2x6, tile_1x2, tile_1x4, tile_2x2, tile_2x4, slope_45_2x2, slope_45_2x4",
        ]
    )
    print(response.text)
    thing = response.text

    """
    contents = await file.read()

    # Load image
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    np_image = np.array(image)
    img_h, img_w = np_image.shape[:2]
    img_bgr = cv2.cvtColor(np_image, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # Foreground mask to ignore bright backdrop
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, fg_mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    kernel = np.ones((3, 3), np.uint8)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=2)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    bricks = []

    for color_name, (lower, upper) in COLOR_RANGES.items():
        lower_np = np.array(lower, dtype=np.uint8)
        upper_np = np.array(upper, dtype=np.uint8)
        color_mask = cv2.inRange(hsv, lower_np, upper_np)

        # constrain by foreground
        mask = cv2.bitwise_and(color_mask, fg_mask)
        # clean and slightly connect
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        mask = cv2.dilate(mask, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < MIN_AREA:
                continue
            x, y, w, h = cv2.boundingRect(c)
            x0 = max(0, x - PAD)
            y0 = max(0, y - PAD)
            x1 = min(img_w, x + w + PAD)
            y1 = min(img_h, y + h + PAD)
            w_padded = x1 - x0
            h_padded = y1 - y0
            bricks.append(
                {
                    "color": color_name,
                    "bbox": [int(x0), int(y0), int(w_padded), int(h_padded)],
                    "area": int(area),
                    "centroid": [int(x0 + w_padded / 2), int(y0 + h_padded / 2)],
                }
            )

    # Merge overlapping detections per color
def merge_bricks(bricks_list, iou_threshold=0.2):
        merged = []
        by_color = {}
        for b in bricks_list:
            by_color.setdefault(b["color"], []).append(b)

        for color, items in by_color.items():
            items_sorted = sorted(items, key=lambda b: b["area"], reverse=True)
            keep = []
            for b in items_sorted:
                bx, by, bw, bh = b["bbox"]
                merged_into_existing = False
                for k in keep:
                    kx, ky, kw, kh = k["bbox"]
                    ix1 = max(bx, kx)
                    iy1 = max(by, ky)
                    ix2 = min(bx + bw, kx + kw)
                    iy2 = min(by + bh, ky + kh)
                    if ix2 > ix1 and iy2 > iy1:
                        inter = (ix2 - ix1) * (iy2 - iy1)
                        area_b = bw * bh
                        area_k = kw * kh
                        iou_min = inter / max(1, min(area_b, area_k))
                        if iou_min >= iou_threshold:
                            ux1 = min(bx, kx)
                            uy1 = min(by, ky)
                            ux2 = max(bx + bw, kx + kw)
                            uy2 = max(by + bh, ky + kh)
                            k["bbox"] = [ux1, uy1, ux2 - ux1, uy2 - uy1]
                            k["area"] = max(area_b, area_k)
                            k["centroid"] = [int(k["bbox"][0] + k["bbox"][2] / 2), int(k["bbox"][1] + k["bbox"][3] / 2)]
                            merged_into_existing = True
                            break
                if not merged_into_existing:
                    keep.append(b)
            merged.extend(keep)
        return merged

    bricks = merge_bricks(bricks)

    brick_list = []

    for brick in bricks:
        x, y, w, h = brick["bbox"]
        crop = img_bgr[y : y + h, x : x + w]

        # Encode crop as JPEG for the API
        ok, buf = cv2.imencode(".jpg", crop)
        if not ok:
            continue
        try:
            resp = requests.post(
                brick_recognition_url,
                files={"query_image": ("piece.jpg", buf.tobytes(), "image/jpeg")},
            )
            data = resp.json()
            print(data)
            # brickognize parts API returns a list in "items"
            name = data["items"][0]["name"] if data["items"] else None
            print(name)
            if name:
                brick_list.append(name or "unknown")
        except Exception as e:
            print(f"error recognizing brick: {e}")
        if DEBUG_SHOW:
            cv2.imshow(f"{brick['color']} {brick['area']}", crop)
            cv2.waitKey(0)
    cv2.destroyAllWindows()
    print(brick_list)
    """
    return {"bricks": response.text}

@app.post("/persona")
async def persona(req: PersonaRequest):
    """
    Cluster a user into one of five personas based on past prompts.
    """
    examples = "\n".join(f"- {p}" for p in req.prompts[:20]) or "None provided"
    prompt_text = f"""
You are a LEGO build style classifier. Based ONLY on the user's past prompts, pick exactly one persona key from this list:
- cosmic (space, sci-fi, rockets, futuristic vehicles)
- mech (robots, mechs, machines, battle builds)
- architect (buildings, bridges, monuments, clean structures)
- eco (nature, animals, biomes, cozy organic builds)
- whimsy (playful, characters, fantasy creatures, quirky toys)

User prompts (latest first):
{examples}

Return ONLY the persona key exactly as written: cosmic, mech, architect, eco, or whimsy. No punctuation or extra words.
"""
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=[prompt_text],
        )
        raw = (response.text or "").strip().lower()
        for key in ["cosmic", "mech", "architect", "eco", "whimsy"]:
            if key in raw:
                return {"persona": key}
        raise ValueError(f"unrecognized persona: {raw}")
    except Exception as e:
        print(f"persona error: {e}")
        return {"persona": "whimsy"}

@app.post("/suggestions")
async def suggestions(req: SuggestionsRequest):
    """
    Generate recommended builds based on past prompts and current inventory.
    """
    past_prompts = "\n".join(f"- {p}" for p in req.prompts[:12]) or "None provided"
    pieces = "\n".join(f"- {p}" for p in req.inventory[:12]) or "Not detected yet"

    prompt_text = f"""
You are a playful LEGO concept artist. Propose 3-5 punchy build ideas (max 120 chars each).
- Past prompts (influence style/themes):
{past_prompts}
- Inventory highlights (keep ideas feasible):
{pieces}
Format: bullet points only. Keep them vivid, doable with few pieces, and varied (vehicle, creature, architecture, etc.).
"""
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=[prompt_text],
        )
        raw = response.text or ""
        ideas = [
            line.lstrip("-*• ").strip()
            for line in raw.splitlines()
            if line.strip()
        ]
        ideas = [idea for idea in ideas if idea][:6]
        if not ideas:
            raise ValueError("Empty ideas")
        return {"recommendations": ideas}
    except Exception as e:
        print(f"suggestions error: {e}")
        fallback = [
            "Compact hovercraft with a single highlight color stripe",
            "Palm-sized mech with chunky arms and antenna eyes",
            "Tiny lighthouse on a rock outcrop with a spinning top",
            "Micro cargo rover with detachable trailer",
            "Desk buddy robot holding a flag made from plates",
        ]
        return {"recommendations": fallback}
