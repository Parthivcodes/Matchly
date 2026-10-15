from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import ExceptionRecord, Invoice, AuditLog
from backend.app.schemas import ExceptionResponse, ExceptionOverrideRequest

router = APIRouter(prefix="/exceptions", tags=["Exceptions"])

@router.get("", response_model=List[ExceptionResponse])
def get_exceptions(db: Session = Depends(get_db)):
    exceptions = db.query(ExceptionRecord).order_by(ExceptionRecord.created_at.desc()).all()
    results = []
    for exc in exceptions:
        results.append(ExceptionResponse(
            id=exc.id,
            invoice_id=exc.invoice_id,
            invoice_number=exc.invoice.invoice_number if exc.invoice else "N/A",
            vendor_name=exc.invoice.vendor.name if exc.invoice and exc.invoice.vendor else "Unknown",
            reason_code=exc.reason_code,
            status=exc.status,
            severity=exc.severity,
            message=exc.message,
            sla_due_at=exc.sla_due_at,
            override_reason=exc.override_reason,
            resolved_at=exc.resolved_at
        ))
    return results

@router.post("/{exception_id}/resolve")
def resolve_exception(exception_id: str, payload: ExceptionOverrideRequest, db: Session = Depends(get_db)):
    exc = db.query(ExceptionRecord).filter(ExceptionRecord.id == exception_id).first()
    if not exc:
        raise HTTPException(status_code=404, detail="Exception not found")

    invoice = db.query(Invoice).filter(Invoice.id == exc.invoice_id).first()

    if payload.action == "APPROVE":
        exc.status = "OVERRIDDEN"
        exc.override_reason = payload.override_reason
        exc.resolved_at = datetime.utcnow()
        if invoice:
            invoice.status = "APPROVED"
        action_name = "OVERRIDE_APPROVE"
    else:
        exc.status = "REJECTED"
        exc.override_reason = payload.override_reason
        exc.resolved_at = datetime.utcnow()
        if invoice:
            invoice.status = "REJECTED"
        action_name = "EXCEPTION_REJECT"

    # Write immutable audit log
    audit = AuditLog(
        tenant_id=exc.tenant_id,
        action=action_name,
        entity_type="EXCEPTION",
        entity_id=exc.id,
        before_state={"status": "OPEN"},
        after_state={"status": exc.status, "reason": payload.override_reason},
        ip_address="127.0.0.1",
        user_agent="Matchly-Web-Client"
    )
    db.add(audit)
    db.commit()

    return {
        "message": f"Exception {exc.status.lower()} successfully",
        "exception_id": exc.id,
        "invoice_status": invoice.status if invoice else "UNKNOWN"
    }
