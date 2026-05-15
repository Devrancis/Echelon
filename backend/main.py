from fastapi import FastAPI
from worker import run_recon_scan
from pydantic import BaseModel

app = FastAPI(title="Echelon Security Platform")

class ScanRequest(BaseModel):
    target: str

@app.get("/health")
def health_check():
    return {"status": "operational", "system": "Echelon C2"}

@app.post("/api/v1/scans/launch")
def launch_scan(payload: ScanRequest):
    # Dispatch the heavy lifting to the Celery worker via Redis
    task = run_recon_scan.delay(payload.target)
    
    return {
        "message": "Scan initiated",
        "task_id": task.id,
        "target": payload.target,
        "status": "Queued"
    }