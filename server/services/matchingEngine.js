const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const Invoice = require('../models/Invoice');
const MatchRun = require('../models/MatchRun');
const Exception = require('../models/Exception');
const ToleranceRule = require('../models/ToleranceRule');

function normalizeInvoiceNumber(raw) {
  if (!raw) return '';
  let cleaned = raw.replace(/[\s\-_/\\.]/g, '').toUpperCase();
  cleaned = cleaned.replace(/(^[A-Z]*)0+(\d+)/, '$1$2');
  return cleaned;
}

function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function tokenSortRatio(str1, str2) {
  if (!str1 || !str2) return 0;
  const clean1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).sort().join(' ');
  const clean2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).sort().join(' ');
  if (clean1 === clean2) return 100;
  const dist = levenshteinDistance(clean1, clean2);
  const maxLen = Math.max(clean1.length, clean2.length);
  return Math.round(((maxLen - dist) / maxLen) * 100);
}

function mapLineToPO(invLine, poLines) {
  // Pass 1: exact itemCode match
  if (invLine.itemCode) {
    const normCode = invLine.itemCode.trim().toUpperCase();
    const match = poLines.find(p => p.itemCode.trim().toUpperCase() === normCode);
    if (match) return match;
  }

  // Pass 2: tokenSortRatio on description
  let bestScore = 0;
  let bestLine = null;
  for (const p of poLines) {
    const score = tokenSortRatio(invLine.description, p.description);
    if (score > bestScore) {
      bestScore = score;
      bestLine = p;
    }
  }

  if (bestScore >= 80) return bestLine;
  return null;
}

/**
 * Pure Deterministic 3-Way Reconciliation Function
 * Evaluates PO, GRNs, Prior Invoices, and Tolerances without database dependency.
 */
