from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Invoice, InvoiceLine, Vendor, PurchaseOrder, MatchRun, MatchLineResult
from backend.app.schemas import (
    InvoiceResponse, InvoiceLineResponse, InvoiceCreate,
    MatchRunResponse, MatchLineResultResponse
)
from backend.app.matching_engine import MatchingEngine, normalize_invoice_number

router = APIRouter(prefix="/invoices", tags=["Invoices"])

@router.get("", response_model=List[InvoiceResponse])
def get_invoices(db: Session = Depends(get_db)):
    invoices = db.query(Invoice).order_by(Invoice.created_at.desc()).all()
    results = []
    for inv in invoices:
        results.append(InvoiceResponse(
            id=inv.id,
            invoice_number=inv.invoice_number,
            vendor_id=inv.vendor_id,
            vendor_name=inv.vendor.name if inv.vendor else "Unknown Vendor",
            po_reference=inv.po_reference,
            invoice_date=inv.invoice_date,
            due_date=inv.due_date,
            currency=inv.currency,
            subtotal=inv.subtotal,
            tax_total=inv.tax_total,
            discount_total=inv.discount_total,
            grand_total=inv.grand_total,
            status=inv.status,
            extraction_confidence=inv.extraction_confidence,
            lines=[
                InvoiceLineResponse(
                    id=l.id,
                    invoice_id=l.invoice_id,
                    po_line_id=l.po_line_id,
                    line_number=l.line_number,
                    item_code=l.item_code,
                    description=l.description,
                    quantity=l.quantity,
                    uom=l.uom,
                    unit_price=l.unit_price,
                    tax_rate_pct=l.tax_rate_pct,
                    tax_amount=l.tax_amount,
                    line_total=l.line_total,
                    confidence=l.confidence,
                    bbox=l.bbox
                ) for l in inv.lines
            ]
        ))
    return results

@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return InvoiceResponse(
        id=inv.id,
        invoice_number=inv.invoice_number,
        vendor_id=inv.vendor_id,
        vendor_name=inv.vendor.name if inv.vendor else None,
        po_reference=inv.po_reference,
        invoice_date=inv.invoice_date,
        due_date=inv.due_date,
        currency=inv.currency,
        subtotal=inv.subtotal,
        tax_total=inv.tax_total,
        discount_total=inv.discount_total,
        grand_total=inv.grand_total,
        status=inv.status,
        extraction_confidence=inv.extraction_confidence,
        lines=[
            InvoiceLineResponse(
                id=l.id,
                invoice_id=l.invoice_id,
                po_line_id=l.po_line_id,
                line_number=l.line_number,
                item_code=l.item_code,
                description=l.description,
                quantity=l.quantity,
                uom=l.uom,
                unit_price=l.unit_price,
                tax_rate_pct=l.tax_rate_pct,
                tax_amount=l.tax_amount,
                line_total=l.line_total,
                confidence=l.confidence,
                bbox=l.bbox
            ) for l in inv.lines
        ]
    )

