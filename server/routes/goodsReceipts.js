const express = require('express');
const router = express.Router();
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');

router.get('/', async (req, res) => {
  try {
    const grns = await GoodsReceipt.find().sort({ receivedDate: -1 });
    res.json(grns.map(g => ({
      id: g._id,
      grn_number: g.grnNumber,
      po_id: g.poId,
      po_number: g.poNumber,
      received_date: g.receivedDate,
      warehouse_location: g.warehouseLocation,
      received_by: g.receivedBy,
      lines: g.lines.map(l => ({
        id: l._id,
        grn_id: g._id,
        po_line_id: l.poLineNumber,
        item_code: l.itemCode,
        received_qty: l.receivedQty,
        rejected_qty: l.rejectedQty,
        rejection_notes: l.rejectionNotes
      }))
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick Digital Receiving by Dock Staff
router.post('/quick-receive', async (req, res) => {
  try {
    const { po_id, warehouse_location, received_by, items } = req.body;
    const po = await PurchaseOrder.findById(po_id);
    if (!po) return res.status(404).json({ detail: 'PO not found' });

    const grnCount = await GoodsReceipt.countDocuments();
    const grnNumber = `GRN-${grnCount + 8900}`;

    const grn = new GoodsReceipt({
      tenantId: po.tenantId,
      poId: po._id,
      poNumber: po.poNumber,
      grnNumber,
      receivedDate: new Date(),
      warehouseLocation: warehouse_location || 'MAIN DOCK 4',
      receivedBy: received_by || 'Carlos Mendoza',
      lines: items.map((item, idx) => ({
        poLineNumber: idx + 1,
        itemCode: item.item_code,
        receivedQty: Number(item.received_qty) || 0,
        rejectedQty: Number(item.rejected_qty) || 0,
        rejectionNotes: item.notes || ''
      }))
    });

    await grn.save();
    res.json({
      id: grn._id,
      grn_number: grn.grnNumber,
      po_number: grn.poNumber,
      received_date: grn.receivedDate,
      lines: grn.lines
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
