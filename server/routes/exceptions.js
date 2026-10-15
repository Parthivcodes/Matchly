const express = require('express');
const router = express.Router();
const Exception = require('../models/Exception');
const Invoice = require('../models/Invoice');
const AuditLog = require('../models/AuditLog');

router.get('/', async (req, res) => {
  try {
    const exceptions = await Exception.find().sort({ createdAt: -1 });
    res.json(exceptions.map(exc => ({
      id: exc._id,
      invoice_id: exc.invoiceId,
      invoice_number: exc.invoiceNumber,
      vendor_name: exc.vendorName,
      reason_code: exc.reasonCode,
      status: exc.status,
      severity: exc.severity,
      message: exc.message,
      sla_due_at: exc.slaDueAt,
      override_reason: exc.overrideReason,
      resolved_at: exc.resolvedAt
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/resolve', async (req, res) => {
  try {
    const { override_reason, action } = req.body;
    const exc = await Exception.findById(req.params.id);
    if (!exc) return res.status(404).json({ detail: 'Exception not found' });

    const invoice = await Invoice.findById(exc.invoiceId);

    if (action === 'APPROVE') {
      exc.status = 'OVERRIDDEN';
      exc.overrideReason = override_reason;
      exc.resolvedAt = new Date();
      if (invoice) {
        invoice.status = 'APPROVED';
        await invoice.save();
      }
    } else {
      exc.status = 'REJECTED';
      exc.overrideReason = override_reason;
      exc.resolvedAt = new Date();
      if (invoice) {
        invoice.status = 'REJECTED';
        await invoice.save();
      }
    }

    await exc.save();

    // Create immutable audit log
    await AuditLog.create({
      tenantId: exc.tenantId,
      action: action === 'APPROVE' ? 'OVERRIDE_APPROVE' : 'EXCEPTION_REJECT',
      entityType: 'EXCEPTION',
      entityId: exc._id.toString(),
      beforeState: { status: 'OPEN' },
      afterState: { status: exc.status, reason: override_reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      message: `Exception ${exc.status.toLowerCase()} successfully`,
      exception_id: exc._id,
      invoice_status: invoice ? invoice.status : 'UNKNOWN'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
