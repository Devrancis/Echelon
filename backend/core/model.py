from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Enum, JSON
from sqlalchemy.orm import relationship
from core.database import Base
import datetime
import enum

class ScanStatus(enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class Target(Base):
    __tablename__ = "targets"
    
    id = Column(Integer, primary_key=True, index=True)
    target_url = Column(String, unique=True, index=True)
    label = Column(String, nullable=True) # e.g., "Production Core API"
    
    scans = relationship("Scan", back_populates="target", cascade="all, delete-orphan")

class Scan(Base):
    __tablename__ = "scans"
    
    id = Column(Integer, primary_key=True, index=True)
    target_id = Column(Integer, ForeignKey("targets.id"))
    status = Column(Enum(ScanStatus), default=ScanStatus.PENDING)
    tool_used = Column(String) # e.g., "nuclei", "nmap"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    target = relationship("Target", back_populates="scans")
    findings = relationship("Finding", back_populates="scan", cascade="all, delete-orphan")

class Finding(Base):
    __tablename__ = "findings"
    
    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("scans.id"))
    severity = Column(String, index=True) # critical, high, medium, low, info
    name = Column(String)
    description = Column(String)
    
    scan = relationship("Scan", back_populates="findings")
    meta_data = relationship("Metadata", back_populates="finding", cascade="all, delete-orphan")

class Metadata(Base):
    __tablename__ = "metadata"
    
    id = Column(Integer, primary_key=True, index=True)
    finding_id = Column(Integer, ForeignKey("findings.id"))
    key = Column(String)
    value = Column(JSON) # Stores nested JSON output directly from the tools
    
    finding = relationship("Finding", back_populates="meta_data")