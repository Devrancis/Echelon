import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import socketio
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel
import core.models as models
from typing import List, Any
import datetime
from core.database import engine, get_db
from worker import run_recon_scan
from sqlalchemy import func

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Echelon Security C2")

redis_manager = socketio.AsyncRedisManager('redis://redis:6379/0')
sio = socketio.AsyncServer(
    async_mode='asgi', 
    client_manager=redis_manager, 
    cors_allowed_origins='*'
)
app_asgi = socketio.ASGIApp(sio, other_asgi_app=app)

# --- Schemas ---
class ScanLaunchRequest(BaseModel):
    target_url: str
    label: str = "Automated Recon"
    tool: str = "nuclei" # Added tool parameter (nuclei, subfinder, nmap)

class MetadataResponse(BaseModel):
    id: int
    key: str
    value: Any

    class Config:
        from_attributes = True

class FindingResponse(BaseModel):
    id: int
    severity: str
    name: str
    description: str
    meta_data: List[MetadataResponse] = []

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
@app.get("/api/v1/targets")
def get_all_targets(db: Session = Depends(get_db)):
    """
    Retrieves all targets and aggregates their scan history and finding counts.
    """
    targets = db.query(models.Target).all()
    
    fleet_data = []
    for target in targets:
        # Count total scans for this target
        total_scans = db.query(models.Scan).filter(models.Scan.target_id == target.id).count()
        
        # Count total findings across all scans for this target
        total_findings = db.query(models.Finding)\
            .join(models.Scan)\
            .filter(models.Scan.target_id == target.id).count()
            
        # Get the timestamp of the last scan
        last_scan = db.query(models.Scan)\
            .filter(models.Scan.target_id == target.id)\
            .order_by(models.Scan.created_at.desc()).first()
            
        fleet_data.append({
            "id": target.id,
            "target_url": target.target_url,
            "label": target.label,
            "total_scans": total_scans,
            "total_findings": total_findings,
            "last_scan_date": last_scan.created_at if last_scan else None,
            "status": last_scan.status.value if last_scan else "UNKNOWN"
        })
        
    return {"fleet": fleet_data}

@app.get("/health")
def health_check():
    return {"status": "operational", "system": "Echelon C2 Engine"}

@app.post("/api/v1/scans/launch")
def launch_scan(payload: ScanLaunchRequest, db: Session = Depends(get_db)):
    target = db.query(models.Target).filter(models.Target.target_url == payload.target_url).first()
    
    if not target:
        target = models.Target(target_url=payload.target_url, label=payload.label)
        db.add(target)
        db.commit()
        db.refresh(target)

    # Log the operation with the specific tool requested
    new_scan = models.Scan(
        target_id=target.id,
        status=models.ScanStatus.PENDING,
        tool_used=payload.tool 
    )
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

    # Dispatch the order with the tool parameter
    run_recon_scan.delay(new_scan.id, target.target_url, payload.tool)

    return {
        "message": f"Scan command ({payload.tool}) dispatched to worker.",
        "scan_id": new_scan.id,
        "target": target.target_url,
        "status": new_scan.status.value
    }

@app.get("/api/v1/scans/{scan_id}", response_model=ScanResponse)
def get_scan_results(scan_id: int, db: Session = Depends(get_db)):
    scan = db.query(models.Scan).filter(models.Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found in the Vault.")

    findings = db.query(models.Finding).options(
        joinedload(models.Finding.meta_data)
    ).filter(models.Finding.scan_id == scan_id).all()

    return {
        "id": scan.id,
        "target_url": scan.target.target_url,
        "status": scan.status.value,
        "tool_used": scan.tool_used,
        "created_at": scan.created_at,
        "total_findings": len(findings),
        "findings": findings
    }