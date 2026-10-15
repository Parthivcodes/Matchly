const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Vendor = require('../models/Vendor');
const PurchaseOrder = require('../models/PurchaseOrder');
const MatchRun = require('../models/MatchRun');
const { MatchingEngine, normalizeInvoiceNumber } = require('../services/matchingEngine');

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    const formatted = invoices.map(inv => ({
      id: inv._id,
      invoice_number: inv.invoiceNumber,
      vendor_id: inv.vendorId,
      vendor_name: inv.vendorName || 'Vendor',
      po_reference: inv.poReference,
      invoice_date: inv.invoiceDate,
      due_date: inv.dueDate,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax_total: inv.taxTotal,
      discount_total: inv.discountTotal,
      grand_total: inv.grandTotal,
      status: inv.status,
      extraction_confidence: inv.extractionConfidence,
      lines: inv.lines.map(l => ({
        id: l._id,
        invoice_id: inv._id,
        po_line_id: l.poLineNumber,
        line_number: l.lineNumber,
        item_code: l.itemCode,
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unit_price: l.unitPrice,
        tax_rate_pct: l.taxRatePct,
        tax_amount: l.taxAmount,
        line_total: l.lineTotal,
        confidence: l.confidence,
        bbox: l.bbox
      }))
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single invoice
router.get('/:id', async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ detail: 'Invoice not found' });
    res.json({
      id: inv._id,
      invoice_number: inv.invoiceNumber,
      vendor_id: inv.vendorId,
      vendor_name: inv.vendorName,
      po_reference: inv.poReference,
      invoice_date: inv.invoiceDate,
      due_date: inv.dueDate,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax_total: inv.taxTotal,
      discount_total: inv.discountTotal,
      grand_total: inv.grandTotal,
      status: inv.status,
      extraction_confidence: inv.extractionConfidence,
      lines: inv.lines.map(l => ({
        id: l._id,
        invoice_id: inv._id,
        po_line_id: l.poLineNumber,
        line_number: l.lineNumber,
        item_code: l.itemCode,
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unit_price: l.unitPrice,
        tax_rate_pct: l.taxRatePct,
        tax_amount: l.taxAmount,
        line_total: l.lineTotal,
        confidence: l.confidence,
        bbox: l.bbox
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload & simulated AI extraction
router.post('/upload', async (req, res) => {
  try {
    const vendor = await Vendor.findOne();
    const po = await PurchaseOrder.findOne();
    const invNum = `INV-${Date.now().toString().slice(-6)}`;

    const newInv = new Invoice({
      tenantId: vendor ? vendor.tenantId : null,
      vendorId: vendor ? vendor._id : null,
      vendorName: vendor ? vendor.name : 'Acme Industrial Supplies',
      poId: po ? po._id : null,
      poReference: po ? po.poNumber : 'PO-2026-001',
      invoiceNumber: invNum,
      normalizedInvoiceNumber: normalizeInvoiceNumber(invNum),
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: 'USD',
      subtotal: 600.0,
      taxTotal: 0.0,
      discountTotal: 0.0,
      grandTotal: 600.0,
      status: 'EXTRACTED',
      extractionConfidence: 0.94,
      lines: [
        {
          lineNumber: 1,
          itemCode: 'HEX-M8-50',
          description: 'Hex Bolt M8 50mm Grade 8.8 Galvanized',
          quantity: 1000,
          unitPrice: 0.45,
          lineTotal: 450.0,
          confidence: 0.98,
          bbox: [120, 45, 145, 950]
        },
        {
          lineNumber: 2,
          itemCode: 'NUT-M8-GALV',
          description: 'Steel Lock Nut M8 Galvanized DIN 985',
          quantity: 1000,
          unitPrice: 0.15,
          lineTotal: 150.0,
          confidence: 0.82,
          bbox: [150, 45, 175, 950]
        }
      ]
    });

    await newInv.save();
    res.json({ message: 'Invoice uploaded and extracted', invoice_id: newInv._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run 3-Way Match
router.post('/:id/match', async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ detail: 'Invoice not found' });

    const engine = new MatchingEngine(inv.tenantId);
    const matchRun = await engine.runMatch(inv._id);

    res.json({
      id: matchRun._id,
      invoice_id: matchRun.invoiceId,
      po_id: matchRun.poId,
      status: matchRun.status,
      total_price_variance: matchRun.totalPriceVariance,
      total_qty_variance: matchRun.totalQtyVariance,
      executed_at: matchRun.executedAt,
      line_results: matchRun.lineResults.map(lr => ({
        id: lr._id,
        invoice_line_id: lr.invoiceLineId,
        po_line_id: lr.poLineNumber,
        is_matched: lr.isMatched,
        used_tolerance: lr.usedTolerance,
        billable_qty: lr.billableQty,
        invoiced_qty: lr.invoicedQty,
        qty_variance: lr.qtyVariance,
        po_unit_price: lr.poUnitPrice,
        invoiced_unit_price: lr.invoicedUnitPrice,
        price_variance: lr.priceVariance,
        exception_code: lr.exceptionCode,
        message: lr.message
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get match result for an invoice
router.get('/:id/match-result', async (req, res) => {
  try {
    const matchRun = await MatchRun.findOne({ invoiceId: req.params.id }).sort({ executedAt: -1 });
    if (!matchRun) return res.status(404).json({ detail: 'No match run found' });

    res.json({
      id: matchRun._id,
      invoice_id: matchRun.invoiceId,
      po_id: matchRun.poId,
      status: matchRun.status,
      total_price_variance: matchRun.totalPriceVariance,
      total_qty_variance: matchRun.totalQtyVariance,
      executed_at: matchRun.executedAt,
      line_results: matchRun.lineResults.map(lr => ({
        id: lr._id,
        invoice_line_id: lr.invoiceLineId,
        po_line_id: lr.poLineNumber,
        is_matched: lr.isMatched,
        used_tolerance: lr.usedTolerance,
        billable_qty: lr.billableQty,
        invoiced_qty: lr.invoicedQty,
        qty_variance: lr.qtyVariance,
        po_unit_price: lr.poUnitPrice,
        invoiced_unit_price: lr.invoicedUnitPrice,
        price_variance: lr.priceVariance,
        exception_code: lr.exceptionCode,
        message: lr.message
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
