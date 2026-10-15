from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Vendor
from backend.app.schemas import VendorResponse

router = APIRouter(prefix="/vendors", tags=["Vendors"])

@router.get("", response_model=List[VendorResponse])
def get_vendors(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).all()
    return [
        VendorResponse(
            id=v.id,
            vendor_code=v.vendor_code,
            name=v.name,
            tax_id=v.tax_id,
            currency=v.currency,
            payment_terms_days=v.payment_terms_days,
            trust_score=v.trust_score,
            is_active=v.is_active
        ) for v in vendors
    ]
