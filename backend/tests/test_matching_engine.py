import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import (
    Tenant, Vendor, PurchaseOrder, POLine,
    GoodsReceipt, GRNLine, Invoice, InvoiceLine,
    ToleranceRule, ExceptionRecord
)
from backend.app.matching_engine import MatchingEngine, normalize_invoice_number

@pytest.fixture
def db_session():
    # In-memory SQLite for super-fast, isolated testing
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Create test tenant
    tenant = Tenant(id="tenant-test-1", name="Apex Logistics Inc", slug="apex-logistics")
    session.add(tenant)

    # Global tolerance: 1.5% price, 0% qty
    global_tol = ToleranceRule(
        id="tol-global",
        tenant_id=tenant.id,
        vendor_id=None,
        price_tolerance_pct=1.5,
        price_tolerance_abs=5.0,
        qty_tolerance_pct=0.0,
        qty_tolerance_abs=0.0,
        is_stricter_rule=False
    )
    session.add(global_tol)

    # Create vendor
    vendor = Vendor(
        id="vend-acme",
        tenant_id=tenant.id,
        vendor_code="VEND-ACME",
        name="Acme Hardware Supply",
        currency="USD"
    )
    session.add(vendor)
    session.commit()

    yield session
    session.close()

def test_normalization():
    assert normalize_invoice_number("INV-00192") == "INV192"
    assert normalize_invoice_number("inv/0091") == "INV91"
    assert normalize_invoice_number("  INV_0005  ") == "INV5"
    assert normalize_invoice_number("000456") == "456"

def test_exact_3way_match(db_session):
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    # 1. PO: 100 units of Hex Bolt @ $2.00
    po = PurchaseOrder(
        id="po-1", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-1001", order_date=datetime.utcnow(), currency="USD", total_amount=200.0, status="OPEN"
    )
    db_session.add(po)
    po_line = POLine(
        id="pol-1", tenant_id=tenant_id, po_id=po.id, line_number=1,
        item_code="HEX-M8", description="Hex Bolt M8 50mm", ordered_qty=100.0, unit_price=2.00, line_total=200.0
    )
    db_session.add(po_line)

    # 2. GRN: 100 units received
    grn = GoodsReceipt(
        id="grn-1", tenant_id=tenant_id, po_id=po.id, grn_number="GRN-101",
        received_date=datetime.utcnow(), received_by="Carlos"
    )
    db_session.add(grn)
    grn_line = GRNLine(
        id="grnl-1", tenant_id=tenant_id, grn_id=grn.id, po_line_id=po_line.id,
        item_code="HEX-M8", received_qty=100.0
    )
    db_session.add(grn_line)

    # 3. Invoice: 100 units @ $2.00
    inv = Invoice(
        id="inv-1", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-5501", normalized_invoice_number=normalize_invoice_number("INV-5501"),
        po_reference="PO-1001", currency="USD", grand_total=200.0,
        file_s3_key="key1.pdf", file_hash_sha256="hash1", invoice_date=datetime.utcnow()
    )
    db_session.add(inv)
    inv_line = InvoiceLine(
        id="invl-1", tenant_id=tenant_id, invoice_id=inv.id, line_number=1,
        item_code="HEX-M8", description="Hex Bolt M8 50mm", quantity=100.0, unit_price=2.00, line_total=200.0
    )
    db_session.add(inv_line)
    db_session.commit()

    # Run match
    result = engine.run_match(inv.id)

    assert result.status == "MATCHED_EXACT"
    assert result.total_price_variance == 0.0
    assert result.total_qty_variance == 0.0
    assert len(result.line_results) == 1
    assert result.line_results[0].is_matched is True
    assert result.line_results[0].used_tolerance is False