function evaluate3WayMatch({ invoice, po, grns, priorInvoices, tolerances, duplicateCheck }) {
  // 1. Duplicate check evaluation
  if (duplicateCheck && duplicateCheck.code) {
    return {
      status: 'EXCEPTION',
      totalPriceVariance: 0,
      totalQtyVariance: 0,
      lineResults: [],
      exceptions: [{
        reasonCode: duplicateCheck.code,
        message: duplicateCheck.message,
        severity: duplicateCheck.code === 'DUPLICATE_EXACT' ? 'CRITICAL' : 'HIGH'
      }]
    };
  }

  // 2. PO Resolution check
  if (!po) {
    return {
      status: 'EXCEPTION',
      totalPriceVariance: 0,
      totalQtyVariance: 0,
      lineResults: [],
      exceptions: [{
        reasonCode: 'PO_NOT_FOUND',
        message: `No matching PO found for reference '${invoice.poReference}'.`,
        severity: 'HIGH'
      }]
    };
  }

  // 3. Currency check
  if (invoice.currency && po.currency && invoice.currency !== po.currency) {
    return {
      status: 'EXCEPTION',
      totalPriceVariance: 0,
      totalQtyVariance: 0,
      lineResults: [],
      exceptions: [{
        reasonCode: 'CURRENCY_MISMATCH',
        message: `Invoice currency (${invoice.currency}) does not match PO currency (${po.currency}).`,
        severity: 'HIGH'
      }]
    };
  }

  const effectiveTolerances = tolerances || {
    priceTolerancePct: 1.5,
    priceToleranceAbs: 5.0,
    qtyTolerancePct: 0.0,
    qtyToleranceAbs: 0.0,
    isStricterRule: false
  };

  let anyException = false;
  let anyToleranceUsed = false;
  let totalPriceVariance = 0;
  let totalQtyVariance = 0;
  const lineResults = [];
  const exceptions = [];

  for (const invLine of (invoice.lines || [])) {
    const matchedPOLine = mapLineToPO(invLine, po.lines || []);

    if (!matchedPOLine) {
      anyException = true;
      const msg = `Invoice line '${invLine.description}' does not map to any line on PO ${po.poNumber}.`;
      lineResults.push({
        invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
        poLineNumber: null,
        itemCode: invLine.itemCode || null,
        isMatched: false,
        usedTolerance: false,
        billableQty: 0,
        invoicedQty: invLine.quantity,
        qtyVariance: invLine.quantity,
        poUnitPrice: 0,
        invoicedUnitPrice: invLine.unitPrice,
        priceVariance: 0,
        exceptionCode: 'ITEM_NOT_ON_PO',
        message: msg
      });
      exceptions.push({ reasonCode: 'ITEM_NOT_ON_PO', message: msg, severity: 'HIGH' });
      continue;
    }

    // Cumulative received on all GRNs for this PO line
    let totalGrnQty = 0;
    for (const g of (grns || [])) {
      for (const gl of (g.lines || [])) {
        if (gl.poLineNumber === matchedPOLine.lineNumber || gl.itemCode === matchedPOLine.itemCode) {
          totalGrnQty += gl.receivedQty;
        }
      }
    }

    // Cumulative invoiced on prior approved/matched invoices for this PO line
    let priorInvoicedQty = 0;
    for (const pi of (priorInvoices || [])) {
      if (String(pi._id || pi.id) !== String(invoice._id || invoice.id)) {
        for (const pil of (pi.lines || [])) {
          if (pil.poLineNumber === matchedPOLine.lineNumber || pil.itemCode === matchedPOLine.itemCode) {
            priorInvoicedQty += pil.quantity;
          }
        }
      }
    }

    const billableQty = Math.max(0, totalGrnQty - priorInvoicedQty);

    // GRN Missing check
    if (totalGrnQty <= 0) {
      anyException = true;
      const msg = `No Goods Receipt (GRN) found for item '${matchedPOLine.itemCode}' on PO ${po.poNumber}.`;
      lineResults.push({
        invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
        poLineNumber: matchedPOLine.lineNumber,
        itemCode: matchedPOLine.itemCode,
        isMatched: false,
        usedTolerance: false,
        billableQty: 0,
        invoicedQty: invLine.quantity,
        qtyVariance: invLine.quantity,
        poUnitPrice: matchedPOLine.unitPrice,
        invoicedUnitPrice: invLine.unitPrice,
        priceVariance: Number((invLine.unitPrice - matchedPOLine.unitPrice).toFixed(4)),
        exceptionCode: 'GRN_MISSING',
        message: msg
      });
      exceptions.push({ reasonCode: 'GRN_MISSING', message: msg, severity: 'HIGH' });
      continue;
    }

    // Over-order check
    if ((priorInvoicedQty + invLine.quantity) > (matchedPOLine.orderedQty * (1.0 + effectiveTolerances.qtyTolerancePct / 100.0))) {
      anyException = true;
      const msg = `Cumulative billed qty (${priorInvoicedQty + invLine.quantity}) exceeds ordered qty (${matchedPOLine.orderedQty}).`;
      lineResults.push({
        invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
        poLineNumber: matchedPOLine.lineNumber,
        itemCode: matchedPOLine.itemCode,
        isMatched: false,
        usedTolerance: false,
        billableQty,
        invoicedQty: invLine.quantity,
        qtyVariance: Number((invLine.quantity - billableQty).toFixed(4)),
        poUnitPrice: matchedPOLine.unitPrice,
        invoicedUnitPrice: invLine.unitPrice,
        priceVariance: Number((invLine.unitPrice - matchedPOLine.unitPrice).toFixed(4)),
        exceptionCode: 'QTY_BILLED_EXCEEDS_ORDERED',
        message: msg
      });
      exceptions.push({ reasonCode: 'QTY_BILLED_EXCEEDS_ORDERED', message: msg, severity: 'HIGH' });
      continue;
    }

    // Quantity variance & tolerance check
    const qtyVariance = Number((invLine.quantity - billableQty).toFixed(4));
    let qtyPassed = false;
    let qtyUsedTol = false;

    if (qtyVariance <= 0) {
      qtyPassed = true;
    } else {
      const allowedPct = billableQty * (effectiveTolerances.qtyTolerancePct / 100.0);
      const withinPct = qtyVariance <= allowedPct;
      const withinAbs = qtyVariance <= effectiveTolerances.qtyToleranceAbs;
      if (effectiveTolerances.isStricterRule ? (withinPct && withinAbs) : (withinPct || withinAbs)) {
        qtyPassed = true;
        qtyUsedTol = true;
      }
    }

    if (!qtyPassed) {
      anyException = true;
      const msg = `Invoiced qty ${invLine.quantity} exceeds billable received qty ${billableQty} (variance: +${qtyVariance}).`;
      lineResults.push({
        invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
        poLineNumber: matchedPOLine.lineNumber,
        itemCode: matchedPOLine.itemCode,
        isMatched: false,
        usedTolerance: false,
        billableQty,
        invoicedQty: invLine.quantity,
        qtyVariance,
        poUnitPrice: matchedPOLine.unitPrice,
        invoicedUnitPrice: invLine.unitPrice,
        priceVariance: Number((invLine.unitPrice - matchedPOLine.unitPrice).toFixed(4)),
        exceptionCode: 'QTY_BILLED_EXCEEDS_RECEIVED',
        message: msg
      });
      exceptions.push({ reasonCode: 'QTY_BILLED_EXCEEDS_RECEIVED', message: msg, severity: 'HIGH' });
      continue;
    }

    // Price variance & tolerance check
    const priceVariance = Number((invLine.unitPrice - matchedPOLine.unitPrice).toFixed(4));
    let pricePassed = false;
    let priceUsedTol = false;

    if (priceVariance <= 0) {
      pricePassed = true;
    } else {
      const allowedPct = matchedPOLine.unitPrice * (effectiveTolerances.priceTolerancePct / 100.0);
      const withinPct = priceVariance <= allowedPct;
      const withinAbs = priceVariance <= effectiveTolerances.priceToleranceAbs;
      if (effectiveTolerances.isStricterRule ? (withinPct && withinAbs) : (withinPct || withinAbs)) {
        pricePassed = true;
        priceUsedTol = true;
      }
    }

    if (!pricePassed) {
      anyException = true;
      const msg = `Invoiced price $${invLine.unitPrice} exceeds PO price $${matchedPOLine.unitPrice} (variance: +$${priceVariance}).`;
      lineResults.push({
        invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
        poLineNumber: matchedPOLine.lineNumber,
        itemCode: matchedPOLine.itemCode,
        isMatched: false,
        usedTolerance: false,
        billableQty,
        invoicedQty: invLine.quantity,
        qtyVariance,
        poUnitPrice: matchedPOLine.unitPrice,
        invoicedUnitPrice: invLine.unitPrice,
        priceVariance,
        exceptionCode: 'PRICE_HIGHER',
        message: msg
      });
      exceptions.push({ reasonCode: 'PRICE_HIGHER', message: msg, severity: 'HIGH' });
      continue;
    }

    const lineUsedTol = qtyUsedTol || priceUsedTol;
    if (lineUsedTol) anyToleranceUsed = true;

    totalPriceVariance += Math.max(0, priceVariance * invLine.quantity);
    totalQtyVariance += Math.max(0, qtyVariance);

    lineResults.push({
      invoiceLineId: invLine._id ? invLine._id.toString() : String(invLine.lineNumber || 1),
      poLineNumber: matchedPOLine.lineNumber,
      itemCode: matchedPOLine.itemCode,
      isMatched: true,
      usedTolerance: lineUsedTol,
      billableQty,
      invoicedQty: invLine.quantity,
      qtyVariance,
      poUnitPrice: matchedPOLine.unitPrice,
      invoicedUnitPrice: invLine.unitPrice,
      priceVariance,
      exceptionCode: null,
      message: null
    });
  }

  let finalStatus = 'MATCHED_EXACT';
  if (anyException) {
    finalStatus = 'EXCEPTION';
  } else if (anyToleranceUsed) {
    finalStatus = 'MATCHED_TOLERANCE';
  }

  return {
    status: finalStatus,
    totalPriceVariance: Number(totalPriceVariance.toFixed(2)),
    totalQtyVariance: Number(totalQtyVariance.toFixed(2)),
    lineResults,
    exceptions
  };
}

