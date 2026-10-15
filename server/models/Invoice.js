const mongoose = require('mongoose');

const InvoiceLineSchema = new mongoose.Schema({
  lineNumber: { type: Number, required: true },
  poLineNumber: { type: Number },
  itemCode: { type: String },
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  uom: { type: String, default: 'EA' },
  unitPrice: { type: Number, required: true },
  taxRatePct: { type: Number, default: 0.0 },
  taxAmount: { type: Number, default: 0.0 },
  lineTotal: { type: Number, required: true },
  confidence: { type: Number, default: 1.0 },
  bbox: [{ type: Number }]
});

const InvoiceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  vendorName: { type: String },
  poId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  poReference: { type: String },
  invoiceNumber: { type: String, required: true },
  normalizedInvoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, default: Date.now },
  dueDate: { type: Date },
  currency: { type: String, default: 'USD' },
  subtotal: { type: Number, default: 0.0 },
  taxTotal: { type: Number, default: 0.0 },
  discountTotal: { type: Number, default: 0.0 },
  grandTotal: { type: Number, required: true },
  fileUrl: { type: String },
  fileHash: { type: String },
  status: {
    type: String,
    enum: ['UPLOADED', 'EXTRACTED', 'MATCHED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPORTED'],
    default: 'EXTRACTED'
  },
  extractionConfidence: { type: Number, default: 0.95 },
  lines: [InvoiceLineSchema]
}, { timestamps: true });

InvoiceSchema.index({ tenantId: 1, vendorId: 1, normalizedInvoiceNumber: 1 });

module.exports = mongoose.model('Invoice', InvoiceSchema);
