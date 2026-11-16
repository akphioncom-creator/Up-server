"""
মুখের ভেক্টর (face embedding) সার্ভিস: ছবি থেকে ৫১২ সংখ্যার ভেক্টর বানায় ও দুটি ভেক্টর মেলায়।

চালানো:
    pip install fastapi uvicorn python-multipart insightface onnxruntime opencv-python-headless numpy
    export FACE_API_KEY="একটি-লম্বা-গোপন-কী"
    uvicorn face_service:app --host 0.0.0.0 --port 8001

প্রথমবার চালালে InsightFace নিজেই buffalo_l মডেল (প্রায় ৩০০ MB) নামিয়ে নেয়।
মডেল ArcFace (r50) এবং মুখ শনাক্তের জন্য RetinaFace/SCRFD ব্যবহার করে; এই সার্ভিস মুখ সোজা (align) করার কাজও নিজে করে।

এন্ডপয়েন্ট (সবগুলোতে হেডার লাগে: X-API-Key):
    POST /face/check      ছবি → { valid, message, ... }          (কিছু সংরক্ষণ করে না; অ্যাপে ছবি তোলার পরের যাচাই)
    POST /face/embedding  ছবি → { valid, embedding: [512 সংখ্যা] } (নিবন্ধনের সময় মূল সার্ভার এটি ডেটাবেসে রাখবে)
    POST /face/verify     ছবি + embedding (JSON) → { match, similarity, threshold }  (পরে মেলানোর সময়)

গুরুত্বপূর্ণ: এই সার্ভিস সরাসরি অ্যাপ থেকে নয়, আপনার মূল সার্ভার (যেখানে ব্যবহারকারীর টোকেন যাচাই হয়) থেকে ডাকুন,
নইলে API কী অ্যাপের ভেতরে ফাঁস হবে।
"""

import json
import os
from typing import List, Optional

import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from insightface.app import FaceAnalysis

# ---- সেটিং (ইচ্ছামতো বদলানো যায়) ----
API_KEY = os.environ.get("FACE_API_KEY", "")
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # সর্বোচ্চ ৫ MB
MIN_DET_SCORE = 0.60               # মুখ শনাক্তের সর্বনিম্ন নিশ্চয়তা (০–১)
MIN_FACE_SIZE = 80                 # মুখের বক্সের সর্বনিম্ন পিক্সেল (ছোট দিক)
# মেলানোর সীমা (cosine similarity): এর বেশি হলে "একই ব্যক্তি"।
# ArcFace এ সাধারণত ০.৩৫–০.৫ এর মধ্যে বাছা হয়। এটা শুরুর মান; নিজেদের বাস্তব ছবি দিয়ে পরীক্ষা করে ঠিক করুন।
MATCH_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.40"))

app = FastAPI(title="Face Vector Service")

_engine: Optional[FaceAnalysis] = None


def get_engine() -> FaceAnalysis:
    """মডেল একবারই লোড হয় (প্রথম অনুরোধে)।"""
    global _engine
    if _engine is None:
        engine = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        engine.prepare(ctx_id=-1, det_size=(640, 640))
        _engine = engine
    return _engine


def require_key(x_api_key: str = Header(default="")):
    if not API_KEY or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="ছবি অনেক বড় (সর্বোচ্চ ৫ MB)")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="ছবি পড়া যায়নি")
    return img


def analyze(img: np.ndarray) -> dict:
    """ছবিতে ঠিক একটি স্পষ্ট মুখ আছে কিনা দেখে; থাকলে তার ভেক্টর দেয়।"""
    faces = get_engine().get(img)

    if len(faces) == 0:
        return {"valid": False, "message": "ছবিতে কোনো মুখ পাওয়া যায়নি, আবার তুলুন।", "faceCount": 0}
    if len(faces) > 1:
        return {"valid": False, "message": "ছবিতে একাধিক মুখ আছে, শুধু একজনের ছবি দিন।", "faceCount": len(faces)}

    face = faces[0]
    score = float(face.det_score)
    x1, y1, x2, y2 = face.bbox
    short_side = float(min(x2 - x1, y2 - y1))

    if score < MIN_DET_SCORE:
        return {"valid": False, "message": "মুখ স্পষ্ট নয়, ভালো আলোয় সামনে থেকে তুলুন।", "faceCount": 1, "detScore": score}
    if short_side < MIN_FACE_SIZE:
        return {"valid": False, "message": "মুখ ছোট দেখাচ্ছে, ক্যামেরার আরেকটু কাছ থেকে তুলুন।", "faceCount": 1, "detScore": score}

    # normed_embedding আগে থেকেই L2-normalize করা (দৈর্ঘ্য ১), তাই dot product = cosine similarity
    embedding = face.normed_embedding.astype(np.float32)
    return {
        "valid": True,
        "message": "",
        "faceCount": 1,
        "detScore": score,
        "embedding": embedding.tolist(),
    }


def cosine_similarity(a: List[float], b: List[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    if va.shape != vb.shape or va.size == 0:
        raise ValueError("ভেক্টরের মাপ মেলেনি")
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        raise ValueError("ভেক্টর শূন্য")
    return float(np.dot(va, vb) / (na * nb))


@app.post("/face/check", dependencies=[Depends(require_key)])
def face_check(image: UploadFile = File(...)):
    result = analyze(decode_image(image.file.read()))
    result.pop("embedding", None)  # যাচাইয়ে ভেক্টর ফেরত যায় না
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
        similarity = cosine_similarity(result["embedding"], stored)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "match": similarity >= MATCH_THRESHOLD,
        "valid": True,
        "similarity": round(similarity, 4),
        "threshold": MATCH_THRESHOLD,
    }


@app.get("/health")
def health():
    return {"ok": True}
