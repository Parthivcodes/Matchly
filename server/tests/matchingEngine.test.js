const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  evaluate3WayMatch,
  normalizeInvoiceNumber,
  tokenSortRatio
} = require('../services/matchingEngine');

describe('Matchly MERN 3-Way Matching Engine Test Suite', () => {

  test('1. Invoice Number Normalization', () => {
    assert.strictEqual(normalizeInvoiceNumber('INV-00192'), 'INV192');
    assert.strictEqual(normalizeInvoiceNumber('inv/0091'), 'INV91');
    assert.strictEqual(normalizeInvoiceNumber('  INV_0005  '), 'INV5');
    assert.strictEqual(normalizeInvoiceNumber('000456'), '456');
  });

  test('2. Exact 3-Way Match (Zero Variance)', () => {
    const po = {
      poNumber: 'PO-EXACT-01',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'HEX-M8', description: 'Hex Bolt M8 50mm', orderedQty: 100, unitPrice: 2.00 }]
    };

    const grns = [{
      grnNumber: 'GRN-EXACT-01',
      lines: [{ poLineNumber: 1, itemCode: 'HEX-M8', receivedQty: 100 }]
    }];

    const invoice = {
      id: 'inv-1',
      invoiceNumber: 'INV-EXACT-01',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'HEX-M8', description: 'Hex Bolt M8 50mm', quantity: 100, unitPrice: 2.00 }]
    };

    const result = evaluate3WayMatch({ invoice, po, grns, priorInvoices: [] });
    assert.strictEqual(result.status, 'MATCHED_EXACT');
    assert.strictEqual(result.totalPriceVariance, 0);
    assert.strictEqual(result.totalQtyVariance, 0);
    assert.strictEqual(result.lineResults[0].isMatched, true);
    assert.strictEqual(result.lineResults[0].usedTolerance, false);
  });

  test('3. Partial Delivery & Split Invoicing (Backorder Lifecycle)', () => {
    const po = {
      poNumber: 'PO-PART-01',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'WIDGET-X', description: 'Widget X Part', orderedQty: 100, unitPrice: 10.00 }]
    };

    // Step A: First shipment arrives with 40 units
    const grnsBatch1 = [{
      grnNumber: 'GRN-1',
      lines: [{ poLineNumber: 1, itemCode: 'WIDGET-X', receivedQty: 40 }]
    }];

    const invoice1 = {
      id: 'inv-part-1',
      invoiceNumber: 'INV-PART-1',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'WIDGET-X', description: 'Widget X Part', quantity: 40, unitPrice: 10.00 }]
    };

    // Invoice 1 for 40 units -> EXACT MATCH!
    const res1 = evaluate3WayMatch({ invoice: invoice1, po, grns: grnsBatch1, priorInvoices: [] });
    assert.strictEqual(res1.status, 'MATCHED_EXACT');

    // Step B: Premature Invoice 2 arrives for 60 units before shipment 2 arrives
    const invoice2 = {
      id: 'inv-part-2',
      invoiceNumber: 'INV-PART-2',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'WIDGET-X', description: 'Widget X Part', quantity: 60, unitPrice: 10.00 }]
    };

    // Total received = 40, Prior invoiced = 40 -> Billable = 0. Invoiced = 60 -> FAILS!
    const res2 = evaluate3WayMatch({ invoice: invoice2, po, grns: grnsBatch1, priorInvoices: [invoice1] });
    assert.strictEqual(res2.status, 'EXCEPTION');
    assert.strictEqual(res2.lineResults[0].exceptionCode, 'QTY_BILLED_EXCEEDS_RECEIVED');

    // Step C: Second shipment arrives with 60 units
    const grnsBatch2 = [
      ...grnsBatch1,
      { grnNumber: 'GRN-2', lines: [{ poLineNumber: 1, itemCode: 'WIDGET-X', receivedQty: 60 }] }
    ];

    // Re-match Invoice 2 -> Total received = 100, Prior invoiced = 40 -> Billable = 60 -> EXACT MATCH!
    const res2Rematch = evaluate3WayMatch({ invoice: invoice2, po, grns: grnsBatch2, priorInvoices: [invoice1] });
    assert.strictEqual(res2Rematch.status, 'MATCHED_EXACT');
  });

  test('4. Consolidated Multiple GRNs into Single Invoice', () => {
    const po = {
      poNumber: 'PO-CONSOL',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'STEEL-ROD', description: 'Steel Rod 12mm', orderedQty: 500, unitPrice: 5.00 }]
    };

    const grns = [
      { grnNumber: 'GRN-1', lines: [{ poLineNumber: 1, itemCode: 'STEEL-ROD', receivedQty: 100 }] },
      { grnNumber: 'GRN-2', lines: [{ poLineNumber: 1, itemCode: 'STEEL-ROD', receivedQty: 150 }] },
      { grnNumber: 'GRN-3', lines: [{ poLineNumber: 1, itemCode: 'STEEL-ROD', receivedQty: 250 }] }
    ];

    const invoice = {
      id: 'inv-consol',
      invoiceNumber: 'INV-CONSOL-01',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'STEEL-ROD', description: 'Steel Rod 12mm', quantity: 500, unitPrice: 5.00 }]
    };

    const res = evaluate3WayMatch({ invoice, po, grns, priorInvoices: [] });
    assert.strictEqual(res.status, 'MATCHED_EXACT');
    assert.strictEqual(res.lineResults[0].billableQty, 500);
  });

  test('5. Duplicate Exact & Fuzzy Invoice Interception', () => {
    const duplicateCheck = {
      code: 'DUPLICATE_EXACT',
      message: 'Exact duplicate of invoice #INV-9921'
    };

    const invoice = {
      id: 'inv-dup',
      invoiceNumber: 'inv/9921',
      lines: []
    };

    const res = evaluate3WayMatch({ invoice, duplicateCheck });
    assert.strictEqual(res.status, 'EXCEPTION');
    assert.strictEqual(res.exceptions[0].reasonCode, 'DUPLICATE_EXACT');
  });

  test('6. Price Tolerance Boundaries (Within vs Stricter Violation)', () => {
    const po = {
      poNumber: 'PO-TOL-01',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'TOL-ITEM', description: 'Tolerance Item', orderedQty: 10, unitPrice: 100.00 }]
    };

    const grns = [{
      grnNumber: 'GRN-TOL',
      lines: [{ poLineNumber: 1, itemCode: 'TOL-ITEM', receivedQty: 10 }]
    }];

    // Case A: Within global 1.5% tolerance (Billed $101.00 on $100 contract, +1%)
    const invoiceA = {
      id: 'inv-a',
      invoiceNumber: 'INV-TOL-PASS',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'TOL-ITEM', description: 'Tolerance Item', quantity: 10, unitPrice: 101.00 }]
    };

    const resA = evaluate3WayMatch({
      invoice: invoiceA,
      po,
      grns,
      priorInvoices: [],
      tolerances: { priceTolerancePct: 1.5, priceToleranceAbs: 5.0, qtyTolerancePct: 0, qtyToleranceAbs: 0, isStricterRule: false }
    });
    assert.strictEqual(resA.status, 'MATCHED_TOLERANCE');
    assert.strictEqual(resA.lineResults[0].usedTolerance, true);

    // Case B: Stricter 0% tolerance violation (Billed $103.00, +3%)
    const invoiceB = {
      id: 'inv-b',
      invoiceNumber: 'INV-TOL-FAIL',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'TOL-ITEM', description: 'Tolerance Item', quantity: 10, unitPrice: 103.00 }]
    };

    const resB = evaluate3WayMatch({
      invoice: invoiceB,
      po,
      grns,
      priorInvoices: [],
      tolerances: { priceTolerancePct: 0.0, priceToleranceAbs: 0.0, qtyTolerancePct: 0, qtyToleranceAbs: 0, isStricterRule: true }
    });
    assert.strictEqual(resB.status, 'EXCEPTION');
    assert.strictEqual(resB.lineResults[0].exceptionCode, 'PRICE_HIGHER');
  });

  test('7. Currency Mismatch Detection', () => {
    const po = { poNumber: 'PO-USD', currency: 'USD', lines: [] };
    const invoice = { id: 'inv-eur', invoiceNumber: 'INV-EUR', currency: 'EUR', lines: [] };

    const res = evaluate3WayMatch({ invoice, po, grns: [], priorInvoices: [] });
    assert.strictEqual(res.status, 'EXCEPTION');
    assert.strictEqual(res.exceptions[0].reasonCode, 'CURRENCY_MISMATCH');
  });

  test('8. Missing GRN (No Physical Goods Logged)', () => {
    const po = {
      poNumber: 'PO-NOGRN',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'GHOST-01', description: 'Ghost Item', orderedQty: 5, unitPrice: 10.00 }]
    };

    const invoice = {
      id: 'inv-nogrn',
      invoiceNumber: 'INV-NOGRN',
      currency: 'USD',
      lines: [{ lineNumber: 1, itemCode: 'GHOST-01', description: 'Ghost Item', quantity: 5, unitPrice: 10.00 }]
    };

    // Zero GRNs exist for this PO
    const res = evaluate3WayMatch({ invoice, po, grns: [], priorInvoices: [] });
    assert.strictEqual(res.status, 'EXCEPTION');
    assert.strictEqual(res.lineResults[0].exceptionCode, 'GRN_MISSING');
  });

});
