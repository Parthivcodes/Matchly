const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../models/PurchaseOrder');
const Vendor = require('../models/Vendor');

router.get('/', async (req, res) => {
  try {
    const pos = await PurchaseOrder.find().sort({ orderDate: -1 });
    const vendors = await Vendor.find();
    const vendorMap = new Map(vendors.map(v => [v._id.toString(), v.name]));

    const formatted = pos.map(p => ({
      id: p._id,
      po_number: p.poNumber,
      vendor_id: p.vendorId,
      vendor_name: vendorMap.get(p.vendorId ? p.vendorId.toString() : '') || 'Vendor',
      order_date: p.orderDate,
      currency: p.currency,
      total_amount: p.totalAmount,
      status: p.status,
      lines: p.lines.map(l => ({
        id: l._id,
        po_id: p._id,
        line_number: l.lineNumber,
        item_code: l.itemCode,
        description: l.description,
        ordered_qty: l.orderedQty,
        uom: l.uom,
        unit_price: l.unitPrice,
        tax_rate_pct: l.taxRatePct,
        line_total: l.lineTotal
      }))
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
