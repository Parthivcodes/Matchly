import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Boolean, DateTime, Integer, Float, ForeignKey, Text, JSON
)
from sqlalchemy.orm import relationship
from backend.app.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    base_currency = Column(String(3), default="USD", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    vendors = relationship("Vendor", back_populates="tenant", cascade="all, delete-orphan")
    purchase_orders = relationship("PurchaseOrder", back_populates="tenant", cascade="all, delete-orphan")
    invoices = relationship("Invoice", back_populates="tenant", cascade="all, delete-orphan")
    tolerance_rules = relationship("ToleranceRule", back_populates="tenant", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="tenant", uselist=False, cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    role = Column(String(50), default="AP_CLERK", nullable=False)  # ADMIN, FINANCE_CONTROLLER, AP_CLERK, PROCUREMENT, WAREHOUSE, VIEWER
    is_active = Column(Boolean, default=True, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="users")

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), unique=True, nullable=False)
    tier = Column(String(50), default="STARTER", nullable=False)  # STARTER, GROWTH, SCALE
    status = Column(String(50), default="TRIALING", nullable=False)  # TRIALING, ACTIVE, PAST_DUE, CANCELED
    monthly_invoice_quota = Column(Integer, default=150, nullable=False)
    invoices_processed_this_period = Column(Integer, default=0, nullable=False)
    current_period_start = Column(DateTime, default=datetime.utcnow, nullable=False)
    current_period_end = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="subscription")

class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    vendor_code = Column(String(100), nullable=False)
    name = Column(String(255), nullable=False)
    tax_id = Column(String(100), nullable=True)
    contact_email = Column(String(255), nullable=True)
    currency = Column(String(3), default="USD", nullable=False)
    payment_terms_days = Column(Integer, default=30, nullable=False)
    gl_account_code = Column(String(100), nullable=True)
    trust_score = Column(Float, default=100.0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="vendors")
    purchase_orders = relationship("PurchaseOrder", back_populates="vendor")
    invoices = relationship("Invoice", back_populates="vendor")
    tolerance_rule = relationship("ToleranceRule", back_populates="vendor", uselist=False)

class ToleranceRule(Base):
    __tablename__ = "tolerance_rules"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    vendor_id = Column(String(36), ForeignKey("vendors.id"), nullable=True)
    category = Column(String(100), nullable=True)
    price_tolerance_pct = Column(Float, default=1.5, nullable=False)
    price_tolerance_abs = Column(Float, default=5.0, nullable=False)
    qty_tolerance_pct = Column(Float, default=0.0, nullable=False)
    qty_tolerance_abs = Column(Float, default=0.0, nullable=False)
    is_stricter_rule = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="tolerance_rules")
    vendor = relationship("Vendor", back_populates="tolerance_rule")

class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    vendor_id = Column(String(36), ForeignKey("vendors.id"), nullable=False)
    po_number = Column(String(100), nullable=False)
    order_date = Column(DateTime, nullable=False)
    currency = Column(String(3), default="USD", nullable=False)
    total_amount = Column(Float, nullable=False)
    status = Column(String(50), default="OPEN", nullable=False)  # OPEN, PARTIALLY_RECEIVED, FULLY_RECEIVED, CLOSED
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="purchase_orders")
    vendor = relationship("Vendor", back_populates="purchase_orders")
    lines = relationship("POLine", back_populates="purchase_order", cascade="all, delete-orphan")
    goods_receipts = relationship("GoodsReceipt", back_populates="purchase_order")
    invoices = relationship("Invoice", back_populates="purchase_order")

class POLine(Base):
    __tablename__ = "po_lines"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    po_id = Column(String(36), ForeignKey("purchase_orders.id"), nullable=False)
    line_number = Column(Integer, nullable=False)
    item_code = Column(String(100), nullable=False)
    description = Column(Text, nullable=False)
    ordered_qty = Column(Float, nullable=False)
    uom = Column(String(50), default="EA", nullable=False)
    unit_price = Column(Float, nullable=False)
    tax_rate_pct = Column(Float, default=0.0, nullable=False)
    line_total = Column(Float, nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="lines")
    grn_lines = relationship("GRNLine", back_populates="po_line")

class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    po_id = Column(String(36), ForeignKey("purchase_orders.id"), nullable=False)
    grn_number = Column(String(100), nullable=False)
    received_date = Column(DateTime, nullable=False)
    warehouse_location = Column(String(100), nullable=True)
    received_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="goods_receipts")
    lines = relationship("GRNLine", back_populates="goods_receipt", cascade="all, delete-orphan")

class GRNLine(Base):
    __tablename__ = "grn_lines"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    grn_id = Column(String(36), ForeignKey("goods_receipts.id"), nullable=False)
    po_line_id = Column(String(36), ForeignKey("po_lines.id"), nullable=False)
    item_code = Column(String(100), nullable=False)
    received_qty = Column(Float, nullable=False)
    rejected_qty = Column(Float, default=0.0, nullable=False)
    rejection_notes = Column(Text, nullable=True)

    goods_receipt = relationship("GoodsReceipt", back_populates="lines")
    po_line = relationship("POLine", back_populates="grn_lines")

