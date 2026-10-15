import io
import csv
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Invoice

router = APIRouter(prefix="/exports", tags=["Accounting Exports"])

@router.get("/accounting")
def export_accounting_csv(
    format: str = Query("quickbooks", pattern="^(quickbooks|xero|tally)$"),
    db: Session = Depends(get_db)
):
    """Exports approved invoices into standard accounting import formats"""
    invoices = db.query(Invoice).filter(Invoice.status.in_(["MATCHED", "APPROVED", "EXPORTED"])).all()

    output = io.StringIO()
    writer = csv.writer(output)

    if format == "quickbooks":
        writer.writerow(["Bill No", "Vendor", "Bill Date", "Due Date", "Terms", "Account", "Line Description", "Line Amount", "Line Billable Status"])
        for inv in invoices:
            v_name = inv.vendor.name if inv.vendor else "Vendor"
            terms = f"Net {inv.vendor.payment_terms_days}" if inv.vendor else "Net 30"
            date_str = inv.invoice_date.strftime("%m/%d/%Y") if inv.invoice_date else "03/15/2026"
            due_str = inv.due_date.strftime("%m/%d/%Y") if inv.due_date else "04/14/2026"
            acct = inv.vendor.gl_account_code if inv.vendor and inv.vendor.gl_account_code else "5000-COGS"
            for line in inv.lines:
                writer.writerow([inv.invoice_number, v_name, date_str, due_str, terms, acct, line.description, line.line_total, "NotBillable"])

    elif format == "xero":
        writer.writerow(["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Total", "*Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType"])
        for inv in invoices:
            v_name = inv.vendor.name if inv.vendor else "Vendor"
            date_str = inv.invoice_date.strftime("%d/%m/%Y") if inv.invoice_date else "15/03/2026"
            due_str = inv.due_date.strftime("%d/%m/%Y") if inv.due_date else "14/04/2026"
            acct = "300"
            for line in inv.lines:
                writer.writerow([v_name, inv.invoice_number, date_str, due_str, inv.grand_total, line.description, line.quantity, line.unit_price, acct, "Tax on Purchases"])

    else:  # tally
        writer.writerow(["VoucherType", "InvoiceNo", "Date", "PartyLedger", "PurchaseLedger", "ItemName", "Quantity", "Rate", "Amount"])
        for inv in invoices:
            v_name = inv.vendor.name if inv.vendor else "Vendor"
            date_str = inv.invoice_date.strftime("%Y%m%d") if inv.invoice_date else "20260315"
            for line in inv.lines:
                writer.writerow(["Purchase", inv.invoice_number, date_str, v_name, "Purchase Account", line.item_code or line.description, line.quantity, line.unit_price, line.line_total])

    content = output.getvalue()
    filename = f"matchpay_export_{format}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
