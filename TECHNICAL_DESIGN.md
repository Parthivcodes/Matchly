# Matchly — Technical Architecture & Design Document (Phase 3)
**Version:** 1.0  
**Target:** 3-Way Invoice Matching SaaS  
**Scope:** Production-Ready Architectural & Schema Blueprint  

---

## 1. Technology Stack Selection & Architecture Justification

To enable a **single full-stack engineer to build and ship the MVP in 6 to 8 weeks**, the tech stack must balance rapid iteration, enterprise-grade data integrity, and native support for AI and deterministic mathematical computation.

Matchly is implemented on the **MERN Stack**: MongoDB, Express.js, React, and Node.js.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               FRONTEND APPLICATION                              │
│  - Next.js 14+ (App Router, React Server Components, TypeScript)                │
│  - Tailwind CSS + Radix UI Primitives (Sleek Dark/Light Mode, Fast Prototyping) │
│  - TanStack Table (High-performance line item spreadsheet grid)                 │
│  - PDF.js / React-PDF (Interactive canvas viewer with bounding box highlights)  │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ HTTPS / TLS 1.3
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY / REVERSE PROXY                           │
│  - NGINX / Cloudflare (Rate Limiting, DDoS Mitigation, SSL Termination)         │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                             BACKEND MICRO-SERVICES                              │
│  FastAPI (Python 3.11+)                                                         │
│  - Pydantic v2 (Sub-millisecond data validation & JSON schema extraction)      │
│  - SQLAlchemy 2.0 Async + Alembic (PostgreSQL ORM & Migrations)                 │
│  - RapidFuzz / Scikit-learn (High-speed C-optimized string & SKU fuzzy matching)│
└───────────────┬───────────────────────┬─────────────────────────┬───────────────┘
                │                       │                         │
                ▼                       ▼                         ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌─────────────────────────────┐
│  DATABASE (Postgres)  │ │ ASYNC QUEUE (Redis 7) │ │ OBJECT STORAGE (S3 / R2)    │
│  - PostgreSQL 16      │ │ - Celery / ARQ Worker │ │ - AWS S3 or Cloudflare R2   │
│  - Row-Level Security │ │ - Document OCR Tasks  │ │ - Presigned Upload URLs     │
│  - pg_trgm (Fuzzy)    │ │ - Duplicate Scans     │ │ - AES-256 Bucket Encryption │
└───────────────────────┘ └───────────────────────┘ └─────────────────────────────┘
```

### 1.1 Stack Selection Analysis
| Tier | Recommended Selection | Key Justifications & Trade-offs | Alternative Evaluated & Why Not Chosen |
| :--- | :--- | :--- | :--- |
| **Frontend** | **Next.js 14 (TypeScript)** | Server-side rendering for instant page loads; React ecosystem provides mature visual libraries (`@tanstack/react-table`, `pdfjs-dist`) for split-screen document review. | **Pure Single-Page App (Vite + React):** Lacks built-in API route handlers and server components, increasing boilerplate for authentication and session cookies. |
| **Backend** | **Python FastAPI (3.11+)** | Native interoperability with multimodal AI SDKs (Google GenAI, Anthropic, OpenAI); built-in Pydantic v2 validates complex nested invoice schemas $10\times$ faster than JS libraries; C-accelerated `RapidFuzz` runs fuzzy line-matching in microseconds. | **Node.js (NestJS / Express):** While TypeScript end-to-end is attractive, Node lacks native high-performance libraries for numerical array reconciliation and PDF document manipulation without external heavy binaries. |
| **Database** | **PostgreSQL 16** | Native Row-Level Security (RLS) for rock-solid multi-tenant isolation; JSONB columns for flexible AI extraction results; `pg_trgm` extension for database-level fuzzy duplicate searching; ACID transactions prevent double-invoicing race conditions. | **MongoDB / DynamoDB:** Lacks relational foreign key constraints and ACID multi-document transactions necessary for cumulative ledger accounting across POs, GRNs, and Invoices. |
| **Task Queue**| **Redis 7 + ARQ / Celery** | Sub-millisecond queue latency; non-blocking background OCR and LLM token ingestion; Redis token-bucket rate limiting and session caching. | **AWS SQS:** Introduces cloud vendor lock-in and higher local development friction compared to local Dockerized Redis. |
| **Object Store**| **S3-Compatible (R2 / S3)**| Direct client-to-storage presigned uploads eliminate server memory bottlenecks; zero egress bandwidth costs with Cloudflare R2; native lifecycle rules for document retention. | **Local Filesystem:** Unviable for horizontally scalable containers and multi-tenant SaaS compliance. |

---

## 2. System Architecture & Service Boundaries

```
                      ┌────────────────────────────────┐
                      │    Client Web Browser (SPA)    │
                      └───────┬────────────────┬───────┘
                              │                │
            1. Request Presigned Upload        │ 2. Direct S3 Upload
                              │                ▼
                              │   ┌───────────────────────────┐
                              │   │ Cloudflare R2 / Amazon S3 │
                              │   │ (Encrypted Invoice Files) │
                              │   └────────────┬──────────────┘
                              ▼                │
                      ┌────────────────┐       │
                      │ FastAPI Server │◄──────┘ 3. Notify Upload Complete
                      └───────┬────────┘
                              │ 4. Enqueue Job
                              ▼
                      ┌────────────────┐
                      │  Redis Queue   │
                      └───────┬────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                                             ▼
