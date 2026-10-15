const mongoose = require('mongoose');

const ExceptionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, required: true },
  vendorName: { type: String },
  matchRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'MatchRun' },
  reasonCode: { type: String, required: true },
  status: {
    type: String,
    enum: ['OPEN', 'INVESTIGATING', 'OVERRIDDEN', 'REJECTED', 'RESOLVED'],
    default: 'OPEN'
  },
  severity: { type: String, default: 'HIGH' },
  message: { type: String, required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  slaDueAt: { type: Date, required: true },
  overrideReason: { type: String },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Exception', ExceptionSchema);
