const mongoose = require('mongoose');
const Tenant = require('./models/Tenant');
const User = require('./models/User');
const Vendor = require('./models/Vendor');
const ToleranceRule = require('./models/ToleranceRule');
const PurchaseOrder = require('./models/PurchaseOrder');
const GoodsReceipt = require('./models/GoodsReceipt');
const Invoice = require('./models/Invoice');
const { MatchingEngine, normalizeInvoiceNumber } = require('./services/matchingEngine');

async function seedMernDatabase() {
  const existingTenant = await Tenant.findOne({ slug: 'apex-supply-chain' });
  if (existingTenant) {
    console.log('MongoDB database already seeded with Apex Supply Chain data.');
    return existingTenant._id;
  }

  console.log('Seeding Matchly MongoDB demonstration database...');

  // 1. Tenant
  const tenant = await Tenant.create({
    name: 'Apex Supply Chain Corp',
    slug: 'apex-supply-chain',
    baseCurrency: 'USD',
    isActive: true
  });

  // 2. Users
  await User.create([
    {
      tenantId: tenant._id,
      email: 'sarah.controller@apexsupply.com',
      passwordHash: 'argon2_mock_hash',
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: 'FINANCE_CONTROLLER'
    },
    {
      tenantId: tenant._id,
      email: 'priya.clerk@apexsupply.com',
      passwordHash: 'argon2_mock_hash',
      firstName: 'Priya',
      lastName: 'Sharma',
      role: 'AP_CLERK'
    },
    {
      tenantId: tenant._id,
      email: 'carlos.dock@apexsupply.com',
      passwordHash: 'argon2_mock_hash',
      firstName: 'Carlos',
      lastName: 'Mendoza',
      role: 'WAREHOUSE'
    },
    {
      tenantId: tenant._id,
      email: 'parthivnanavatimatchly7@gmail.com',
      passwordHash: 'Parthiv@matchly*54321',
      firstName: 'Parthiv',
      lastName: 'Nanavati',
      role: 'ADMIN'
    }
  ]);

  // 3. Global Tolerance Rule (1.5% price, 0% qty)
  await ToleranceRule.create({
    tenantId: tenant._id,
    vendorId: null,
    priceTolerancePct: 1.5,
    priceToleranceAbs: 5.0,
    qtyTolerancePct: 0.0,
    qtyToleranceAbs: 0.0,
    isStricterRule: false
  });

  // 4. Vendors
  const [vAcme, vTitan, vGlobal] = await Vendor.create([
    {
      tenantId: tenant._id,
      vendorCode: 'VEND-ACME',
      name: 'Acme Industrial Supplies',
      taxId: 'US-EIN-1299401',
      contactEmail: 'billing@acmeindustrial.com',
      currency: 'USD',
      paymentTermsDays: 30,
      glAccountCode: '5010-COGS-MATERIALS',
      trustScore: 94.5
    },
    {
      tenantId: tenant._id,
      vendorCode: 'VEND-TITAN',
      name: 'Titan Steelworks Ltd',
      taxId: 'US-EIN-8812034',
      contactEmail: 'ar@titansteel.com',
      currency: 'USD',
      paymentTermsDays: 45,
      glAccountCode: '5020-RAW-STEEL',
      trustScore: 68.0 // High risk
    },
    {
      tenantId: tenant._id,
      vendorCode: 'VEND-GLOBAL',
      name: 'Global Packaging Corp',
      taxId: 'US-EIN-4491029',
      contactEmail: 'invoices@globalpack.com',
      currency: 'USD',
      paymentTermsDays: 30,
      glAccountCode: '5030-PACKAGING',
      trustScore: 98.0
    }
  ]);

  // Vendor-specific strict tolerance for Titan Steel
  await ToleranceRule.create({
    tenantId: tenant._id,
    vendorId: vTitan._id,
    priceTolerancePct: 0.0,
    priceToleranceAbs: 0.0,
    qtyTolerancePct: 2.0, // Steel weight tolerance
    qtyToleranceAbs: 5.0,
    isStricterRule: false
  });

  // 5. Purchase Orders
  const po1 = await PurchaseOrder.create({
    tenantId: tenant._id,
    vendorId: vAcme._id,
    poNumber: 'PO-2026-001',
    orderDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    totalAmount: 600.0,
    status: 'OPEN',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'HEX-M8-50',
        description: 'Hex Bolt M8 50mm Grade 8.8 Galvanized',
        orderedQty: 1000,
        unitPrice: 0.45,
        lineTotal: 450.0
      },
      {
        lineNumber: 2,
        itemCode: 'NUT-M8-GALV',
        description: 'Steel Lock Nut M8 Galvanized DIN 985',
        orderedQty: 1000,
        unitPrice: 0.15,
        lineTotal: 150.0
      }
    ]
  });

  const po2 = await PurchaseOrder.create({
    tenantId: tenant._id,
    vendorId: vTitan._id,
    poNumber: 'PO-2026-002',
    orderDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    totalAmount: 5000.0,
    status: 'PARTIALLY_RECEIVED',
    lines: [
      {
        lineNumber: 1,
        itemCode: 'STEEL-PL-10MM',
        description: 'Structural Steel Plate 10mm A36 Hot Rolled',
        orderedQty: 50,
        unitPrice: 100.0,
        lineTotal: 5000.0
      }
    ]
  });

  // 6. Goods Receipts (GRNs)
  await GoodsReceipt.create([
    {
      tenantId: tenant._id,
      poId: po1._id,
      poNumber: po1.poNumber,
      grnNumber: 'GRN-8801',
      receivedDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      warehouseLocation: 'WH-MAIN DOCK 4',
      receivedBy: 'Carlos Mendoza',
      lines: [
        { poLineNumber: 1, itemCode: 'HEX-M8-50', receivedQty: 1000 },
        { poLineNumber: 2, itemCode: 'NUT-M8-GALV', receivedQty: 1000 }
      ]
    },
    {
      tenantId: tenant._id,
      poId: po2._id,
      poNumber: po2.poNumber,
      grnNumber: 'GRN-8802',
      receivedDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      warehouseLocation: 'WH-HEAVY STORAGE',
      receivedBy: 'Carlos Mendoza',
      lines: [
        { poLineNumber: 1, itemCode: 'STEEL-PL-10MM', receivedQty: 20 } // only 20 out of 50 received!
      ]
    }
  ]);

  // 7. Demonstration Invoices
  // Invoice A: Clean 100% Match on Acme
  const invA = await Invoice.create({
    tenantId: tenant._id,
    vendorId: vAcme._id,
    vendorName: vAcme.name,
    poId: po1._id,
    poReference: 'PO-2026-001',
    invoiceNumber: 'INV-9821',
    normalizedInvoiceNumber: normalizeInvoiceNumber('INV-9821'),
    invoiceDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    dueDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    subtotal: 600.0,
    grandTotal: 600.0,
    status: 'EXTRACTED',
    extractionConfidence: 0.96,
    lines: [
      {
        lineNumber: 1,
        poLineNumber: 1,
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
        poLineNumber: 2,
        itemCode: 'NUT-M8-GALV',
        description: 'Steel Lock Nut M8 Galvanized DIN 985',
        quantity: 1000,
        unitPrice: 0.15,
        lineTotal: 150.0,
        confidence: 0.94,
        bbox: [150, 45, 175, 950]
      }
    ]
  });

  // Invoice B: Overbilling by Titan Steel ($3,000 cash protected!)
  const invB = await Invoice.create({
    tenantId: tenant._id,
    vendorId: vTitan._id,
    vendorName: vTitan.name,
    poId: po2._id,
    poReference: 'PO-2026-002',
    invoiceNumber: 'INV-TITAN-4040',
    normalizedInvoiceNumber: normalizeInvoiceNumber('INV-TITAN-4040'),
    invoiceDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    dueDate: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    subtotal: 5000.0,
    grandTotal: 5000.0,
    status: 'EXTRACTED',
    extractionConfidence: 0.91,
    lines: [
      {
        lineNumber: 1,
        poLineNumber: 1,
        itemCode: 'STEEL-PL-10MM',
        description: 'Structural Steel Plate 10mm A36 Hot Rolled',
        quantity: 50, // Billed 50, but only 20 received
        unitPrice: 100.0,
        lineTotal: 5000.0,
        confidence: 0.92,
        bbox: [200, 45, 230, 950]
      }
    ]
  });

  // Invoice C: Price Mismatch on Acme ($70 cash protected!)
  const invC = await Invoice.create({
    tenantId: tenant._id,
    vendorId: vAcme._id,
    vendorName: vAcme.name,
    poId: po1._id,
    poReference: 'PO-2026-001',
    invoiceNumber: 'INV-ACME-9912',
    normalizedInvoiceNumber: normalizeInvoiceNumber('INV-ACME-9912'),
    invoiceDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    dueDate: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    currency: 'USD',
    subtotal: 520.0,
    grandTotal: 520.0,
    status: 'EXTRACTED',
    extractionConfidence: 0.88,
    lines: [
      {
        lineNumber: 1,
        poLineNumber: 1,
        itemCode: 'HEX-M8-50',
        description: 'Hex Bolt M8 50mm Grade 8.8 Galvanized',
        quantity: 1000,
        unitPrice: 0.52, // Contract was $0.45 (+15.5% price increase)
        lineTotal: 520.0,
        confidence: 0.85,
        bbox: [250, 45, 280, 950]
      }
    ]
  });

  // Automatically execute 3-way matching on demonstration bills
  const engine = new MatchingEngine(tenant._id);
  await engine.runMatch(invA._id); // Clears as MATCHED_EXACT
  await engine.runMatch(invB._id); // Flagged as EXCEPTION: QTY_BILLED_EXCEEDS_RECEIVED ($3,000 saved!)
  await engine.runMatch(invC._id); // Flagged as EXCEPTION: PRICE_HIGHER ($70 saved!)

  console.log('Matchly MongoDB database seeded successfully!');
  return tenant._id;
}

module.exports = { seedMernDatabase };