def test_partial_delivery_and_multi_invoice(db_session):
    """
    Tests partial receipt and split billing:
    PO ordered = 100.
    Shipment 1: GRN received = 40.
    Invoice 1: billed = 40 -> Should MATCH.
    Invoice 2 (before next delivery): bills 60 -> Should FAIL with QTY_BILLED_EXCEEDS_RECEIVED.
    Shipment 2: GRN received = 60.
    Invoice 2 re-match -> Should MATCH!
    """
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    # PO: 100 units @ $10.00
    po = PurchaseOrder(
        id="po-part", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-PART-1", order_date=datetime.utcnow(), currency="USD", total_amount=1000.0, status="OPEN"
    )
    db_session.add(po)
    po_line = POLine(
        id="pol-part", tenant_id=tenant_id, po_id=po.id, line_number=1,
        item_code="WIDGET-X", description="Widget X Industrial", ordered_qty=100.0, unit_price=10.00, line_total=1000.0
    )
    db_session.add(po_line)

    # Shipment 1: 40 units received
    grn1 = GoodsReceipt(
        id="grn-p1", tenant_id=tenant_id, po_id=po.id, grn_number="GRN-P1",
        received_date=datetime.utcnow()
    )
    db_session.add(grn1)
    db_session.add(GRNLine(
        id="grnl-p1", tenant_id=tenant_id, grn_id=grn1.id, po_line_id=po_line.id,
        item_code="WIDGET-X", received_qty=40.0
    ))

    # Invoice 1: 40 units @ $10.00
    inv1 = Invoice(
        id="inv-p1", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-PART-1", normalized_invoice_number=normalize_invoice_number("INV-PART-1"),
        po_reference="PO-PART-1", currency="USD", grand_total=400.0,
        file_s3_key="k1", file_hash_sha256="h1", invoice_date=datetime.utcnow()
    )
    db_session.add(inv1)
    db_session.add(InvoiceLine(
        id="invl-p1", tenant_id=tenant_id, invoice_id=inv1.id, line_number=1,
        item_code="WIDGET-X", description="Widget X Industrial", quantity=40.0, unit_price=10.00, line_total=400.0
    ))
    db_session.commit()

    # Match Invoice 1 -> Must match exact
    res1 = engine.run_match(inv1.id)
    assert res1.status == "MATCHED_EXACT"

    # Invoice 2: 60 units @ $10.00 (arrives prematurely before shipment 2)
    inv2 = Invoice(
        id="inv-p2", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-PART-2", normalized_invoice_number=normalize_invoice_number("INV-PART-2"),
        po_reference="PO-PART-1", currency="USD", grand_total=600.0,
        file_s3_key="k2", file_hash_sha256="h2", invoice_date=datetime.utcnow()
    )
    db_session.add(inv2)
    db_session.add(InvoiceLine(
        id="invl-p2", tenant_id=tenant_id, invoice_id=inv2.id, line_number=1,
        item_code="WIDGET-X", description="Widget X Industrial", quantity=60.0, unit_price=10.00, line_total=600.0
    ))
    db_session.commit()

    # Match Invoice 2 -> Must fail with QTY_BILLED_EXCEEDS_RECEIVED because received(40) - prior_invoiced(40) = 0
    res2 = engine.run_match(inv2.id)
    assert res2.status == "EXCEPTION"
    assert res2.line_results[0].exception_code == "QTY_BILLED_EXCEEDS_RECEIVED"

    # Now Warehouse receives Shipment 2 of 60 units
    grn2 = GoodsReceipt(
        id="grn-p2", tenant_id=tenant_id, po_id=po.id, grn_number="GRN-P2",
        received_date=datetime.utcnow()
    )
    db_session.add(grn2)
    db_session.add(GRNLine(
        id="grnl-p2", tenant_id=tenant_id, grn_id=grn2.id, po_line_id=po_line.id,
        item_code="WIDGET-X", received_qty=60.0
    ))
    db_session.commit()

    # Re-match Invoice 2 -> Now total received is 100, prior invoiced is 40 -> billable = 60!
    res2_rematch = engine.run_match(inv2.id)
    assert res2_rematch.status == "MATCHED_EXACT"

def test_consolidated_grns(db_session):
    """Multiple GRNs delivered over time consolidated into 1 weekly invoice."""
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    po = PurchaseOrder(
        id="po-c", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-CONSOL", order_date=datetime.utcnow(), currency="USD", total_amount=500.0, status="OPEN"
    )
    db_session.add(po)
    po_line = POLine(
        id="pol-c", tenant_id=tenant_id, po_id=po.id, line_number=1,
        item_code="BOLT-C", description="Bolt Consolidation", ordered_qty=500.0, unit_price=1.00, line_total=500.0
    )
    db_session.add(po_line)

    # 3 separate delivery dockets
    for i, qty in enumerate([100.0, 150.0, 250.0], start=1):
        grn = GoodsReceipt(id=f"grn-c{i}", tenant_id=tenant_id, po_id=po.id, grn_number=f"GRN-C{i}", received_date=datetime.utcnow())
        db_session.add(grn)
        db_session.add(GRNLine(id=f"grnl-c{i}", tenant_id=tenant_id, grn_id=grn.id, po_line_id=po_line.id, item_code="BOLT-C", received_qty=qty))

    # Single invoice for 500
    inv = Invoice(
        id="inv-c", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-CONSOL", normalized_invoice_number="INVCONSOL",
        po_reference="PO-CONSOL", currency="USD", grand_total=500.0,
        file_s3_key="kc", file_hash_sha256="hc", invoice_date=datetime.utcnow()
    )
    db_session.add(inv)
    db_session.add(InvoiceLine(
        id="invl-c", tenant_id=tenant_id, invoice_id=inv.id, line_number=1,
        item_code="BOLT-C", description="Bolt Consolidation", quantity=500.0, unit_price=1.00, line_total=500.0
    ))
    db_session.commit()

    res = engine.run_match(inv.id)
    assert res.status == "MATCHED_EXACT"

