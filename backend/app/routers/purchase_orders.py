from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import PurchaseOrder, POLine
from backend.app.schemas import POResponse, POLineResponse

router = APIRouter(prefix="/purchase-orders", tags=["Purchase Orders"])

@router.get("", response_model=List[POResponse])
def get_purchase_orders(db: Session = Depends(get_db)):
    pos = db.query(PurchaseOrder).order_by(PurchaseOrder.order_date.desc()).all()
    results = []
    for p in pos:
        results.append(POResponse(
            id=p.id,
            po_number=p.po_number,
            vendor_id=p.vendor_id,
            vendor_name=p.vendor.name if p.vendor else "Unknown",
            order_date=p.order_date,
            currency=p.currency,
            total_amount=p.total_amount,
            status=p.status,
            lines=[
                POLineResponse(
                    id=l.id,
                    po_id=l.po_id,
                    line_number=l.line_number,
                    item_code=l.item_code,
                    description=l.description,
                    ordered_qty=l.ordered_qty,
                    uom=l.uom,
                    unit_price=l.unit_price,
                    tax_rate_pct=l.tax_rate_pct,
                    line_total=l.line_total
                ) for l in p.lines
            ]
        ))
    return results

@router.get("/{po_id}", response_model=POResponse)
def get_po_detail(po_id: str, db: Session = Depends(get_db)):
    p = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    
    return POResponse(
        id=p.id,
        po_number=p.po_number,
        vendor_id=p.vendor_id,
        vendor_name=p.vendor.name if p.vendor else "Unknown",
        order_date=p.order_date,
        currency=p.currency,
        total_amount=p.total_amount,
        status=p.status,
        lines=[
            POLineResponse(
                id=l.id,
                po_id=l.po_id,
                line_number=l.line_number,
                item_code=l.item_code,
                description=l.description,
                ordered_qty=l.ordered_qty,
                uom=l.uom,
                unit_price=l.unit_price,
                tax_rate_pct=l.tax_rate_pct,
                line_total=l.line_total
            ) for l in p.lines
        ]
    )
