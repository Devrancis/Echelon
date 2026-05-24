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
from fastapi.responses import Response
from fpdf import FPDF
from fastapi.middleware.cors import CORSMiddleware

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(title="Echelon Security C2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_manager = socketio.AsyncRedisManager(os.getenv("REDIS_URL", "redis://redis:6379/0"))
sio = socketio.AsyncServer(
    async_mode='asgi', 
    client_manager=redis_manager, 
    cors_allowed_origins=[FRONTEND_URL] 
)

models.Base.metadata.create_all(bind=engine)
app_asgi = socketio.ASGIApp(sio, other_asgi_app=app)

# --- Schemas ---
class ScanLaunchRequest(BaseModel):
    target_url: str
    label: str = "Automated Recon"
    tool: str = "nuclei" 

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
        total_scans = db.query(models.Scan).filter(models.Scan.target_id == target.id).count()
        
        total_findings = db.query(models.Finding)\
            .join(models.Scan)\
            .filter(models.Scan.target_id == target.id).count()
            
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

    new_scan = models.Scan(
        target_id=target.id,
        status=models.ScanStatus.PENDING,
        tool_used=payload.tool 
    )
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

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

@app.get("/api/v1/targets/{target_id}/report")
def generate_target_report(target_id: int, db: Session = Depends(get_db)):
    """
    Generates a downloadable PDF intelligence report for a specific target.
    """
    target = db.query(models.Target).filter(models.Target.id == target_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found in Vault.")

    scans = db.query(models.Scan).filter(models.Scan.target_id == target.id).all()
    scan_ids = [s.id for s in scans]
    findings = db.query(models.Finding).filter(models.Finding.scan_id.in_(scan_ids)).all()

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = f.severity.lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", "B", 24)
    pdf.cell(0, 20, "ECHELON INTELLIGENCE REPORT", ln=True, align="C")
    pdf.set_font("helvetica", "B", 14)
    pdf.cell(0, 10, f"Target Vector: {target.target_url}", ln=True, align="C")
    pdf.set_font("helvetica", "", 10)
    pdf.cell(0, 10, f"Generated: {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC", ln=True, align="C")
    pdf.ln(10)

    # Executive Summary
    pdf.set_font("helvetica", "B", 16)
    pdf.cell(0, 10, "Executive Summary", ln=True)
    pdf.set_font("helvetica", "", 12)
    pdf.cell(0, 8, f"Total Engagements (Scans): {len(scans)}", ln=True)
    pdf.cell(0, 8, f"Total Intercepts (Findings): {len(findings)}", ln=True)
    pdf.ln(5)
    
    pdf.set_font("helvetica", "B", 12)
    for sev, count in severity_counts.items():
        if count > 0:
            pdf.cell(0, 8, f"- {sev.upper()}: {count}", ln=True)
    pdf.ln(10)

    pdf.set_font("helvetica", "B", 16)
    pdf.cell(0, 10, "Detailed Intercept Log", ln=True)
    pdf.ln(5)

    for idx, finding in enumerate(findings, 1):
        if pdf.get_y() > 250:
            pdf.add_page()
            
        pdf.set_font("helvetica", "B", 12)
        pdf.cell(0, 8, f"{idx}. [{finding.severity.upper()}] {finding.name}", ln=True)
        
        pdf.set_font("helvetica", "", 10)
        desc = finding.description if finding.description else "No detailed description provided."
        pdf.multi_cell(0, 6, f"Details: {desc}")
        pdf.ln(5)

    pdf_bytes = bytes(pdf.output())
    
    headers = {
        "Content-Disposition": f"attachment; filename=echelon_report_{target.target_url.replace('https://', '').replace('/', '_')}.pdf"
    }
    
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)