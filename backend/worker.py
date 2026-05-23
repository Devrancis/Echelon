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

@celery_app.task(name="run_recon_scan")
def run_recon_scan(scan_id: int, target_url: str):
    """
    Executes a Nuclei security scan, parses the JSON output, 
    stores findings into PostgreSQL, and broadcasts them via Socket.io.
    """
    db = SessionLocal()
    scan = None
    
    try:
        # 1. THE STARTUP
        scan = db.query(models.Scan).filter(models.Scan.id == scan_id).first()
        if scan:
            scan.status = models.ScanStatus.RUNNING
            db.commit()

        # 2. THE EXECUTION
        output_file = f"scan_{scan_id}_results.json"
        cmd = [
            "nuclei",
            "-target", target_url,
            "-json-export", output_file,
            "-silent"
        ]

        print(f"[*] Echelon Engine executing Nuclei on: {target_url}")
        subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        # 3. PARSING & LIVE EMITTING
        if os.path.exists(output_file):
            with open(output_file, "r") as f:
                for line in f:
                    if not line.strip():
                        continue
                    
                    finding_data = json.loads(line)
                    
                    # Create the Finding
                    new_finding = models.Finding(
                        scan_id=scan_id,
                        severity=finding_data.get("info", {}).get("severity", "info"),
                        name=finding_data.get("template-id"),
                        description=finding_data.get("info", {}).get("description", "No description provided.")
                    )
                    db.add(new_finding)
                    db.flush() # Locks in the new_finding.id so we can attach Metadata
                    
                    # Create the Metadata
                    new_meta = models.Metadata(
                        finding_id=new_finding.id,
                        key="raw_nuclei_payload",
                        value=finding_data
                    )
                    db.add(new_meta)
                    
                    # Commit both to the Vault
                    db.commit()
                    db.refresh(new_finding)

                    # THE LIVE TRIGGER: Broadcast the exact vulnerability instantly with Metadata
                    sio_emitter.emit('new_finding', {
                        'id': new_finding.id,
                        'scan_id': scan_id,
                        'severity': new_finding.severity,
                        'name': new_finding.name,
                        'description': new_finding.description,
                        'target': target_url,
                        'meta_data': [
                            {
                                'id': new_meta.id,
                                'key': new_meta.key,
                                'value': new_meta.value
                            }
                        ]
                    })
            
            # Clean up local artifact
            os.remove(output_file)

        # 4. THE CLEAN FINISH
        if scan:
            scan.status = models.ScanStatus.COMPLETED
            db.commit()
            
        print(f"[+] Scan {scan_id} successfully compiled and saved to Vault.")
        
    except subprocess.CalledProcessError as e:
        print(f"[-] Scanner Execution Failure: {e.stderr}")
        if scan:
            scan.status = models.ScanStatus.FAILED
            db.commit()
    except Exception as e:
        print(f"[-] System Exception: {str(e)}")
        if scan:
            scan.status = models.ScanStatus.FAILED
            db.commit()
    finally:
        db.close()