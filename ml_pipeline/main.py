import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from engine import EcoTraceEngine

# --- INITIALIZE ENGINE ---
# Define the paths to your 4 weight files
WEIGHTS = {
    'gatekeeper': 'weights/bag_detector.pt',
    'security':   'weights/ai_detector_weights.pth',
    'material':   'weights/yolo11n-material-cls.pt',
    'defect':     'weights/leather-defect.pt'
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the engine once on startup and expose it via app.state.
    app.state.engine = None
    app.state.engine_error = None

    try:
        app.state.engine = EcoTraceEngine(
            WEIGHTS['gatekeeper'],
            WEIGHTS['security'],
            WEIGHTS['material'],
            WEIGHTS['defect']
        )
        print("✅ AI Engine Loaded Successfully")
    except Exception as e:
        app.state.engine_error = str(e)
        print(f"❌ Error loading AI Engine: {e}")

    yield

app = FastAPI(title="EcoTrace AI Authentication API", lifespan=lifespan)

# --- CORS SETTINGS ---
# This allows your frontend (React, Vue, or simple HTML) to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace "*" with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "online", "model": "EcoTrace v1.0"}

@app.post("/verify")
async def verify_bag(file: UploadFile = File(...)):
    engine = app.state.engine
    if engine is None:
        raise HTTPException(
            status_code=503,
            detail=f"Engine unavailable: {app.state.engine_error or 'startup failed'}"
        )

    # 1. Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    # 2. Save file temporarily
    temp_path = f"temp_{file.filename}"
    try:
        with open(temp_path, "wb") as buffer:
            buffer.write(await file.read())

        # 3. Run the AI Audit
        report = engine.run_full_audit(temp_path)

        # Normalize response shape for frontend usage.
        if report.get("verification") == "PASSED":
            return {"status": "success", "data": report}

        if report.get("verification") == "FAILED":
            return {
                "status": "failed",
                "message": report.get("reason", "Verification failed"),
                "data": report
            }

        return {
            "status": "failed",
            "message": report.get("error", "Verification could not be completed"),
            "data": report
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # 4. Clean up the temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)