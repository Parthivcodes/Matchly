from typing import List, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field

# Auth & User
class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    role: str
    tenant_id: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# Tolerance Config
class ToleranceConfigSchema(BaseModel):
    price_tolerance_pct: float = 1.5
    price_tolerance_abs: float = 5.0
    qty_tolerance_pct: float = 0.0
    qty_tolerance_abs: float = 0.0
    is_stricter_rule: bool = False

# PO Lines & PO
class POLineCreate(BaseModel):
    line_number: int
    item_code: str
    description: str
    ordered_qty: float
    uom: str = "EA"
    unit_price: float
    tax_rate_pct: float = 0.0
    line_total: float

class POLineResponse(POLineCreate):
    id: str
    po_id: str

class POCreate(BaseModel):
    vendor_id: str
    po_number: str
    order_date: datetime
    currency: str = "USD"
    total_amount: float
    lines: List[POLineCreate]

class POResponse(BaseModel):
    id: str
    po_number: str
    vendor_id: str
    vendor_name: Optional[str] = None
    order_date: datetime
    currency: str
    total_amount: float
    status: str
    lines: List[POLineResponse]

# GRN Lines & GRN
class GRNLineCreate(BaseModel):
    po_line_id: str
    item_code: str
    received_qty: float
    rejected_qty: float = 0.0
    rejection_notes: Optional[str] = None

class GRNLineResponse(GRNLineCreate):
    id: str
    grn_id: str

class GRNCreate(BaseModel):
    po_id: str
    grn_number: str
    received_date: datetime
    warehouse_location: Optional[str] = None
    received_by: Optional[str] = None
    lines: List[GRNLineCreate]

class GRNResponse(BaseModel):
    id: str
    grn_number: str
    po_id: str
    po_number: Optional[str] = None
    received_date: datetime
    warehouse_location: Optional[str] = None
    received_by: Optional[str] = None
    lines: List[GRNLineResponse]

# Quick Web Receiving
class QuickReceiveItem(BaseModel):
    po_line_id: str
    item_code: str
    received_qty: float
    rejected_qty: float = 0.0
    notes: Optional[str] = None

class QuickReceiveRequest(BaseModel):
    po_id: str
    warehouse_location: str = "MAIN DOCK"
    received_by: str = "Carlos M."
    items: List[QuickReceiveItem]

# Invoice Lines & Invoice
class InvoiceLineCreate(BaseModel):
    line_number: int
    item_code: Optional[str] = None
    description: str
    quantity: float
    uom: Optional[str] = "EA"
    unit_price: float
    tax_rate_pct: float = 0.0
    tax_amount: float = 0.0
    line_total: float
    confidence: Optional[float] = 1.0
    bbox: Optional[List[float]] = None

class InvoiceLineResponse(InvoiceLineCreate):
    id: str
    invoice_id: str
    po_line_id: Optional[str] = None

class InvoiceCreate(BaseModel):
    vendor_id: Optional[str] = None
    po_reference: Optional[str] = None
    invoice_number: str
    invoice_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    currency: str = "USD"
    subtotal: float
    tax_total: float = 0.0
    discount_total: float = 0.0
    grand_total: float
    file_s3_key: str = "mock_s3_key.pdf"
    file_hash_sha256: str = "mock_hash"
    lines: List[InvoiceLineCreate]

class InvoiceResponse(BaseModel):
    id: str
    invoice_number: str
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    po_reference: Optional[str] = None
    invoice_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    currency: str
    subtotal: float
    tax_total: float
    discount_total: float
    grand_total: float
    status: str
    extraction_confidence: Optional[float] = None
    lines: List[InvoiceLineResponse]

# Match Run & Results
class MatchLineResultResponse(BaseModel):
    id: str
    invoice_line_id: str
    po_line_id: Optional[str] = None
    is_matched: bool
    used_tolerance: bool
    billable_qty: float
    invoiced_qty: float
    qty_variance: float
    po_unit_price: float
    invoiced_unit_price: float
    price_variance: float
    exception_code: Optional[str] = None
    message: Optional[str] = None

class MatchRunResponse(BaseModel):
    id: str
    invoice_id: str
    po_id: Optional[str] = None
    status: str
    total_price_variance: float
    total_qty_variance: float
    executed_at: datetime
    line_results: List[MatchLineResultResponse]

# Exceptions & Overrides
class ExceptionResponse(BaseModel):
    id: str
    invoice_id: str
    invoice_number: str
    vendor_name: Optional[str] = None
    reason_code: str
    status: str
    severity: str
    message: str
    sla_due_at: datetime
    override_reason: Optional[str] = None
    resolved_at: Optional[datetime] = None

class ExceptionOverrideRequest(BaseModel):
    override_reason: str
    action: str = "APPROVE"  # APPROVE, REJECT

# Vendor Scorecards
class VendorResponse(BaseModel):
    id: str
    vendor_code: str
    name: str
    tax_id: Optional[str] = None
    currency: str
    payment_terms_days: int
    trust_score: float
    is_active: bool

# Dashboard KPIs
class DashboardKPIs(BaseModel):
    total_invoices: int
    auto_matched_count: int
    matched_tolerance_count: int
    exception_count: int
    stp_rate_pct: float
    money_protected_usd: float
    open_exceptions_count: int
    sla_breaching_count: int
    aging_0_to_2_days: int
    aging_3_to_7_days: int
    aging_over_7_days: int