class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    vendor_id = Column(String(36), ForeignKey("vendors.id"), nullable=True)
    po_id = Column(String(36), ForeignKey("purchase_orders.id"), nullable=True)
    invoice_number = Column(String(100), nullable=False)
    normalized_invoice_number = Column(String(100), nullable=False)
    invoice_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    po_reference = Column(String(100), nullable=True)
    currency = Column(String(3), default="USD", nullable=False)
    subtotal = Column(Float, default=0.0, nullable=False)
    tax_total = Column(Float, default=0.0, nullable=False)
    discount_total = Column(Float, default=0.0, nullable=False)
    grand_total = Column(Float, nullable=False)
    file_s3_key = Column(String(500), nullable=False)
    file_hash_sha256 = Column(String(64), nullable=False)
    status = Column(String(50), default="UPLOADED", nullable=False)  # UPLOADED, EXTRACTED, MATCHED, UNDER_REVIEW, APPROVED, REJECTED, EXPORTED
    extraction_raw_json = Column(JSON, nullable=True)
    extraction_confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    tenant = relationship("Tenant", back_populates="invoices")
    vendor = relationship("Vendor", back_populates="invoices")
    purchase_order = relationship("PurchaseOrder", back_populates="invoices")
    lines = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    match_runs = relationship("MatchRun", back_populates="invoice", cascade="all, delete-orphan")
    exceptions = relationship("ExceptionRecord", back_populates="invoice", cascade="all, delete-orphan")
    approvals = relationship("Approval", back_populates="invoice", cascade="all, delete-orphan")

class InvoiceLine(Base):
    __tablename__ = "invoice_lines"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    invoice_id = Column(String(36), ForeignKey("invoices.id"), nullable=False)
    po_line_id = Column(String(36), ForeignKey("po_lines.id"), nullable=True)
    line_number = Column(Integer, nullable=False)
    item_code = Column(String(100), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Float, nullable=False)
    uom = Column(String(50), nullable=True)
    unit_price = Column(Float, nullable=False)
    tax_rate_pct = Column(Float, default=0.0, nullable=False)
    tax_amount = Column(Float, default=0.0, nullable=False)
    line_total = Column(Float, nullable=False)
    confidence = Column(Float, default=1.0, nullable=True)
    bbox = Column(JSON, nullable=True)

    invoice = relationship("Invoice", back_populates="lines")

class MatchRun(Base):
    __tablename__ = "match_runs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    invoice_id = Column(String(36), ForeignKey("invoices.id"), nullable=False)
    po_id = Column(String(36), ForeignKey("purchase_orders.id"), nullable=True)
    status = Column(String(50), nullable=False)  # MATCHED_EXACT, MATCHED_TOLERANCE, EXCEPTION
    rules_applied_json = Column(JSON, nullable=True)
    total_price_variance = Column(Float, default=0.0, nullable=False)
    total_qty_variance = Column(Float, default=0.0, nullable=False)
    executed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="match_runs")
    line_results = relationship("MatchLineResult", back_populates="match_run", cascade="all, delete-orphan")

class MatchLineResult(Base):
    __tablename__ = "match_line_results"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    match_run_id = Column(String(36), ForeignKey("match_runs.id"), nullable=False)
    invoice_line_id = Column(String(36), ForeignKey("invoice_lines.id"), nullable=False)
    po_line_id = Column(String(36), ForeignKey("po_lines.id"), nullable=True)
    is_matched = Column(Boolean, nullable=False)
    used_tolerance = Column(Boolean, default=False, nullable=False)
    billable_qty = Column(Float, nullable=False)
    invoiced_qty = Column(Float, nullable=False)
    qty_variance = Column(Float, nullable=False)
    po_unit_price = Column(Float, nullable=False)
    invoiced_unit_price = Column(Float, nullable=False)
    price_variance = Column(Float, nullable=False)
    exception_code = Column(String(100), nullable=True)
    message = Column(Text, nullable=True)

    match_run = relationship("MatchRun", back_populates="line_results")

class ExceptionRecord(Base):
    __tablename__ = "exceptions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    invoice_id = Column(String(36), ForeignKey("invoices.id"), nullable=False)
    match_run_id = Column(String(36), ForeignKey("match_runs.id"), nullable=True)
    reason_code = Column(String(100), nullable=False)
    status = Column(String(50), default="OPEN", nullable=False)  # OPEN, INVESTIGATING, OVERRIDDEN, REJECTED, RESOLVED
    severity = Column(String(20), default="HIGH", nullable=False)
    message = Column(Text, nullable=False)
    assigned_to = Column(String(36), ForeignKey("users.id"), nullable=True)
    sla_due_at = Column(DateTime, nullable=False)
    override_reason = Column(Text, nullable=True)
    resolved_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="exceptions")

class Approval(Base):
    __tablename__ = "approvals"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    invoice_id = Column(String(36), ForeignKey("invoices.id"), nullable=False)
    approved_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    status = Column(String(50), default="APPROVED", nullable=False)
    comments = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    invoice = relationship("Invoice", back_populates="approvals")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(String(36), nullable=False)
    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