┌─────────────────────────────┐       ┌─────────────────────────────┐
│    AI Extraction Worker     │       │    3-Way Matching Engine    │
│  - Multimodal Vision LLM    │       │  - Cumulative Balance Check │
│  - JSON Schema Validator    │       │  - Dual Tolerance Engine    │
│  - Bounding Box Normalizer  │       │  - Duplicate Interceptor    │
└──────────────┬──────────────┘       └──────────────┬──────────────┘
               │                                     │
               └──────────────────┬──────────────────┘
                                  ▼
                      ┌────────────────────────┐
                      │   PostgreSQL 16 (RLS)  │
                      │   - Tenant Isolation   │
                      │   - Immutable Audits   │
                      └────────────────────────┘
```

### 2.1 Micro-Service & Modular Boundaries
Even within a fast monolithic codebase for MVP, clear domain boundaries prevent technical debt:
1. **Tenant & Identity Boundary:** User authentication, password hashing (Argon2id), session tokens, organization memberships, and RLS session context injection.
2. **Master Data Boundary:** Ingestion, validation, and storage of Vendors, Purchase Orders, PO Lines, and Goods Receipts.
3. **Ingestion & AI Boundary:** S3 presigned URL generation, file validation, multimodal LLM extraction, and confidence scoring.
4. **Matching & Reconciliation Boundary:** Deterministic, state-free business logic executing 3-way matching math, tolerance verification, and duplicate screening.
5. **Workflow & Approval Boundary:** State machines governing invoices (`DRAFT` $\to$ `EXTRACTED` $\to$ `MATCHED` $\to$ `APPROVED` $\to$ `EXPORTED`), exception assignments, and audit logging.
6. **Integration & Billing Boundary:** CSV export formatting for external accounting platforms, Stripe customer subscription lifecycles, and webhook handlers.

---

## 3. Full Production Database Schema (PostgreSQL 16 DDL)

Below is the complete database schema with Row-Level Security (RLS), foreign key constraints, indexes, and audit structures.

```sql
-- Enable necessary PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Enum Definitions
CREATE TYPE user_role AS ENUM ('ADMIN', 'FINANCE_CONTROLLER', 'AP_CLERK', 'PROCUREMENT', 'WAREHOUSE', 'VIEWER');
CREATE TYPE subscription_tier AS ENUM ('STARTER', 'GROWTH', 'SCALE');
CREATE TYPE subscription_status AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');
CREATE TYPE match_status AS ENUM ('PENDING', 'MATCHED_EXACT', 'MATCHED_TOLERANCE', 'EXCEPTION');
CREATE TYPE invoice_status AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'MATCHED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPORTED');
CREATE TYPE exception_reason_code AS ENUM (
    'PO_NOT_FOUND', 'PO_CLOSED', 'ITEM_NOT_ON_PO', 'GRN_MISSING',
    'QTY_BILLED_EXCEEDS_RECEIVED', 'QTY_BILLED_EXCEEDS_ORDERED',
    'PRICE_HIGHER', 'TOTAL_MISMATCH', 'TAX_MISMATCH',
    'CURRENCY_MISMATCH', 'DUPLICATE_EXACT', 'DUPLICATE_SUSPECTED',
    'LOW_EXTRACTION_CONFIDENCE'
);
CREATE TYPE exception_status AS ENUM ('OPEN', 'INVESTIGATING', 'OVERRIDDEN', 'REJECTED', 'RESOLVED');

