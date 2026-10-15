from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import GoodsReceipt, GRNLine, PurchaseOrder, POLine
from backend.app.schemas import GRNResponse, GRNLineResponse, QuickReceiveRequest

router = APIRouter(prefix="/goods-receipts", tags=["Goods Receipts"])

@router.get("", response_model=List[GRNResponse])
def get_goods_receipts(db: Session = Depends(get_db)):
    grns = db.query(GoodsReceipt).order_by(GoodsReceipt.received_date.desc()).all()
    results = []
    for g in grns:
        results.append(GRNResponse(
            id=g.id,
            grn_number=g.grn_number,
            po_id=g.po_id,
            po_number=g.purchase_order.po_number if g.purchase_order else "N/A",
            received_date=g.received_date,
            warehouse_location=g.warehouse_location,
            received_by=g.received_by,
            lines=[
                GRNLineResponse(
                    id=l.id,
                    grn_id=l.grn_id,
                    po_line_id=l.po_line_id,
                    item_code=l.item_code,
                    received_qty=l.received_qty,
                    rejected_qty=l.rejected_qty,
                    rejection_notes=l.rejection_notes
                ) for l in g.lines
            ]
        ))
    return results

@router.post("/quick-receive", response_model=GRNResponse)
def quick_receive(payload: QuickReceiveRequest, db: Session = Depends(get_db)):
    """Allows warehouse dock workers to log physical receipts against an open PO without an ERP"""
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == payload.po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")

    grn_count = db.query(GoodsReceipt).count() + 8900
    grn_num = f"GRN-{grn_count}"

    grn = GoodsReceipt(
        tenant_id=po.tenant_id,
        po_id=po.id,
        grn_number=grn_num,
        received_date=datetime.utcnow(),
        warehouse_location=payload.warehouse_location,
        received_by=payload.received_by
    )
    db.add(grn)
    db.flush()

    response_lines = []
    for item in payload.items:
        grn_line = GRNLine(
            tenant_id=po.tenant_id,
            grn_id=grn.id,
            po_line_id=item.po_line_id,
            item_code=item.item_code,
            received_qty=item.received_qty,
            rejected_qty=item.rejected_qty,
            rejection_notes=item.notes
        )
        db.add(grn_line)
        db.flush()
        response_lines.append(GRNLineResponse(
            id=grn_line.id,
            grn_id=grn.id,
            po_line_id=grn_line.po_line_id,
            item_code=grn_line.item_code,
            received_qty=grn_line.received_qty,
            rejected_qty=grn_line.rejected_qty,
            rejection_notes=grn_line.rejection_notes
        ))

    db.commit()

    return GRNResponse(
        id=grn.id,
        grn_number=grn.grn_number,
        po_id=po.id,
        po_number=po.po_number,
        received_date=grn.received_date,
        warehouse_location=grn.warehouse_location,
        received_by=grn.received_by,
        lines=response_lines
    )
