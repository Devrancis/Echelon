import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import subprocess
import json
import socketio
from celery import Celery
from core.config import settings
from core.database import SessionLocal
from core import models

socket_manager = socketio.RedisManager('redis://redis:6379/0')
sio_emitter = socketio.Server(client_manager=socket_manager)

celery_app = Celery(
    "echelon_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL
)

def emit_and_save_finding(db, scan_id, target_url, severity, name, description, raw_data, tool):
    # 1. Create Finding
    new_finding = models.Finding(
        scan_id=scan_id,
        severity=severity,
        name=name,
        description=description
    )
    db.add(new_finding)
    db.flush()
    
    # 2. Attach Metadata
    new_meta = models.Metadata(
        finding_id=new_finding.id,
        key=f"raw_{tool}_payload",
        value=raw_data
    )
    db.add(new_meta)
    db.commit()
    db.refresh(new_finding)
    db.refresh(new_meta)

    # 3. Live Broadcast
    sio_emitter.emit('new_finding', {
        'id': new_finding.id,
        'scan_id': scan_id,
        'severity': new_finding.severity,
        'name': new_finding.name,
        'description': new_finding.description,
        'target': target_url,
        'meta_data': [{ 'id': new_meta.id, 'key': new_meta.key, 'value': new_meta.value }]
    })

@celery_app.task(name="run_recon_scan")
def run_recon_scan(scan_id: int, target_url: str, tool: str = "nuclei"):
    db = SessionLocal()
    scan = None
    
    try:
        scan = db.query(models.Scan).filter(models.Scan.id == scan_id).first()
        if scan:
            scan.status = models.ScanStatus.RUNNING
            db.commit()

        output_file = f"scan_{scan_id}_results.tmp"
        
        # --- THE COMMAND ROUTER ---
        if tool == "nuclei":
            cmd = ["nuclei", "-target", target_url, "-json-export", output_file, "-silent"]
        elif tool == "subfinder":
            # Strip scheme for subfinder
            domain = target_url.replace("https://", "").replace("http://", "").split("/")[0]
            cmd = ["subfinder", "-d", domain, "-json", "-o", output_file, "-silent"]
        elif tool == "nmap":
            # Strip scheme for nmap
            domain = target_url.replace("https://", "").replace("http://", "").split("/")[0]
            cmd = ["nmap", "-F", "-T4", domain, "-oN", output_file] # Fast scan, Normal output
        else:
            raise ValueError(f"Unknown engine tool: {tool}")

        print(f"[*] Echelon executing [{tool.upper()}] on: {target_url}")
        subprocess.run(cmd, capture_output=True, text=True, check=False) # check=False because nmap might return non-zero if host is down
        
        # --- THE PARSER ROUTER ---
        if os.path.exists(output_file):
            if tool == "nuclei":
                with open(output_file, "r") as f:
                    for line in f:
                        if not line.strip(): continue
                        data = json.loads(line)
                        emit_and_save_finding(
                            db, scan_id, target_url,
                            severity=data.get("info", {}).get("severity", "info"),
                            name=data.get("template-id", "nuclei-finding"),
                            description=data.get("info", {}).get("description", "No description."),
                            raw_data=data, tool=tool
                        )
            
            elif tool == "subfinder":
                with open(output_file, "r") as f:
                    for line in f:
                        if not line.strip(): continue
                        data = json.loads(line)
                        emit_and_save_finding(
                            db, scan_id, target_url,
                            severity="info",
                            name="Subdomain Discovered",
                            description=f"Found subdomain: {data.get('host')}",
                            raw_data=data, tool=tool
                        )
                        
            elif tool == "nmap":
                with open(output_file, "r") as f:
                    raw_text = f.read()
                    if raw_text.strip():
                        # Nmap outputs plain text, we wrap it in a JSON structure for the UI
                        emit_and_save_finding(
                            db, scan_id, target_url,
                            severity="medium",
                            name="Port Scan Results",
                            description="Nmap Fast Scan completed. See raw dump for open ports.",
                            raw_data={"nmap_stdout": raw_text}, tool=tool
                        )

            os.remove(output_file)

        if scan:
            scan.status = models.ScanStatus.COMPLETED
            db.commit()
            
        print(f"[+] Scan {scan_id} ({tool}) completed.")
        
    except Exception as e:
        print(f"[-] System Exception: {str(e)}")
        if scan:
            scan.status = models.ScanStatus.FAILED
            db.commit()
    finally:
        db.close()