def test_duplicate_exact_detection(db_session):
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    # Prior existing invoice
    existing_inv = Invoice(
        id="inv-dup-orig", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-9921", normalized_invoice_number="INV9921",
        po_reference="PO-X", currency="USD", grand_total=150.0,
        file_s3_key="k_orig", file_hash_sha256="h_orig", invoice_date=datetime.utcnow(), status="MATCHED"
    )
    db_session.add(existing_inv)

    # Duplicate incoming invoice with punctuation variation: "inv/9921" -> normalizes to "INV9921"
    new_inv = Invoice(
        id="inv-dup-copy", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="inv/9921", normalized_invoice_number=normalize_invoice_number("inv/9921"),
        po_reference="PO-X", currency="USD", grand_total=150.0,
        file_s3_key="k_copy", file_hash_sha256="h_copy", invoice_date=datetime.utcnow()
    )
    db_session.add(new_inv)
    db_session.commit()

    res = engine.run_match(new_inv.id)
    assert res.status == "EXCEPTION"
    exc = db_session.query(ExceptionRecord).filter(ExceptionRecord.invoice_id == new_inv.id).first()
    assert exc.reason_code == "DUPLICATE_EXACT"

def test_price_tolerance_boundary(db_session):
    """PO price = $100.00. Global tolerance = 1.5% ($1.50).
    Invoice at $101.00 (+1%) -> MATCHED_TOLERANCE.
    Invoice at $103.00 (+3% with strict 1% vendor rule) -> EXCEPTION: PRICE_HIGHER.
    """
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    # 1. Test Pass: PO price $100, Invoice price $101 (+1% <= 1.5% global tolerance)
    po_pass = PurchaseOrder(
        id="po-tol-pass", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-TOL-PASS", order_date=datetime.utcnow(), currency="USD", total_amount=100.0, status="OPEN"
    )
    db_session.add(po_pass)
    pol_pass = POLine(
        id="pol-tol-pass", tenant_id=tenant_id, po_id=po_pass.id, line_number=1,
        item_code="TOL-ITEM-1", description="Tolerant Item 1", ordered_qty=1.0, unit_price=100.00, line_total=100.0
    )
    db_session.add(pol_pass)

    grn_pass = GoodsReceipt(id="grn-tol-pass", tenant_id=tenant_id, po_id=po_pass.id, grn_number="GRN-TOL-P", received_date=datetime.utcnow())
    db_session.add(grn_pass)
    db_session.add(GRNLine(id="grnl-tol-pass", tenant_id=tenant_id, grn_id=grn_pass.id, po_line_id=pol_pass.id, item_code="TOL-ITEM-1", received_qty=1.0))

    inv_pass = Invoice(
        id="inv-tol-pass", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-TOL-PASS", normalized_invoice_number="INVTOLPASS",
        po_reference="PO-TOL-PASS", currency="USD", grand_total=101.0,
        file_s3_key="k_pass", file_hash_sha256="h_pass", invoice_date=datetime.utcnow()
    )
    db_session.add(inv_pass)
    db_session.add(InvoiceLine(
        id="invl-tol-pass", tenant_id=tenant_id, invoice_id=inv_pass.id, line_number=1,
        item_code="TOL-ITEM-1", description="Tolerant Item 1", quantity=1.0, unit_price=101.00, line_total=101.0
    ))
    db_session.commit()

    res_pass = engine.run_match(inv_pass.id)
    assert res_pass.status == "MATCHED_TOLERANCE"
    assert res_pass.line_results[0].used_tolerance is True

    # 2. Test Fail: Create a strict vendor with 0% price tolerance
    vendor_strict = Vendor(
        id="vend-strict", tenant_id=tenant_id, vendor_code="VEND-STRICT",
        name="Strict Vendor Corp", currency="USD"
    )
    db_session.add(vendor_strict)
    vendor_rule = ToleranceRule(
        id="tol-strict",
        tenant_id=tenant_id,
        vendor_id=vendor_strict.id,
        price_tolerance_pct=0.0,
        price_tolerance_abs=0.0,
        qty_tolerance_pct=0.0,
        qty_tolerance_abs=0.0,
        is_stricter_rule=True
    )
    db_session.add(vendor_rule)

    po_fail = PurchaseOrder(
        id="po-tol-fail", tenant_id=tenant_id, vendor_id=vendor_strict.id,
        po_number="PO-TOL-FAIL", order_date=datetime.utcnow(), currency="USD", total_amount=100.0, status="OPEN"
    )
    db_session.add(po_fail)
    pol_fail = POLine(
        id="pol-tol-fail", tenant_id=tenant_id, po_id=po_fail.id, line_number=1,
        item_code="TOL-ITEM-2", description="Tolerant Item 2", ordered_qty=1.0, unit_price=100.00, line_total=100.0
    )
    db_session.add(pol_fail)

    grn_fail = GoodsReceipt(id="grn-tol-fail", tenant_id=tenant_id, po_id=po_fail.id, grn_number="GRN-TOL-F", received_date=datetime.utcnow())
    db_session.add(grn_fail)
    db_session.add(GRNLine(id="grnl-tol-fail", tenant_id=tenant_id, grn_id=grn_fail.id, po_line_id=pol_fail.id, item_code="TOL-ITEM-2", received_qty=1.0))

    inv_fail = Invoice(
        id="inv-tol-fail", tenant_id=tenant_id, vendor_id=vendor_strict.id,
        invoice_number="INV-TOL-FAIL", normalized_invoice_number="INVTOLFAIL",
        po_reference="PO-TOL-FAIL", currency="USD", grand_total=103.0,
        file_s3_key="k_fail", file_hash_sha256="h_fail", invoice_date=datetime.utcnow()
    )
    db_session.add(inv_fail)
    db_session.add(InvoiceLine(
        id="invl-tol-fail", tenant_id=tenant_id, invoice_id=inv_fail.id, line_number=1,
        item_code="TOL-ITEM-2", description="Tolerant Item 2", quantity=1.0, unit_price=103.00, line_total=103.0
    ))
    db_session.commit()

    res_fail = engine.run_match(inv_fail.id)
    assert res_fail.status == "EXCEPTION"
    assert res_fail.line_results[0].exception_code == "PRICE_HIGHER"

