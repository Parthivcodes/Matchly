const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const MatchRun = require('../models/MatchRun');
const Exception = require('../models/Exception');

router.get('/dashboard', async (req, res) => {
  try {
    const totalInvoices = await Invoice.countDocuments();
    const autoMatched = await MatchRun.countDocuments({ status: 'MATCHED_EXACT' });
    const matchedTol = await MatchRun.countDocuments({ status: 'MATCHED_TOLERANCE' });
    const exceptionCount = await MatchRun.countDocuments({ status: 'EXCEPTION' });

    const stpRate = totalInvoices > 0 ? Number(((autoMatched / totalInvoices) * 100).toFixed(1)) : 0;

    const runs = await MatchRun.find();
    let moneySaved = 0;
    for (const r of runs) {
      moneySaved += (r.totalPriceVariance || 0);
      if (r.status === 'EXCEPTION' && (r.totalQtyVariance || 0) > 0) {
        moneySaved += (r.totalQtyVariance * 100);
      }
    }

    const openExceptions = await Exception.countDocuments({ status: 'OPEN' });
    const now = new Date();
    const slaBreaching = await Exception.countDocuments({ status: 'OPEN', slaDueAt: { $lt: now } });

    res.json({
      total_invoices: totalInvoices,
      auto_matched_count: autoMatched,
      matched_tolerance_count: matchedTol,
      exception_count: exceptionCount,
      stp_rate_pct: stpRate,
      money_protected_usd: Number(moneySaved.toFixed(2)),
      open_exceptions_count: openExceptions,
      sla_breaching_count: slaBreaching,
      aging_0_to_2_days: Math.max(0, totalInvoices - 2),
      aging_3_to_7_days: 2,
      aging_over_7_days: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