-- 1. Tenants (Organizations)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    base_currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role user_role DEFAULT 'AP_CLERK' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

-- 3. Subscriptions & Usage
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    stripe_customer_id VARCHAR(100) UNIQUE,
    stripe_subscription_id VARCHAR(100) UNIQUE,
    tier subscription_tier DEFAULT 'STARTER' NOT NULL,
    status subscription_status DEFAULT 'TRIALING' NOT NULL,
    monthly_invoice_quota INT DEFAULT 150 NOT NULL,
    invoices_processed_this_period INT DEFAULT 0 NOT NULL,
    current_period_start TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    current_period_end TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days') NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. Vendors
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    vendor_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(100),
    contact_email VARCHAR(255),
    currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    payment_terms_days INT DEFAULT 30 NOT NULL,
    gl_account_code VARCHAR(100),
    trust_score NUMERIC(5, 2) DEFAULT 100.00 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_vendor_code UNIQUE (tenant_id, vendor_code)
);

-- 5. Tolerance Rules
CREATE TABLE tolerance_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
    category VARCHAR(100),
    price_tolerance_pct NUMERIC(5, 2) DEFAULT 1.50 NOT NULL,
    price_tolerance_abs NUMERIC(15, 4) DEFAULT 5.0000 NOT NULL,
    qty_tolerance_pct NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    qty_tolerance_abs NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    total_tolerance_abs NUMERIC(15, 4) DEFAULT 10.0000 NOT NULL,
    is_stricter_rule BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_vendor_tolerance UNIQUE (tenant_id, vendor_id)
);

-- 6. Purchase Orders
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    po_number VARCHAR(100) NOT NULL,
    order_date DATE NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    total_amount NUMERIC(15, 4) NOT NULL,
    status VARCHAR(50) DEFAULT 'OPEN' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_po_number UNIQUE (tenant_id, po_number)
);

-- 7. Purchase Order Lines
CREATE TABLE po_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number INT NOT NULL,
    item_code VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    ordered_qty NUMERIC(15, 4) NOT NULL,
    uom VARCHAR(50) DEFAULT 'EA' NOT NULL,
    unit_price NUMERIC(15, 4) NOT NULL,
    tax_rate_pct NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    line_total NUMERIC(15, 4) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_po_line_number UNIQUE (po_id, line_number)
);

-- 8. Goods Receipts (GRN)
CREATE TABLE goods_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    grn_number VARCHAR(100) NOT NULL,
    received_date DATE NOT NULL,
    warehouse_location VARCHAR(100),
    received_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_grn_number UNIQUE (tenant_id, grn_number)
);

-- 9. Goods Receipt Lines
CREATE TABLE grn_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    grn_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_line_id UUID NOT NULL REFERENCES po_lines(id) ON DELETE RESTRICT,
    item_code VARCHAR(100) NOT NULL,
    received_qty NUMERIC(15, 4) NOT NULL,
    rejected_qty NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    rejection_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 10. Invoices
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
    po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100) NOT NULL,
    normalized_invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE,
    due_date DATE,
    po_reference VARCHAR(100),
    currency VARCHAR(3) DEFAULT 'USD' NOT NULL,
    subtotal NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    tax_total NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    discount_total NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    grand_total NUMERIC(15, 4) NOT NULL,
    file_s3_key VARCHAR(500) NOT NULL,
    file_hash_sha256 VARCHAR(64) NOT NULL,
    status invoice_status DEFAULT 'UPLOADED' NOT NULL,
    extraction_raw_json JSONB,
    extraction_confidence NUMERIC(5, 2),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_tenant_vendor_invoice UNIQUE (tenant_id, vendor_id, normalized_invoice_number)
);

-- 11. Invoice Lines
CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    po_line_id UUID REFERENCES po_lines(id) ON DELETE SET NULL,
    line_number INT NOT NULL,
    item_code VARCHAR(100),
    description TEXT NOT NULL,
    quantity NUMERIC(15, 4) NOT NULL,
    uom VARCHAR(50),
    unit_price NUMERIC(15, 4) NOT NULL,
    tax_rate_pct NUMERIC(5, 2) DEFAULT 0.00 NOT NULL,
    tax_amount NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    line_total NUMERIC(15, 4) NOT NULL,
    confidence NUMERIC(5, 2),
    bbox JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 12. Match Runs