def test_currency_mismatch(db_session):
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    po = PurchaseOrder(
        id="po-curr", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-CURR", order_date=datetime.utcnow(), currency="USD", total_amount=100.0, status="OPEN"
    )
    db_session.add(po)

    inv = Invoice(
        id="inv-curr", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-EUR-1", normalized_invoice_number="INVEUR1",
        po_reference="PO-CURR", currency="EUR", grand_total=100.0,
        file_s3_key="k_curr", file_hash_sha256="h_curr", invoice_date=datetime.utcnow()
    )
    db_session.add(inv)
    db_session.commit()

    res = engine.run_match(inv.id)
    assert res.status == "EXCEPTION"
    exc = db_session.query(ExceptionRecord).filter(ExceptionRecord.invoice_id == inv.id).first()
    assert exc.reason_code == "CURRENCY_MISMATCH"

def test_grn_missing(db_session):
    tenant_id = "tenant-test-1"
    engine = MatchingEngine(db_session, tenant_id)

    # PO exists, but 0 GRNs exist
    po = PurchaseOrder(
        id="po-nogrn", tenant_id=tenant_id, vendor_id="vend-acme",
        po_number="PO-NOGRN", order_date=datetime.utcnow(), currency="USD", total_amount=50.0, status="OPEN"
    )
    db_session.add(po)
    po_line = POLine(
        id="pol-nogrn", tenant_id=tenant_id, po_id=po.id, line_number=1,
        item_code="NOGRN-1", description="Item with no receipt", ordered_qty=5.0, unit_price=10.0, line_total=50.0
    )
    db_session.add(po_line)

    inv = Invoice(
        id="inv-nogrn", tenant_id=tenant_id, vendor_id="vend-acme",
        invoice_number="INV-NOGRN", normalized_invoice_number="INVNOGRN",
        po_reference="PO-NOGRN", currency="USD", grand_total=50.0,
        file_s3_key="k_nogrn", file_hash_sha256="h_nogrn", invoice_date=datetime.utcnow()
    )
    db_session.add(inv)
    db_session.add(InvoiceLine(
        id="invl-nogrn", tenant_id=tenant_id, invoice_id=inv.id, line_number=1,
        item_code="NOGRN-1", description="Item with no receipt", quantity=5.0, unit_price=10.0, line_total=50.0
    ))
    db_session.commit()

    res = engine.run_match(inv.id)
    assert res.status == "EXCEPTION"
    assert res.line_results[0].exception_code == "GRN_MISSING"