class MatchingEngine {
  constructor(tenantId) {
    this.tenantId = tenantId;
  }

  async runMatch(invoiceId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, tenantId: this.tenantId });
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    // Clean up prior match runs and exceptions
    await MatchRun.deleteMany({ invoiceId: invoice._id, tenantId: this.tenantId });
    await Exception.deleteMany({ invoiceId: invoice._id, tenantId: this.tenantId });

    const duplicateCheck = await this.checkDuplicate(invoice);
    const po = await this.resolvePO(invoice);
    if (po) invoice.poId = po._id;

    const grns = po ? await GoodsReceipt.find({ tenantId: this.tenantId, poId: po._id }) : [];
    const priorInvoices = po ? await Invoice.find({
      tenantId: this.tenantId,
      poId: po._id,
      _id: { $ne: invoice._id },
      status: { $in: ['MATCHED', 'APPROVED', 'EXPORTED'] }
    }) : [];

    const tolerances = await this.resolveTolerances(invoice.vendorId);

    const outcome = evaluate3WayMatch({
      invoice,
      po,
      grns,
      priorInvoices,
      tolerances,
      duplicateCheck
    });

    // Persist MatchRun
    const matchRun = new MatchRun({
      tenantId: this.tenantId,
      invoiceId: invoice._id,
      poId: po ? po._id : null,
      status: outcome.status,
      rulesApplied: tolerances,
      totalPriceVariance: outcome.totalPriceVariance,
      totalQtyVariance: outcome.totalQtyVariance,
      lineResults: outcome.lineResults
    });
    await matchRun.save();

    // Persist Exceptions
    for (const exc of outcome.exceptions) {
      await Exception.create({
        tenantId: this.tenantId,
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        vendorName: invoice.vendorName || 'Vendor',
        matchRunId: matchRun._id,
        reasonCode: exc.reasonCode,
        status: 'OPEN',
        severity: exc.severity || 'HIGH',
        message: exc.message,
        slaDueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      });
    }

    invoice.status = outcome.status === 'EXCEPTION' ? 'UNDER_REVIEW' : 'MATCHED';
    await invoice.save();

    return matchRun;
  }

  async checkDuplicate(invoice) {
    const exact = await Invoice.findOne({
      tenantId: this.tenantId,
      _id: { $ne: invoice._id },
      vendorId: invoice.vendorId,
      normalizedInvoiceNumber: invoice.normalizedInvoiceNumber
    });

    if (exact) {
      return {
        code: 'DUPLICATE_EXACT',
        message: `Exact duplicate of invoice #${exact.invoiceNumber} (ID: ${exact._id}).`
      };
    }

    if (invoice.invoiceDate && invoice.vendorId) {
      const start = new Date(invoice.invoiceDate.getTime() - 45 * 24 * 60 * 60 * 1000);
      const end = new Date(invoice.invoiceDate.getTime() + 45 * 24 * 60 * 60 * 1000);

      const suspects = await Invoice.find({
        tenantId: this.tenantId,
        _id: { $ne: invoice._id },
        vendorId: invoice.vendorId,
        invoiceDate: { $gte: start, $lte: end }
      });

      for (const s of suspects) {
        if (Math.abs(s.grandTotal - invoice.grandTotal) < 0.01) {
          return {
            code: 'DUPLICATE_SUSPECTED',
            message: `Potential duplicate of invoice #${s.invoiceNumber} with identical amount $${invoice.grandTotal.toFixed(2)}.`
          };
        }
        const sim = tokenSortRatio(invoice.normalizedInvoiceNumber, s.normalizedInvoiceNumber);
        if (sim >= 90 && Math.abs(s.grandTotal - invoice.grandTotal) < 5.0) {
          return {
            code: 'DUPLICATE_SUSPECTED',
            message: `Potential duplicate of invoice #${s.invoiceNumber} (Levenshtein similarity: ${sim}%).`
          };
        }
      }
    }

    return { code: null, message: null };
  }

  async resolvePO(invoice) {
    if (invoice.poReference) {
      const cleanRef = invoice.poReference.trim().toUpperCase();
      const po = await PurchaseOrder.findOne({
        tenantId: this.tenantId,
        poNumber: { $regex: new RegExp(`^${cleanRef}$`, 'i') }
      });
      if (po) return po;
    }

    if (invoice.vendorId) {
      const openPOs = await PurchaseOrder.find({
        tenantId: this.tenantId,
        vendorId: invoice.vendorId,
        status: { $in: ['OPEN', 'PARTIALLY_RECEIVED'] }
      });

      for (const p of openPOs) {
        if (Math.abs(p.totalAmount - invoice.grandTotal) <= (p.totalAmount * 0.05)) {
          return p;
        }
      }
    }
    return null;
  }

  async resolveTolerances(vendorId) {
    if (vendorId) {
      const rule = await ToleranceRule.findOne({ tenantId: this.tenantId, vendorId });
      if (rule) return rule;
    }

    const defaultRule = await ToleranceRule.findOne({ tenantId: this.tenantId, vendorId: null });
    if (defaultRule) return defaultRule;

    return {
      priceTolerancePct: 1.5,
      priceToleranceAbs: 5.0,
      qtyTolerancePct: 0.0,
      qtyToleranceAbs: 0.0,
      isStricterRule: false
    };
  }
}

module.exports = {
  MatchingEngine,
  evaluate3WayMatch,
  normalizeInvoiceNumber,
  tokenSortRatio,
  levenshteinDistance
};