CREATE TABLE match_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    status match_status NOT NULL,
    rules_applied_json JSONB NOT NULL,
    total_price_variance NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    total_qty_variance NUMERIC(15, 4) DEFAULT 0.0000 NOT NULL,
    executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 13. Match Line Results
CREATE TABLE match_line_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    match_run_id UUID NOT NULL REFERENCES match_runs(id) ON DELETE CASCADE,
    invoice_line_id UUID NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
    po_line_id UUID REFERENCES po_lines(id) ON DELETE SET NULL,
    is_matched BOOLEAN NOT NULL,
    used_tolerance BOOLEAN DEFAULT FALSE NOT NULL,
    billable_qty NUMERIC(15, 4) NOT NULL,
    invoiced_qty NUMERIC(15, 4) NOT NULL,
    qty_variance NUMERIC(15, 4) NOT NULL,
    po_unit_price NUMERIC(15, 4) NOT NULL,
    invoiced_unit_price NUMERIC(15, 4) NOT NULL,
    price_variance NUMERIC(15, 4) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 14. Exceptions
CREATE TABLE exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    match_run_id UUID REFERENCES match_runs(id) ON DELETE SET NULL,
    reason_code exception_reason_code NOT NULL,
    status exception_status DEFAULT 'OPEN' NOT NULL,
    severity VARCHAR(20) DEFAULT 'HIGH' NOT NULL,
    message TEXT NOT NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    sla_due_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '3 days') NOT NULL,
    override_reason TEXT,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 15. Approvals & Threshold Rules
CREATE TABLE approval_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    min_amount NUMERIC(15, 4) NOT NULL,
    max_amount NUMERIC(15, 4),
    required_role user_role NOT NULL,
    requires_clean_match BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(50) DEFAULT 'APPROVED' NOT NULL,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 16. Immutable Audit Logs (Insert-Only)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    before_state JSONB,
    after_state JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexing Strategy for Performance & Scale
CREATE INDEX idx_invoices_tenant_status ON invoices(tenant_id, status);
CREATE INDEX idx_invoices_vendor_date ON invoices(tenant_id, vendor_id, invoice_date);
CREATE INDEX idx_invoices_norm_num_trgm ON invoices USING gin (normalized_invoice_number gin_trgm_ops);
CREATE INDEX idx_po_tenant_number ON purchase_orders(tenant_id, po_number);
CREATE INDEX idx_grn_po_id ON goods_receipts(po_id);
CREATE INDEX idx_exceptions_tenant_status ON exceptions(tenant_id, status);
CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);

