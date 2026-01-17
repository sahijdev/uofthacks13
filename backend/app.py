from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
from PIL import Image
import io
import numpy as np

DEBUG_SHOW = True  # set True to pop up per-brick crops locally

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    """
    Detect Lego bricks by color masks, merge overlapping detections,
    and optionally show each crop.
    """
    MIN_AREA = 400  # filter tiny fragments
    PAD = 10  # padding around detected bricks
    COLOR_RANGES = {
        "red": [(0, 150, 120), (8, 255, 240)],
        "dark_green": [(30, 80, 80), (75, 255, 255)],
        "yellow": [(20, 100, 100), (30, 255, 255)],
        "blue": [(90, 100, 100), (140, 255, 255)],
        "orange": [(10, 160, 160), (22, 255, 255)],
        "beige": [(10, 25, 150), (32, 120, 255)],
        "light_blue": [(85, 50, 150), (110, 200, 255)],
        "white": [(0, 0, 180), (180, 40, 255)],
        "black": [(0, 0, 0), (180, 255, 50)],
    }

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

    if DEBUG_SHOW:
        for brick in bricks:
            x, y, w, h = brick["bbox"]
            crop = img_bgr[y : y + h, x : x + w]
            cv2.imshow(f"{brick['color']} {brick['area']}", crop)
            cv2.waitKey(0)
        cv2.destroyAllWindows()

    return {"count": len(bricks), "bricks": bricks}