@router.post("/upload")
async def upload_invoice(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Simulates AI OCR extraction pipeline for uploaded invoice"""
    # Create or link sample invoice
    vendor = db.query(Vendor).first()
    po = db.query(PurchaseOrder).first()

    clean_filename = file.filename.replace(".pdf", "").replace(".png", "")
    inv_num = f"INV-{clean_filename.upper()[:8]}"

    new_inv = Invoice(
        tenant_id=vendor.tenant_id if vendor else "t-apex-001",
        vendor_id=vendor.id if vendor else None,
        po_id=po.id if po else None,
        invoice_number=inv_num,
        normalized_invoice_number=normalize_invoice_number(inv_num),
        invoice_date=datetime.utcnow(),
        due_date=datetime.utcnow(),
        po_reference=po.po_number if po else "PO-2026-001",
        currency="USD",
        subtotal=600.0,
        tax_total=0.0,
        discount_total=0.0,
        grand_total=600.0,
        file_s3_key=f"uploads/{file.filename}",
        file_hash_sha256=f"hash_{file.filename}",
        status="EXTRACTED",
        extraction_confidence=0.94
    )
    db.add(new_inv)
    db.flush()

    line1 = InvoiceLine(
        tenant_id=new_inv.tenant_id,
        invoice_id=new_inv.id,
        line_number=1,
        item_code="HEX-M8-50",
        description="Hex Bolt M8 50mm Grade 8.8 Galvanized",
        quantity=1000.0,
        unit_price=0.45,
        line_total=450.0,
        confidence=0.98,
        bbox=[120, 45, 145, 950]
    )
    line2 = InvoiceLine(
        tenant_id=new_inv.tenant_id,
        invoice_id=new_inv.id,
        line_number=2,
        item_code="NUT-M8-GALV",
        description="Steel Lock Nut M8 Galvanized DIN 985",
        quantity=1000.0,
        unit_price=0.15,
        line_total=150.0,
        confidence=0.82,  # triggers amber warning highlight
        bbox=[150, 45, 175, 950]
    )
    db.add_all([line1, line2])
    db.commit()

    return {"message": "Invoice uploaded and AI extracted successfully", "invoice_id": new_inv.id}

@router.post("/{invoice_id}/match", response_model=MatchRunResponse)
def trigger_match(invoice_id: str, db: Session = Depends(get_db)):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")

    engine = MatchingEngine(db, inv.tenant_id)
    match_run = engine.run_match(invoice_id)

    line_results = db.query(MatchLineResult).filter(
        MatchLineResult.match_run_id == match_run.id
    ).all()

    return MatchRunResponse(
        id=match_run.id,
        invoice_id=match_run.invoice_id,
        po_id=match_run.po_id,
        status=match_run.status,
        total_price_variance=match_run.total_price_variance,
        total_qty_variance=match_run.total_qty_variance,
        executed_at=match_run.executed_at,
        line_results=[
            MatchLineResultResponse(
                id=lr.id,
                invoice_line_id=lr.invoice_line_id,
                po_line_id=lr.po_line_id,
                is_matched=lr.is_matched,
                used_tolerance=lr.used_tolerance,
                billable_qty=lr.billable_qty,
                invoiced_qty=lr.invoiced_qty,
                qty_variance=lr.qty_variance,
                po_unit_price=lr.po_unit_price,
                invoiced_unit_price=lr.invoiced_unit_price,
                price_variance=lr.price_variance,
                exception_code=lr.exception_code,
                message=lr.message
            ) for lr in line_results
        ]
    )

@router.get("/{invoice_id}/match-result", response_model=MatchRunResponse)
def get_match_result(invoice_id: str, db: Session = Depends(get_db)):
    match_run = db.query(MatchRun).filter(
        MatchRun.invoice_id == invoice_id
    ).order_by(MatchRun.executed_at.desc()).first()

    if not match_run:
        raise HTTPException(status_code=404, detail="No match run found for this invoice")

    line_results = db.query(MatchLineResult).filter(
        MatchLineResult.match_run_id == match_run.id
    ).all()

    return MatchRunResponse(
        id=match_run.id,
        invoice_id=match_run.invoice_id,
        po_id=match_run.po_id,
        status=match_run.status,
        total_price_variance=match_run.total_price_variance,
        total_qty_variance=match_run.total_qty_variance,
        executed_at=match_run.executed_at,
        line_results=[
            MatchLineResultResponse(
                id=lr.id,
                invoice_line_id=lr.invoice_line_id,
                po_line_id=lr.po_line_id,
                is_matched=lr.is_matched,
                used_tolerance=lr.used_tolerance,
                billable_qty=lr.billable_qty,
                invoiced_qty=lr.invoiced_qty,
                qty_variance=lr.qty_variance,
                po_unit_price=lr.po_unit_price,
                invoiced_unit_price=lr.invoiced_unit_price,
                price_variance=lr.price_variance,
                exception_code=lr.exception_code,
                message=lr.message
            ) for lr in line_results
        ]
    )
