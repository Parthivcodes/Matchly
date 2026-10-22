from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from backend.app.database import SessionLocal, Base, engine
from backend.app.models import (
    Tenant, User, Subscription, Vendor, ToleranceRule,
    PurchaseOrder, POLine, GoodsReceipt, GRNLine,
    Invoice, InvoiceLine
)
from backend.app.matching_engine import normalize_invoice_number, MatchingEngine

def seed_database():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()

    # Check if already seeded
    existing_tenant = db.query(Tenant).filter(Tenant.slug == "apex-supply-chain").first()
    if existing_tenant:
        print("Database already seeded.")
        db.close()
        return existing_tenant.id

    print("Seeding Matchly demonstration database...")

    # 1. Tenant
    tenant = Tenant(
        id="t-apex-001",
        name="Apex Supply Chain Corp",
        slug="apex-supply-chain",
        base_currency="USD",
        is_active=True
    )
    db.add(tenant)

    # 2. Users
    admin_user = User(
        id="u-admin-01",
        tenant_id=tenant.id,
        email="parthivnanavatimatchly7@gmail.com",
        password_hash="Parthiv@matchly*54321",
        first_name="Parthiv",
        last_name="Nanavati",
        role="ADMIN"
    )
    clerk_user = User(
        id="u-clerk-01",
        tenant_id=tenant.id,
        email="priya.clerk@apexsupply.com",
        password_hash="mock_hash_argon2",
        first_name="Priya",
        last_name="Sharma",
        role="AP_CLERK"
    )
    controller_user = User(
        id="u-controller-01",
        tenant_id=tenant.id,
        email="sarah.controller@apexsupply.com",
        password_hash="mock_hash_argon2",
        first_name="Sarah",
        last_name="Jenkins",
        role="FINANCE_CONTROLLER"
    )
    warehouse_user = User(
        id="u-dock-01",
        tenant_id=tenant.id,
        email="carlos.dock@apexsupply.com",
        password_hash="mock_hash_argon2",
        first_name="Carlos",
        last_name="Mendoza",
        role="WAREHOUSE"
    )
    db.add_all([admin_user, clerk_user, controller_user, warehouse_user])

    # 3. Subscription (Growth Plan)
    sub = Subscription(
        id="sub-001",
        tenant_id=tenant.id,
        tier="GROWTH",
        status="ACTIVE",
        monthly_invoice_quota=1200,
        invoices_processed_this_period=84,
        current_period_start=datetime.utcnow() - timedelta(days=12),
        current_period_end=datetime.utcnow() + timedelta(days=18)
    )
    db.add(sub)

    # 4. Global Tolerance Rule (1.5% price, 0% qty)
    global_tol = ToleranceRule(
        id="tol-global-apex",
        tenant_id=tenant.id,
        vendor_id=None,
        price_tolerance_pct=1.5,
        price_tolerance_abs=5.0,
        qty_tolerance_pct=0.0,
        qty_tolerance_abs=0.0,
        is_stricter_rule=False
    )
    db.add(global_tol)

    # 5. Vendors
    v_acme = Vendor(
        id="v-acme-01",
        tenant_id=tenant.id,
        vendor_code="VEND-ACME",
        name="Acme Industrial Supplies",
        tax_id="US-EIN-1299401",
        contact_email="billing@acmeindustrial.com",
        currency="USD",
        payment_terms_days=30,
        gl_account_code="5010-COGS-MATERIALS",
        trust_score=94.5
    )
    v_titan = Vendor(
        id="v-titan-02",
        tenant_id=tenant.id,
        vendor_code="VEND-TITAN",
        name="Titan Steelworks Ltd",
        tax_id="US-EIN-8812034",
        contact_email="ar@titansteel.com",
        currency="USD",
        payment_terms_days=45,
        gl_account_code="5020-RAW-STEEL",
        trust_score=68.0  # High risk vendor!
    )
    v_global = Vendor(
        id="v-global-03",
        tenant_id=tenant.id,
        vendor_code="VEND-GLOBAL",
        name="Global Packaging Corp",
        tax_id="US-EIN-4491029",
        contact_email="invoices@globalpack.com",
        currency="USD",
        payment_terms_days=30,
        gl_account_code="5030-PACKAGING",
        trust_score=98.0
    )
    db.add_all([v_acme, v_titan, v_global])
    db.flush()

    # Vendor-specific tolerance for Titan Steel (0% price tolerance due to low trust)
    titan_tol = ToleranceRule(
        id="tol-titan-strict",
        tenant_id=tenant.id,
        vendor_id=v_titan.id,
        price_tolerance_pct=0.0,
        price_tolerance_abs=0.0,
        qty_tolerance_pct=2.0,  # 2% weight variance allowed for raw steel
        qty_tolerance_abs=5.0,
        is_stricter_rule=False
    )
    db.add(titan_tol)

    # 6. Purchase Orders & PO Lines
    # PO 1: Acme (Standard Hardware)
    po1 = PurchaseOrder(
        id="po-apex-101",
        tenant_id=tenant.id,
        vendor_id=v_acme.id,
        po_number="PO-2026-001",
        order_date=datetime.utcnow() - timedelta(days=15),
        currency="USD",
        total_amount=600.0,
        status="OPEN"
    )
    db.add(po1)
    db.flush()

    po1_l1 = POLine(
        id="pol-101-1",
        tenant_id=tenant.id,
        po_id=po1.id,
        line_number=1,
        item_code="HEX-M8-50",
        description="Hex Bolt M8 50mm Grade 8.8 Galvanized",
        ordered_qty=1000.0,
        uom="EA",
        unit_price=0.45,
        tax_rate_pct=0.0,
        line_total=450.0
    )
    po1_l2 = POLine(
        id="pol-101-2",
        tenant_id=tenant.id,
        po_id=po1.id,
        line_number=2,
        item_code="NUT-M8-GALV",
        description="Steel Lock Nut M8 Galvanized DIN 985",
        ordered_qty=1000.0,
        uom="EA",
        unit_price=0.15,
        tax_rate_pct=0.0,
        line_total=150.0
    )
    db.add_all([po1_l1, po1_l2])

    # PO 2: Titan Steel (Heavy Steel Plates - Backorder scenario)
    po2 = PurchaseOrder(
        id="po-apex-102",
        tenant_id=tenant.id,
        vendor_id=v_titan.id,
        po_number="PO-2026-002",
        order_date=datetime.utcnow() - timedelta(days=20),
        currency="USD",
        total_amount=5000.0,
        status="PARTIALLY_RECEIVED"
    )
    db.add(po2)
    db.flush()

    po2_l1 = POLine(
        id="pol-102-1",
        tenant_id=tenant.id,
        po_id=po2.id,
        line_number=1,
        item_code="STEEL-PL-10MM",
        description="Structural Steel Plate 10mm A36 Hot Rolled",
        ordered_qty=50.0,
        uom="SHT",
        unit_price=100.0,
        tax_rate_pct=0.0,
        line_total=5000.0
    )
    db.add(po2_l1)

    # 7. Goods Receipts (GRNs)
    # GRN 1: Full delivery for PO 1
    grn1 = GoodsReceipt(
        id="grn-apex-801",
        tenant_id=tenant.id,
        po_id=po1.id,
        grn_number="GRN-8801",
        received_date=datetime.utcnow() - timedelta(days=10),
        warehouse_location="WH-MAIN DOCK 4",
        received_by="Carlos Mendoza"
    )
    db.add(grn1)
    db.flush()

    grn1_l1 = GRNLine(
        id="grnl-801-1",
        tenant_id=tenant.id,
        grn_id=grn1.id,
        po_line_id=po1_l1.id,
        item_code="HEX-M8-50",
        received_qty=1000.0
    )
    grn1_l2 = GRNLine(
        id="grnl-801-2",
        tenant_id=tenant.id,
        grn_id=grn1.id,
        po_line_id=po1_l2.id,
        item_code="NUT-M8-GALV",
        received_qty=1000.0
    )
    db.add_all([grn1_l1, grn1_l2])

    # GRN 2: Partial delivery for PO 2 (Received only 20 sheets out of 50)
    grn2 = GoodsReceipt(
        id="grn-apex-802",
        tenant_id=tenant.id,
        po_id=po2.id,
        grn_number="GRN-8802",
        received_date=datetime.utcnow() - timedelta(days=8),
        warehouse_location="WH-HEAVY STORAGE",
        received_by="Carlos Mendoza"
    )
    db.add(grn2)
    db.flush()

    grn2_l1 = GRNLine(
        id="grnl-802-1",
        tenant_id=tenant.id,
        grn_id=grn2.id,
        po_line_id=po2_l1.id,
        item_code="STEEL-PL-10MM",
        received_qty=20.0
    )
    db.add(grn2_l1)
    db.commit()

    # 8. Demonstration Invoices
    # Invoice A: Perfectly Matched against PO-2026-001 & GRN-8801
    inv_a = Invoice(
        id="inv-demo-01",
        tenant_id=tenant.id,
        vendor_id=v_acme.id,
        po_id=po1.id,
        invoice_number="INV-9821",
        normalized_invoice_number=normalize_invoice_number("INV-9821"),
        invoice_date=datetime.utcnow() - timedelta(days=5),
        due_date=datetime.utcnow() + timedelta(days=25),
        po_reference="PO-2026-001",
        currency="USD",
        subtotal=600.0,
        tax_total=0.0,
        discount_total=0.0,
        grand_total=600.0,
        file_s3_key="demo/invoice_acme_9821.pdf",
        file_hash_sha256="hash_acme_9821",
        status="EXTRACTED",
        extraction_confidence=0.96
    )
    db.add(inv_a)
    db.flush()

    inv_a_l1 = InvoiceLine(
        id="invl-demo-01-1",
        tenant_id=tenant.id,
        invoice_id=inv_a.id,
        po_line_id=po1_l1.id,
        line_number=1,
        item_code="HEX-M8-50",
        description="Hex Bolt M8 50mm Grade 8.8 Galvanized",
        quantity=1000.0,
        unit_price=0.45,
        line_total=450.0,
        confidence=0.98,
        bbox=[120, 45, 145, 950]
    )
    inv_a_l2 = InvoiceLine(
        id="invl-demo-01-2",
        tenant_id=tenant.id,
        invoice_id=inv_a.id,
        po_line_id=po1_l2.id,
        line_number=2,
        item_code="NUT-M8-GALV",
        description="Steel Lock Nut M8 Galvanized DIN 985",
        quantity=1000.0,
        unit_price=0.15,
        line_total=150.0,
        confidence=0.94,
        bbox=[150, 45, 175, 950]
    )
    db.add_all([inv_a_l1, inv_a_l2])

    # Invoice B: Overbilling on Titan Steel (Billed 50 sheets when only 20 received!)
    inv_b = Invoice(
        id="inv-demo-02",
        tenant_id=tenant.id,
        vendor_id=v_titan.id,
        po_id=po2.id,
        invoice_number="INV-TITAN-4040",
        normalized_invoice_number=normalize_invoice_number("INV-TITAN-4040"),
        invoice_date=datetime.utcnow() - timedelta(days=3),
        due_date=datetime.utcnow() + timedelta(days=42),
        po_reference="PO-2026-002",
        currency="USD",
        subtotal=5000.0,
        tax_total=0.0,
        discount_total=0.0,
        grand_total=5000.0,
        file_s3_key="demo/invoice_titan_4040.pdf",
        file_hash_sha256="hash_titan_4040",
        status="EXTRACTED",
        extraction_confidence=0.91
    )
    db.add(inv_b)
    db.flush()

    inv_b_l1 = InvoiceLine(
        id="invl-demo-02-1",
        tenant_id=tenant.id,
        invoice_id=inv_b.id,
        po_line_id=po2_l1.id,
        line_number=1,
        item_code="STEEL-PL-10MM",
        description="Structural Steel Plate 10mm A36 Hot Rolled",
        quantity=50.0,
        unit_price=100.0,
        line_total=5000.0,
        confidence=0.92,
        bbox=[200, 45, 230, 950]
    )
    db.add(inv_b_l1)

    # Invoice C: Price Mismatch on Acme (Unfavorable price increase)
    inv_c = Invoice(
        id="inv-demo-03",
        tenant_id=tenant.id,
        vendor_id=v_acme.id,
        po_id=po1.id,
        invoice_number="INV-ACME-9912",
        normalized_invoice_number=normalize_invoice_number("INV-ACME-9912"),
        invoice_date=datetime.utcnow() - timedelta(days=2),
        due_date=datetime.utcnow() + timedelta(days=28),
        po_reference="PO-2026-001",
        currency="USD",
        subtotal=520.0,
        tax_total=0.0,
        discount_total=0.0,
        grand_total=520.0,
        file_s3_key="demo/invoice_acme_9912.pdf",
        file_hash_sha256="hash_acme_9912",
        status="EXTRACTED",
        extraction_confidence=0.88
    )
    db.add(inv_c)
    db.flush()

    inv_c_l1 = InvoiceLine(
        id="invl-demo-03-1",
        tenant_id=tenant.id,
        invoice_id=inv_c.id,
        po_line_id=po1_l1.id,
        line_number=1,
        item_code="HEX-M8-50",
        description="Hex Bolt M8 50mm Grade 8.8 Galvanized",
        quantity=1000.0,
        unit_price=0.52,  # Contract was $0.45 (+15.5% price creep!)
        line_total=520.0,
        confidence=0.85,
        bbox=[250, 45, 280, 950]
    )
    db.add(inv_c_l1)

    db.commit()

    # Automatically execute 3-way matching on the seeded invoices
    engine_match = MatchingEngine(db, tenant.id)
    engine_match.run_match(inv_a.id)  # Clears as MATCHED_EXACT
    engine_match.run_match(inv_b.id)  # Caught as EXCEPTION: QTY_BILLED_EXCEEDS_RECEIVED ($3,000 saved!)
    engine_match.run_match(inv_c.id)  # Caught as EXCEPTION: PRICE_HIGHER ($70 saved!)

    tenant_id = tenant.id
    print("Demonstration seed data successfully populated!")
    db.close()
    return tenant_id

if __name__ == "__main__":
    seed_database()
