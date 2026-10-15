const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Vendor = require('../models/Vendor');

router.get('/accounting', async (req, res) => {
  try {
    const format = req.query.format || 'quickbooks';
    const invoices = await Invoice.find({ status: { $in: ['MATCHED', 'APPROVED', 'EXPORTED'] } });
    const vendors = await Vendor.find();
    const vendorMap = new Map(vendors.map(v => [v._id.toString(), v]));

    let csv = '';

    if (format === 'quickbooks') {
      csv = 'Bill No,Vendor,Bill Date,Due Date,Terms,Account,Line Description,Line Amount,Line Billable Status\n';
      for (const inv of invoices) {
        const v = vendorMap.get(inv.vendorId ? inv.vendorId.toString() : '');
        const vName = v ? v.name : 'Vendor';
        const terms = v ? `Net ${v.paymentTermsDays}` : 'Net 30';
        const dStr = inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : '2026-03-15';
        const dueStr = inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : '2026-04-14';
        const acct = v ? v.glAccountCode : '5000-COGS';
        for (const l of inv.lines) {
          csv += `"${inv.invoiceNumber}","${vName}","${dStr}","${dueStr}","${terms}","${acct}","${l.description}",${l.lineTotal},"NotBillable"\n`;
        }
      }
    } else if (format === 'xero') {
      csv = '*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Total,*Description,*Quantity,*UnitAmount,*AccountCode,*TaxType\n';
      for (const inv of invoices) {
        const v = vendorMap.get(inv.vendorId ? inv.vendorId.toString() : '');
        const vName = v ? v.name : 'Vendor';
        const dStr = inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : '2026-03-15';
        const dueStr = inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : '2026-04-14';
        for (const l of inv.lines) {
          csv += `"${vName}","${inv.invoiceNumber}","${dStr}","${dueStr}",${inv.grandTotal},"${l.description}",${l.quantity},${l.unitPrice},"300","Tax on Purchases"\n`;
        }
      }
    } else { // tally
      csv = 'VoucherType,InvoiceNo,Date,PartyLedger,PurchaseLedger,ItemName,Quantity,Rate,Amount\n';
      for (const inv of invoices) {
        const v = vendorMap.get(inv.vendorId ? inv.vendorId.toString() : '');
        const vName = v ? v.name : 'Vendor';
        const dStr = inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10).replace(/-/g, '') : '20260315';
        for (const l of inv.lines) {
          csv += `"Purchase","${inv.invoiceNumber}","${dStr}","${vName}","Purchase Account","${l.itemCode || l.description}",${l.quantity},${l.unitPrice},${l.lineTotal}\n`;
        }
      }
    }

    const filename = `matchly_export_${format}_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
