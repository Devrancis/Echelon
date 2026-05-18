import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
import core.models as models
from typing import List
import datetime
from core.database import engine, get_db
from worker import run_recon_scan

# Ensure the schema is synced on boot
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Echelon Security C2")

# --- Schemas ---
class ScanLaunchRequest(BaseModel):
    target_url: str
    label: str = "Automated Recon"

class FindingResponse(BaseModel):
    id: int
    severity: str
    name: str
    description: str

    class Config:
        from_attributes = True

class ScanResponse(BaseModel):
    id: int
    target_url: str
    status: str
    tool_used: str
    created_at: datetime.datetime
    total_findings: int
    findings: List[FindingResponse]

# --- Endpoints ---
@app.get("/health")
def health_check():
    return {"status": "operational", "system": "Echelon C2 Engine"}

@app.post("/api/v1/scans/launch")
def launch_scan(payload: ScanLaunchRequest, db: Session = Depends(get_db)):
    # 1. Identify or register the target
    target = db.query(models.Target).filter(models.Target.target_url == payload.target_url).first()
    
    if not target:
        target = models.Target(target_url=payload.target_url, label=payload.label)
        db.add(target)
        db.commit()
        db.refresh(target)

    # 2. Log the operation
    new_scan = models.Scan(
        target_id=target.id,
        status=models.ScanStatus.PENDING,
        tool_used="nuclei"
    )
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

    # 3. Dispatch the order to Redis -> Celery Worker
    run_recon_scan.delay(new_scan.id, target.target_url)

    # 4. Instantly return control to the dashboard
    return {
        "message": "Scan command dispatched to worker.",
        "scan_id": new_scan.id,
        "target": target.target_url,
        "status": new_scan.status.value
    }