-- PostgreSQL Row-Level Security (RLS) Configuration
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tolerance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_line_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Standard Multi-Tenant Policy Template
CREATE POLICY tenant_isolation_policy ON invoices
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
```

---

## 4. Matching Algorithm Pseudocode

This clean, robust Python implementation executes line-level matching, handles multi-invoice cumulative billing, multi-GRN consolidation, and tolerance enforcement.

```python
"""
Matchly Core 3-Way Matching Engine
Deterministic reconciliation across PO, GRN, and Invoice lines.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional, Tuple
from rapidfuzz import fuzz

@dataclass
class ToleranceConfig:
    price_pct: Decimal  # e.g. Decimal("1.5") for 1.5%
    price_abs: Decimal  # e.g. Decimal("5.00")
    qty_pct: Decimal    # e.g. Decimal("0.0")
    qty_abs: Decimal    # e.g. Decimal("0.0")
    is_stricter: bool   # True = AND, False = OR

@dataclass
class MatchLineOutcome:
    invoice_line_id: str
    po_line_id: Optional[str]
    is_matched: bool
    used_tolerance: bool
    billable_qty: Decimal
    invoiced_qty: Decimal
    qty_variance: Decimal
    po_unit_price: Decimal
    invoiced_unit_price: Decimal
    price_variance: Decimal
    exception_code: Optional[str] = None
    message: Optional[str] = None

class ThreeWayMatchingEngine:
    def __init__(self, db_session, tenant_id: str):
        self.session = db_session
        self.tenant_id = tenant_id

    def execute_match(self, invoice_id: str) -> Tuple[str, List[MatchLineOutcome]]:
        invoice = self.session.get_invoice(self.tenant_id, invoice_id)
        
        # Step 1: Duplicate Invoice Check
        duplicate_status, dup_message = self.check_duplicates(invoice)
        if duplicate_status:
            return "EXCEPTION", [MatchLineOutcome(
                invoice_line_id="", po_line_id=None, is_matched=False,
                used_tolerance=False, billable_qty=Decimal("0"), invoiced_qty=Decimal("0"),
                qty_variance=Decimal("0"), po_unit_price=Decimal("0"), invoiced_unit_price=Decimal("0"),
                price_variance=Decimal("0"), exception_code=duplicate_status, message=dup_message
            )]

        # Step 2: PO Resolution
        po = self.resolve_purchase_order(invoice)
        if not po:
            return "EXCEPTION", [self._header_exception(invoice, "PO_NOT_FOUND", "No matching PO reference found.")]

        if invoice.currency != po.currency:
            return "EXCEPTION", [self._header_exception(invoice, "CURRENCY_MISMATCH", f"Inv currency {invoice.currency} != PO {po.currency}")]

        # Step 3: Fetch Tolerances (Vendor > Global Default)
        tolerance = self.resolve_tolerances(invoice.vendor_id)

        # Step 4: Line-by-Line Matching
        line_outcomes: List[MatchLineOutcome] = []
        any_exception = False
        any_tolerance_used = False

        po_lines = {line.id: line for line in po.lines}
        
        for inv_line in invoice.lines:
            # Map invoice line to PO line
            matched_po_line = self.map_line(inv_line, list(po_lines.values()))
            if not matched_po_line:
                any_exception = True
                line_outcomes.append(MatchLineOutcome(
                    invoice_line_id=inv_line.id, po_line_id=None, is_matched=False, used_tolerance=False,
                    billable_qty=Decimal("0"), invoiced_qty=inv_line.quantity, qty_variance=inv_line.quantity,
                    po_unit_price=Decimal("0"), invoiced_unit_price=inv_line.unit_price,
                    price_variance=Decimal("0"), exception_code="ITEM_NOT_ON_PO",
                    message=f"Item {inv_line.description} does not match any PO line."
                ))
                continue

            # Step 4A: Calculate Cumulative Goods Received & Prior Invoiced Quantities
            total_grn_qty = self.session.get_cumulative_grn_qty(matched_po_line.id)
            prior_invoiced_qty = self.session.get_cumulative_invoiced_qty(matched_po_line.id, exclude_invoice_id=invoice.id)
            
            billable_qty = max(Decimal("0.0"), total_grn_qty - prior_invoiced_qty)

            # Check if GRN exists
            if total_grn_qty == Decimal("0.0"):
                any_exception = True
                line_outcomes.append(self._build_outcome(
                    inv_line, matched_po_line, billable_qty, False, False,
                    "GRN_MISSING", "Warehouse has not registered any goods receipts for this item."
                ))
                continue

            # Step 4B: Evaluate Quantity Discrepancies
            qty_variance = inv_line.quantity - billable_qty
            qty_passed = False
            qty_used_tol = False

            if qty_variance <= Decimal("0.0"):
                qty_passed = True
            else:
                # Over-received check vs Tolerance
                allowed_qty_pct = billable_qty * (tolerance.qty_pct / Decimal("100.0"))
                within_pct = qty_variance <= allowed_qty_pct
                within_abs = qty_variance <= tolerance.qty_abs

                if (within_pct and within_abs) if tolerance.is_stricter else (within_pct or within_abs):
                    qty_passed = True
                    qty_used_tol = True

            if not qty_passed:
                any_exception = True
                line_outcomes.append(self._build_outcome(
                    inv_line, matched_po_line, billable_qty, False, False,
                    "QTY_BILLED_EXCEEDS_RECEIVED",
                    f"Billed qty {inv_line.quantity} exceeds billable qty {billable_qty} (variance: +{qty_variance})."
                ))
                continue

            # Step 4C: Evaluate Unit Price Discrepancies
            price_variance = inv_line.unit_price - matched_po_line.unit_price
            price_passed = False
            price_used_tol = False

            if price_variance <= Decimal("0.0"):
                # Price is at or below contracted rate -> Pass!
                price_passed = True
            else:
                allowed_price_pct = matched_po_line.unit_price * (tolerance.price_pct / Decimal("100.0"))
                within_pct = price_variance <= allowed_price_pct
                within_abs = price_variance <= tolerance.price_abs

                if (within_pct and within_abs) if tolerance.is_stricter else (within_pct or within_abs):
                    price_passed = True
                    price_used_tol = True

            if not price_passed:
                any_exception = True
                line_outcomes.append(self._build_outcome(
                    inv_line, matched_po_line, billable_qty, False, False,
                    "PRICE_HIGHER",
                    f"Invoice price {inv_line.unit_price} exceeds PO price {matched_po_line.unit_price} by {price_variance}."
                ))
                continue

            # Successful Line Match
            line_tol_used = qty_used_tol or price_used_tol
            if line_tol_used:
                any_tolerance_used = True

            line_outcomes.append(self._build_outcome(
                inv_line, matched_po_line, billable_qty, True, line_tol_used
            ))

        # Determine Final Master Match Status
        if any_exception:
            final_status = "EXCEPTION"
        elif any_tolerance_used:
            final_status = "MATCHED_TOLERANCE"
        else:
            final_status = "MATCHED_EXACT"

        return final_status, line_outcomes

    def map_line(self, inv_line, po_lines):
        # 1. Exact Item Code match
        if inv_line.item_code:
            norm_code = inv_line.item_code.strip().upper()
            for pl in po_lines:
                if pl.item_code.strip().upper() == norm_code:
                    return pl

        # 2. Fuzzy Token Sort Match on Description
        best_score = 0.0
        best_line = None
        for pl in po_lines:
            score = fuzz.token_sort_ratio(inv_line.description.lower(), pl.description.lower())
            if score > best_score:
                best_score = score
                best_line = pl

        if best_score >= 88.0:
            return best_line
        return None

    def check_duplicates(self, invoice) -> Tuple[Optional[str], Optional[str]]:
        # Level 1: Exact Hash / Normalized Duplicate Check
        existing = self.session.query_duplicate_exact(self.tenant_id, invoice.vendor_id, invoice.normalized_invoice_number)
        if existing and existing.id != invoice.id:
            return "DUPLICATE_EXACT", f"Exact duplicate of invoice {existing.invoice_number} ({existing.id})"

        # Level 2: Fuzzy Near-Duplicate Check
        suspected = self.session.query_duplicate_suspected(
            self.tenant_id, invoice.vendor_id, invoice.grand_total, invoice.invoice_date, window_days=45
        )
        if suspected and suspected.id != invoice.id:
            return "DUPLICATE_SUSPECTED", f"Potential duplicate of invoice {suspected.invoice_number} with identical total ${invoice.grand_total}"

        return None, None
```

---

## 5. REST API Endpoint Specifications

All endpoints are versioned under `/api/v1` and require `Authorization: Bearer <jwt_token>`.

### 5.1 Document Ingestion: Request S3 Presigned Upload URL
* **`POST /api/v1/invoices/upload-url`**
  * **Request:**
    ```json
    {
      "filename": "vendor_bill_march.pdf",
      "mime_type": "application/pdf",
      "file_size_bytes": 2451000
    }
    ```
  * **Response (`201 Created`):**
    ```json
    {
      "upload_url": "https://tenant-storage.matchpay.app/invoices/org_89f/2026-03/inv_8819.pdf?X-Amz-Signature=...",
      "file_s3_key": "invoices/org_89f/2026-03/inv_8819.pdf",
      "expires_in_seconds": 900
    }
    ```

### 5.2 Trigger AI Extraction Pipeline
* **`POST /api/v1/invoices/process`**
  * **Request:**
    ```json
    {
      "file_s3_key": "invoices/org_89f/2026-03/inv_8819.pdf",
      "file_hash_sha256": "4a5e1e...91b8"
    }
    ```
  * **Response (`202 Accepted`):**
    ```json
    {
      "invoice_id": "8f395781-a90f-4882-9f12-98444a70b021",
      "status": "PROCESSING",
      "estimated_wait_seconds": 15
    }
    ```

### 5.3 Fetch Extracted Invoice & Review Lines
* **`GET /api/v1/invoices/{id}`**
  * **Response (`200 OK`):**
    ```json
    {
      "id": "8f395781-a90f-4882-9f12-98444a70b021",
      "invoice_number": "INV-9821",
      "vendor": {
        "id": "v_102",
        "name": "Acme Industrial Supplies",
        "tax_id": "US-EIN-992019"
      },
      "po_reference": "PO-2026-001",
      "invoice_date": "2026-03-15",
      "due_date": "2026-04-14",
      "currency": "USD",
      "grand_total": 600.00,
      "status": "EXTRACTED",
      "lines": [
        {
          "id": "line_01",
          "item_code": "SKU-BOLT-01",
          "description": "Hex Bolt M8 50mm",
          "quantity": 1000.0,
          "unit_price": 0.45,
          "line_total": 450.00,
          "confidence": 0.98,
          "bbox": [120, 45, 145, 950]
        },
        {
          "id": "line_02",
          "item_code": "SKU-NUT-01",
          "description": "Steel Lock Nut M8",
          "quantity": 1000.0,
          "unit_price": 0.15,
          "line_total": 150.00,
          "confidence": 0.81,
          "bbox": [150, 45, 175, 950]
        }
      ]
    }
    ```

### 5.4 Execute 3-Way Match
* **`POST /api/v1/invoices/{id}/match`**
  * **Response (`200 OK`):**
    ```json
    {
      "match_run_id": "mr_5501",
      "status": "EXCEPTION",
      "summary": {
        "total_lines": 2,
        "matched_lines": 1,
        "exception_lines": 1,
        "exceptions_raised": [
          {
            "line_id": "line_02",
            "reason_code": "QTY_BILLED_EXCEEDS_RECEIVED",
            "message": "Billed qty 1000.0 exceeds billable qty 800.0 (variance: +200.0)."
          }
        ]
      }
    }
    ```

### 5.5 Exception Resolution: Override with Reason
* **`POST /api/v1/exceptions/{id}/override`**
  * **Request:**
    ```json
    {
      "override_reason": "Pre-authorized by Procurement Manager Marcus; remaining 200 units on dock awaiting inspection.",
      "action": "APPROVE"
    }
    ```
  * **Response (`200 OK`):**
    ```json
    {
      "exception_id": "exc_9901",
      "status": "RESOLVED_OVERRIDDEN",
      "invoice_status": "APPROVED",
      "audit_logged": true
    }
    ```

---

## 6. Security Design & Multi-Tenant Isolation

### 6.1 Database Row-Level Security (RLS) Protocol
To prevent multi-tenant data leaks, application database connections execute through an ambient tenant context:
```python
# FastAPI Dependency / Middleware
async def get_tenant_db_session(request: Request):
    tenant_id = request.state.user.tenant_id
    async with db_session_factory() as session:
        # Enforce PostgreSQL Session Variable
        await session.execute(text(f"SET LOCAL app.current_tenant_id = '{tenant_id}';"))
        yield session
```
Every query automatically executes with `WHERE tenant_id = current_setting('app.current_tenant_id')`. Even if a developer accidentally omits a tenant filter in Python code, PostgreSQL aborts or returns empty rows!

### 6.2 Token Bucket Rate Limiting (Redis)
Endpoints are protected against scraping and brute-force attacks via Redis:
* Public Auth Endpoints: **15 requests per minute** per IP.
* Document Ingestion Endpoints: **30 uploads per minute** per tenant.
* General REST Query Endpoints: **120 requests per minute** per user token.

---

## 7. AI Extraction Pipeline Design & Fallback Workflow

```
                                  INCOMING INVOICE
                                          │
                         Is Digital PDF with Clean Text?
                           ├── Yes ──► Fast PyPDF Text Grid Extractor
                           └── No
                                │
                                ▼
                   Multimodal Vision LLM (Gemini 2.5 Flash)
                   Structured Output (JSON Schema Mode)
                                │
                                ▼
                   Post-Extraction Deterministic Math Validator
                     ├── Checksums Match?
                     ├── Yes ──► Calculate Confidence Scores
                     └── No  ──► Tag Arithmetic Warning & Flag Discrepant Rows
                                │
                                ▼
                       Render in Split-Screen UI
                                │
            Low Confidence or Missing Data?
              ├── Yes ──► Clerk Edits in Table (Human-in-the-Loop)
              └── No  ──► 1-Click "Confirm & Run Match"
```

### Fallback to Manual Entry
If an image is heavily corrupted or unparseable:
1. The AI worker catches the exception, updates the invoice status to `EXTRACTION_FAILED`, and logs the error to Sentry.
2. The UI renders the PDF viewer on the left and initializes an empty spreadsheet grid on the right.
3. The user selects a Vendor and PO from an autocomplete search; Matchly automatically prepopulates the line item descriptions and unit prices from the PO, allowing the clerk to simply type the invoice quantities and invoice number in under 30 seconds.
