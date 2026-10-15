import re
from datetime import datetime, timedelta
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy.orm import Session
from rapidfuzz import fuzz

from backend.app.models import (
    Invoice, InvoiceLine, PurchaseOrder, POLine,
    GoodsReceipt, GRNLine, MatchRun, MatchLineResult,
    ExceptionRecord, ToleranceRule, Vendor
)

def normalize_invoice_number(raw_num: str) -> str:
    """Normalize invoice number by removing punctuation, spaces, and leading zeroes."""
    if not raw_num:
        return ""
    cleaned = re.sub(r'[\s\-_/\\.]', '', raw_num).upper()
    # Strip leading zeroes after any alphabetic prefix, e.g. INV00192 -> INV192, or 000456 -> 456
    cleaned = re.sub(r'(^[A-Z]*)0+(\d+)', r'\1\2', cleaned)
    return cleaned

class MatchingEngine:
    def __init__(self, db: Session, tenant_id: str):
        self.db = db
        self.tenant_id = tenant_id

    def run_match(self, invoice_id: str) -> MatchRun:
        """
        Executes deterministic 3-way matching on the invoice.
        Creates MatchRun, MatchLineResult records, and Exception records if needed.
        """
        invoice = self.db.query(Invoice).filter(
            Invoice.id == invoice_id,
            Invoice.tenant_id == self.tenant_id
        ).first()

        if not invoice:
            raise ValueError(f"Invoice {invoice_id} not found.")

        # Clear any prior match runs and exceptions for this invoice
        self.db.query(MatchLineResult).filter(MatchLineResult.tenant_id == self.tenant_id).filter(
            MatchLineResult.match_run_id.in_(
                self.db.query(MatchRun.id).filter(MatchRun.invoice_id == invoice.id)
            )
        ).delete(synchronize_session=False)

        self.db.query(MatchRun).filter(
            MatchRun.invoice_id == invoice.id,
            MatchRun.tenant_id == self.tenant_id
        ).delete(synchronize_session=False)

        self.db.query(ExceptionRecord).filter(
            ExceptionRecord.invoice_id == invoice.id,
            ExceptionRecord.tenant_id == self.tenant_id
        ).delete(synchronize_session=False)

        # 1. Duplicate Detection Check
        dup_code, dup_msg = self._check_duplicate(invoice)
        if dup_code:
            match_run = MatchRun(
                tenant_id=self.tenant_id,
                invoice_id=invoice.id,
                po_id=invoice.po_id,
                status="EXCEPTION",
                rules_applied_json={"duplicate_check": dup_code},
                total_price_variance=0.0,
                total_qty_variance=0.0
            )
            self.db.add(match_run)
            self.db.flush()

            self._create_exception(
                invoice=invoice,
                match_run=match_run,
                reason_code=dup_code,
                message=dup_msg,
                severity="CRITICAL" if dup_code == "DUPLICATE_EXACT" else "HIGH"
            )
            invoice.status = "UNDER_REVIEW"
            self.db.commit()
            return match_run

        # 2. PO Resolution
        po = self._resolve_po(invoice)
        if not po:
            match_run = MatchRun(
                tenant_id=self.tenant_id,
                invoice_id=invoice.id,
                po_id=None,
                status="EXCEPTION",
                rules_applied_json={"po_resolution": "FAILED"},
                total_price_variance=0.0,
                total_qty_variance=0.0
            )
            self.db.add(match_run)
            self.db.flush()

            self._create_exception(
                invoice=invoice,
                match_run=match_run,
                reason_code="PO_NOT_FOUND",
                message=f"No matching Purchase Order found for reference '{invoice.po_reference}'.",
                severity="HIGH"
            )
            invoice.status = "UNDER_REVIEW"
            self.db.commit()
            return match_run

        invoice.po_id = po.id

        # 3. Currency Check
        if invoice.currency != po.currency:
            match_run = MatchRun(
                tenant_id=self.tenant_id,
                invoice_id=invoice.id,
                po_id=po.id,
                status="EXCEPTION",
                rules_applied_json={"currency_check": "FAILED"},
                total_price_variance=0.0,
                total_qty_variance=0.0
            )
            self.db.add(match_run)
            self.db.flush()

            self._create_exception(
                invoice=invoice,
                match_run=match_run,
                reason_code="CURRENCY_MISMATCH",
                message=f"Invoice currency ({invoice.currency}) does not match PO currency ({po.currency}).",
                severity="HIGH"
            )
            invoice.status = "UNDER_REVIEW"
            self.db.commit()
            return match_run

        # 4. Resolve Tolerances (Vendor override > Tenant default)
        tolerances = self._resolve_tolerances(invoice.vendor_id)

        # 5. Line-by-Line 3-Way Matching
        match_run = MatchRun(
            tenant_id=self.tenant_id,
            invoice_id=invoice.id,
            po_id=po.id,
            status="PENDING",
            rules_applied_json={
                "price_tolerance_pct": tolerances.price_tolerance_pct,
                "price_tolerance_abs": tolerances.price_tolerance_abs,
                "qty_tolerance_pct": tolerances.qty_tolerance_pct,
                "qty_tolerance_abs": tolerances.qty_tolerance_abs,
                "is_stricter_rule": tolerances.is_stricter_rule
            },
            total_price_variance=0.0,
            total_qty_variance=0.0
        )
        self.db.add(match_run)
        self.db.flush()

        po_lines = self.db.query(POLine).filter(
            POLine.po_id == po.id,
            POLine.tenant_id == self.tenant_id
        ).all()

        any_exception = False
        any_tolerance_used = False
        total_price_var = 0.0
        total_qty_var = 0.0

        for inv_line in invoice.lines:
            matched_po_line = self._map_line(inv_line, po_lines)
            if not matched_po_line:
                any_exception = True
                line_res = MatchLineResult(
                    tenant_id=self.tenant_id,
                    match_run_id=match_run.id,
                    invoice_line_id=inv_line.id,
                    po_line_id=None,
                    is_matched=False,
                    used_tolerance=False,
                    billable_qty=0.0,
                    invoiced_qty=inv_line.quantity,
                    qty_variance=inv_line.quantity,
                    po_unit_price=0.0,
                    invoiced_unit_price=inv_line.unit_price,
                    price_variance=0.0,
                    exception_code="ITEM_NOT_ON_PO",
                    message=f"Invoice line '{inv_line.description}' does not map to any line on PO {po.po_number}."
                )
                self.db.add(line_res)
                self._create_exception(
                    invoice=invoice,
                    match_run=match_run,
                    reason_code="ITEM_NOT_ON_PO",
                    message=line_res.message
                )
                continue

            inv_line.po_line_id = matched_po_line.id

            # Calculate cumulative received quantity across ALL GRNs for this PO line
            total_grn_qty = self._get_cumulative_grn_qty(matched_po_line.id)

            # Calculate cumulative invoiced quantity on already approved/matched invoices for this PO line
            prior_invoiced_qty = self._get_prior_invoiced_qty(matched_po_line.id, exclude_invoice_id=invoice.id)

            # Billable quantity = received - already invoiced
            billable_qty = max(0.0, total_grn_qty - prior_invoiced_qty)

            # Step 5A: GRN Existence Check
            if total_grn_qty <= 0.0:
                any_exception = True
                line_res = MatchLineResult(
                    tenant_id=self.tenant_id,
                    match_run_id=match_run.id,
                    invoice_line_id=inv_line.id,
                    po_line_id=matched_po_line.id,
                    is_matched=False,
                    used_tolerance=False,
                    billable_qty=0.0,
                    invoiced_qty=inv_line.quantity,
                    qty_variance=inv_line.quantity,
                    po_unit_price=matched_po_line.unit_price,
                    invoiced_unit_price=inv_line.unit_price,
                    price_variance=round(inv_line.unit_price - matched_po_line.unit_price, 4),
                    exception_code="GRN_MISSING",
                    message=f"No Goods Receipt (GRN) found for item '{matched_po_line.item_code}' on PO {po.po_number}."
                )
                self.db.add(line_res)
                self._create_exception(
                    invoice=invoice,
                    match_run=match_run,
                    reason_code="GRN_MISSING",
                    message=line_res.message
                )
                continue

            # Step 5B: Quantity Reconciliation
            qty_variance = round(inv_line.quantity - billable_qty, 4)
            qty_passed = False
            qty_used_tol = False

            # Check if total invoiced exceeds original PO ordered quantity
            if (prior_invoiced_qty + inv_line.quantity) > (matched_po_line.ordered_qty * (1.0 + tolerances.qty_tolerance_pct / 100.0)):
                any_exception = True
                line_res = MatchLineResult(
                    tenant_id=self.tenant_id,
                    match_run_id=match_run.id,
                    invoice_line_id=inv_line.id,
                    po_line_id=matched_po_line.id,
                    is_matched=False,
                    used_tolerance=False,
                    billable_qty=billable_qty,
                    invoiced_qty=inv_line.quantity,
                    qty_variance=qty_variance,
                    po_unit_price=matched_po_line.unit_price,
                    invoiced_unit_price=inv_line.unit_price,
                    price_variance=round(inv_line.unit_price - matched_po_line.unit_price, 4),
                    exception_code="QTY_BILLED_EXCEEDS_ORDERED",
                    message=f"Cumulative billed qty ({prior_invoiced_qty + inv_line.quantity}) exceeds ordered qty ({matched_po_line.ordered_qty})."
                )
                self.db.add(line_res)
                self._create_exception(
                    invoice=invoice,
                    match_run=match_run,
                    reason_code="QTY_BILLED_EXCEEDS_ORDERED",
                    message=line_res.message
                )
                continue

            if qty_variance <= 0.0:
                qty_passed = True
            else:
                # Billed more than billable received qty -> check tolerance
                allowed_qty_pct = billable_qty * (tolerances.qty_tolerance_pct / 100.0)
                within_pct = qty_variance <= allowed_qty_pct
                within_abs = qty_variance <= tolerances.qty_tolerance_abs

                if (within_pct and within_abs) if tolerances.is_stricter_rule else (within_pct or within_abs):
                    qty_passed = True
                    qty_used_tol = True

            if not qty_passed:
                any_exception = True
                line_res = MatchLineResult(
                    tenant_id=self.tenant_id,
                    match_run_id=match_run.id,
                    invoice_line_id=inv_line.id,
                    po_line_id=matched_po_line.id,
                    is_matched=False,
                    used_tolerance=False,
                    billable_qty=billable_qty,
                    invoiced_qty=inv_line.quantity,
                    qty_variance=qty_variance,
                    po_unit_price=matched_po_line.unit_price,
                    invoiced_unit_price=inv_line.unit_price,
                    price_variance=round(inv_line.unit_price - matched_po_line.unit_price, 4),
                    exception_code="QTY_BILLED_EXCEEDS_RECEIVED",
                    message=f"Invoiced qty {inv_line.quantity} exceeds billable received qty {billable_qty} (variance: +{qty_variance})."
                )
                self.db.add(line_res)
                self._create_exception(
                    invoice=invoice,
                    match_run=match_run,
                    reason_code="QTY_BILLED_EXCEEDS_RECEIVED",
                    message=line_res.message
                )
                continue

            # Step 5C: Unit Price Reconciliation
            price_variance = round(inv_line.unit_price - matched_po_line.unit_price, 4)
            price_passed = False
            price_used_tol = False

            if price_variance <= 0.0:
                # Invoiced unit price is <= PO agreed unit price -> Pass!
                price_passed = True
            else:
                # Billed unit price is higher -> check tolerance
                allowed_price_pct = matched_po_line.unit_price * (tolerances.price_tolerance_pct / 100.0)
                within_pct = price_variance <= allowed_price_pct
                within_abs = price_variance <= tolerances.price_tolerance_abs

                if (within_pct and within_abs) if tolerances.is_stricter_rule else (within_pct or within_abs):
                    price_passed = True
                    price_used_tol = True

            if not price_passed:
                any_exception = True
                line_res = MatchLineResult(
                    tenant_id=self.tenant_id,
                    match_run_id=match_run.id,
                    invoice_line_id=inv_line.id,
                    po_line_id=matched_po_line.id,
                    is_matched=False,
                    used_tolerance=False,
                    billable_qty=billable_qty,
                    invoiced_qty=inv_line.quantity,
                    qty_variance=qty_variance,
                    po_unit_price=matched_po_line.unit_price,
                    invoiced_unit_price=inv_line.unit_price,
                    price_variance=price_variance,
                    exception_code="PRICE_HIGHER",
                    message=f"Invoiced price ${inv_line.unit_price} exceeds PO price ${matched_po_line.unit_price} (variance: +${price_variance})."
                )
                self.db.add(line_res)
                self._create_exception(
                    invoice=invoice,
                    match_run=match_run,
                    reason_code="PRICE_HIGHER",
                    message=line_res.message
                )
                continue

            # Line completely matched!
            line_used_tol = qty_used_tol or price_used_tol
            if line_used_tol:
                any_tolerance_used = True

            total_price_var += max(0.0, price_variance * inv_line.quantity)
            total_qty_var += max(0.0, qty_variance)

            line_res = MatchLineResult(
                tenant_id=self.tenant_id,
                match_run_id=match_run.id,
                invoice_line_id=inv_line.id,
                po_line_id=matched_po_line.id,
                is_matched=True,
                used_tolerance=line_used_tol,
                billable_qty=billable_qty,
                invoiced_qty=inv_line.quantity,
                qty_variance=qty_variance,
                po_unit_price=matched_po_line.unit_price,
                invoiced_unit_price=inv_line.unit_price,
                price_variance=price_variance,
                exception_code=None,
                message=None
            )
            self.db.add(line_res)

        # 6. Set Final MatchRun Status
        match_run.total_price_variance = round(total_price_var, 2)
        match_run.total_qty_variance = round(total_qty_var, 2)

        if any_exception:
            match_run.status = "EXCEPTION"
            invoice.status = "UNDER_REVIEW"
        elif any_tolerance_used:
            match_run.status = "MATCHED_TOLERANCE"
            invoice.status = "MATCHED"
        else:
            match_run.status = "MATCHED_EXACT"
            invoice.status = "MATCHED"

        self.db.commit()
        return match_run

    def _check_duplicate(self, invoice: Invoice) -> Tuple[Optional[str], Optional[str]]:
        # Level 1: Exact Hash / Normalized Duplicate Check
        existing_exact = self.db.query(Invoice).filter(
            Invoice.tenant_id == self.tenant_id,
            Invoice.id != invoice.id,
            Invoice.vendor_id == invoice.vendor_id,
            Invoice.normalized_invoice_number == invoice.normalized_invoice_number
        ).first()

        if existing_exact:
            return "DUPLICATE_EXACT", f"Exact duplicate of invoice #{existing_exact.invoice_number} (ID: {existing_exact.id})."

        # Level 2: Fuzzy Near-Duplicate Check (Same vendor, identical grand total within +-45 days)
        if invoice.invoice_date and invoice.vendor_id:
            start_date = invoice.invoice_date - timedelta(days=45)
            end_date = invoice.invoice_date + timedelta(days=45)

            suspects = self.db.query(Invoice).filter(
                Invoice.tenant_id == self.tenant_id,
                Invoice.id != invoice.id,
                Invoice.vendor_id == invoice.vendor_id,
                Invoice.invoice_date >= start_date,
                Invoice.invoice_date <= end_date
            ).all()

            for s in suspects:
                # Same amount check
                if abs(s.grand_total - invoice.grand_total) < 0.01:
                    return "DUPLICATE_SUSPECTED", f"Potential duplicate of invoice #{s.invoice_number} with identical amount ${invoice.grand_total:.2f} dated {s.invoice_date.strftime('%Y-%m-%d')}."

                # Levenshtein distance <= 1 on normalized invoice numbers
                dist = fuzz.ratio(invoice.normalized_invoice_number, s.normalized_invoice_number)
                if dist >= 90.0 and abs(s.grand_total - invoice.grand_total) < 5.0:
                    return "DUPLICATE_SUSPECTED", f"Potential duplicate of invoice #{s.invoice_number} (Levenshtein similarity: {dist:.0f}%)."

        return None, None

    def _resolve_po(self, invoice: Invoice) -> Optional[PurchaseOrder]:
        # Pass 1: Direct PO reference
        if invoice.po_reference:
            clean_ref = invoice.po_reference.strip().upper()
            po = self.db.query(PurchaseOrder).filter(
                PurchaseOrder.tenant_id == self.tenant_id,
                PurchaseOrder.po_number.ilike(clean_ref)
            ).first()
            if po:
                return po

        # Pass 2: Fallback to open PO by Vendor and Amount proximity (within 5%)
        if invoice.vendor_id:
            open_pos = self.db.query(PurchaseOrder).filter(
                PurchaseOrder.tenant_id == self.tenant_id,
                PurchaseOrder.vendor_id == invoice.vendor_id,
                PurchaseOrder.status.in_(["OPEN", "PARTIALLY_RECEIVED"])
            ).all()

            for p in open_pos:
                if abs(p.total_amount - invoice.grand_total) <= (p.total_amount * 0.05):
                    return p

        return None

    def _resolve_tolerances(self, vendor_id: Optional[str]) -> ToleranceRule:
        if vendor_id:
            vendor_rule = self.db.query(ToleranceRule).filter(
                ToleranceRule.tenant_id == self.tenant_id,
                ToleranceRule.vendor_id == vendor_id
            ).first()
            if vendor_rule:
                return vendor_rule

        # Fallback to Tenant Global Default
        default_rule = self.db.query(ToleranceRule).filter(
            ToleranceRule.tenant_id == self.tenant_id,
            ToleranceRule.vendor_id == None
        ).first()

        if default_rule:
            return default_rule

        # In-memory default if no DB rule configured
        return ToleranceRule(
            price_tolerance_pct=1.5,
            price_tolerance_abs=5.0,
            qty_tolerance_pct=0.0,
            qty_tolerance_abs=0.0,
            is_stricter_rule=False
        )

    def _map_line(self, inv_line: InvoiceLine, po_lines: List[POLine]) -> Optional[POLine]:
        # Pass 1: Exact Item Code match
        if inv_line.item_code:
            norm_code = inv_line.item_code.strip().upper()
            for pl in po_lines:
                if pl.item_code.strip().upper() == norm_code:
                    return pl

        # Pass 2: Fuzzy Token Sort Similarity on Description
        best_score = 0.0
        best_pl = None
        for pl in po_lines:
            score = fuzz.token_sort_ratio(inv_line.description.lower(), pl.description.lower())
            if score > best_score:
                best_score = score
                best_pl = pl

        if best_score >= 80.0:
            return best_pl

        return None

    def _get_cumulative_grn_qty(self, po_line_id: str) -> float:
        grn_lines = self.db.query(GRNLine).filter(
            GRNLine.po_line_id == po_line_id,
            GRNLine.tenant_id == self.tenant_id
        ).all()
        return sum(gl.received_qty for gl in grn_lines)

    def _get_prior_invoiced_qty(self, po_line_id: str, exclude_invoice_id: str) -> float:
        # Sum quantities on approved or matched invoices for this po_line_id
        prior_lines = self.db.query(InvoiceLine).join(Invoice).filter(
            InvoiceLine.po_line_id == po_line_id,
            InvoiceLine.tenant_id == self.tenant_id,
            Invoice.id != exclude_invoice_id,
            Invoice.status.in_(["MATCHED", "APPROVED", "EXPORTED"])
        ).all()
        return sum(il.quantity for il in prior_lines)

    def _create_exception(self, invoice: Invoice, match_run: MatchRun, reason_code: str, message: str, severity: str = "HIGH"):
        exc = ExceptionRecord(
            tenant_id=self.tenant_id,
            invoice_id=invoice.id,
            match_run_id=match_run.id if match_run else None,
            reason_code=reason_code,
            status="OPEN",
            severity=severity,
            message=message,
            sla_due_at=datetime.utcnow() + timedelta(days=3)
        )
        self.db.add(exc)
