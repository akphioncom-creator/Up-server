"""
মুখের ভেক্টর (face embedding) সার্ভিস: face_recognition লাইব্রেরি দিয়ে ছবি থেকে ১২৮-সংখ্যার ভেক্টর বানায় ও মেলায়।

চালানো:
    pip install fastapi uvicorn python-multipart face_recognition numpy opencv-python-headless
    export FACE_API_KEY="একটি-লম্বা-গোপন-কী"
    uvicorn face_service:app --host 0.0.0.0 --port 8001

face_recognition (dlib ভিত্তিক) নিজেই মডেল ব্যবহার করে; প্রথমবার চালালে দlib মডেল
(প্রায় ১০০ MB) ডাউনলোড হতে পারে। ভেক্টর ১২৮ সংখ্যার, ইউক্লিডিয়ান দূরত্বে মেলানো হয়।

এন্ডপয়েন্ট (সবগুলোতে হেডার লাগে: X-API-Key):
    POST /face/check      ছবি → { valid, message, ... }
    POST /face/embedding  ছবি → { valid, embedding: [128 সংখ্যা] }
    POST /face/verify     ছবি + embedding (JSON) → { match, distance, threshold }
"""

import io
import json
import os
from typing import List, Optional

import face_recognition
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image

# ---- সেটিং ----
API_KEY = os.environ.get("FACE_API_KEY", "")
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # ৫ MB
MIN_DET_SCORE = 0.0                # face_recognition এ det_score নেই; শুধু বক্সের আকার দেখি
MIN_FACE_SIZE = 80                 # মুখের বক্সের সর্বনিম্ন পিক্সেল (ছোট দিক)
# মেলানোর সীমা (ইউক্লিডিয়ান দূরত্ব): এর কম হলে "একই ব্যক্তি"।
# face_recognition এর ডিফল্ট tolerance ০.৬; পরিচয়ের কাজে ০.৫ নিরাপদ।
MATCH_DISTANCE = float(os.environ.get("FACE_MATCH_DISTANCE", "0.5"))

app = FastAPI(title="Face Vector Service (face_recognition)")


def require_key(x_api_key: str = Header(default="")):
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="ছবি অনেক বড় (সর্বোচ্চ ৫ MB)")
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="ছবি পড়া যায়নি")
    # বড় ছবি ছোট করা (মেমরি ও গতি)
    if max(img.size) > 1280:
        k = 1280 / max(img.size)
        img = img.resize((int(img.width * k), int(img.height * k)))
    return np.array(img)


def analyze(img: np.ndarray) -> dict:
    """ছবিতে ঠিক একটি স্পষ্ট মুখ আছে কিনা দেখে; থাকলে তার ১২৮-সংখ্যার ভেক্টর দেয়।"""
    # face_locations: (top, right, bottom, left)
    locations = face_recognition.face_locations(img, number_of_times_to_upsample=1, model="hog")
    # CPU তে hog দ্রুত; GPU থাকলে model="cnn"

    if len(locations) == 0:
        return {"valid": False, "message": "ছবিতে কোনো মুখ পাওয়া যায়নি, আবার তুলুন।", "faceCount": 0}
    if len(locations) > 1:
        return {"valid": False, "message": "ছবিতে একাধিক মুখ আছে, শুধু একজনের ছবি দিন।", "faceCount": len(locations)}

    top, right, bottom, left = locations[0]
    short_side = min(right - left, bottom - top)
    if short_side < MIN_FACE_SIZE:
        return {"valid": False, "message": "মুখ ছোট দেখাচ্ছে, ক্যামেরার আরেকটু কাছ থেকে তুলুন।", "faceCount": 1}

    # ১২৮-সংখ্যার ভেক্টর
    encodings = face_recognition.face_encodings(img, known_face_locations=[locations[0]], num_jitters=1)
    if not encodings:
        return {"valid": False, "message": "মুখ থেকে ভেক্টর তৈরি করা যায়নি, আবার তুলুন।", "faceCount": 1}

    embedding = encodings[0].astype(np.float32)
    return {
        "valid": True,
        "message": "",
        "faceCount": 1,
        "embedding": embedding.tolist(),
    }


def euclidean_distance(a: List[float], b: List[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    if va.shape != vb.shape or va.size == 0:
        raise ValueError("ভেক্টরের মাপ মেলেনি")
    return float(np.linalg.norm(va - vb))


@app.post("/face/check", dependencies=[Depends(require_key)])
def face_check(image: UploadFile = File(...)):
    result = analyze(decode_image(image.file.read()))
    result.pop("embedding", None)
    return result


@app.post("/face/embedding", dependencies=[Depends(require_key)])
def face_embedding(image: UploadFile = File(...)):
    return analyze(decode_image(image.file.read()))


@app.post("/face/verify", dependencies=[Depends(require_key)])
def face_verify(image: UploadFile = File(...), embedding: str = Form(...)):
    """নতুন ছবি ও সার্ভারে রাখা পুরোনো ভেক্টর (JSON তালিকা) মেলায়।"""
    try:
        stored = json.loads(embedding)
    except Exception:
        raise HTTPException(status_code=400, detail="embedding JSON নয়")

    result = analyze(decode_image(image.file.read()))
    if not result["valid"]:
        return {"match": False, "valid": False, "message": result["message"]}

    try:
        dist = euclidean_distance(result["embedding"], stored)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "match": dist <= MATCH_DISTANCE,
        "valid": True,
        "distance": round(dist, 4),
        "threshold": MATCH_DISTANCE,
    }


@app.get("/health")
def health():
    return {"ok": True}