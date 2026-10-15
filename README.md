# Matchly — 3-Way Invoice Matching SaaS (MERN Stack)

Matchly is an automated 3-Way Invoice Matching platform designed for SMB physical goods businesses (distributors, light manufacturers, omnichannel retailers, and healthcare facilities). It automatically reconciles Vendor Invoices against Purchase Orders (POs) and Warehouse Goods Receipt Notes (GRNs) to prevent overbilling, double billing, and payment for undelivered goods.

---

## 🛠️ Technology Stack: 100% MERN

Matchly is built entirely using the **MERN Stack**:
* **M — MongoDB & Mongoose:** Document-based storage storing multi-line Purchase Orders, Goods Receipts (GRNs), and Invoices with embedded line items, normalized invoice hashes, and audit history.
* **E — Express.js:** REST API routing, rate limiting, and business logic controllers.
* **R — React / Interactive Web UI:** Responsive, high-aesthetic dark-mode dashboard, split-screen PDF verification UI, 3-way line reconciliation tables, exception queues, and dock receiving screens.
* **N — Node.js:** High-concurrency event-driven runtime environment with deterministic 3-way matching algorithms.

---

## 🚀 Quickstart

### 1. Requirements
* Node.js v18+ (tested on v24)
* npm v9+

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the MERN Server
```bash
npm start
```
The server will automatically connect to MongoDB (or launch an in-memory instance if no local MongoDB daemon is running), seed the demonstration database, and start on:
👉 **`http://127.0.0.1:5000/`**

### 4. Run the Unit Test Suite
```bash
npm test
```
All 8 edge-case unit tests will execute and pass:
* `1. Invoice Number Normalization`: Normalizes invoice numbers and strips punctuation/leading zeroes.
* `2. Exact 3-Way Match (Zero Variance)`: Reconciles PO, GRN, and Invoice lines with 0 variance.
* `3. Partial Delivery & Split Invoicing`: Simulates multi-shipment backorders and verifies cumulative balance accounting.
* `4. Consolidated Multiple GRNs`: Reconciles multiple warehouse delivery slips into a single invoice.
* `5. Duplicate Exact & Fuzzy Invoice Interception`: Intercepts duplicate submissions across format variations.
* `6. Price Tolerance Boundaries`: Verifies within-tolerance vs out-of-tolerance price increases.
* `7. Currency Mismatch Detection`: Flags currency discrepancies between PO and bill.
* `8. Missing GRN`: Flags invoices submitted before physical warehouse receipts are logged.

---

## 📂 Project Structure

```
Matchly/
├── server/
│   ├── config/
│   │   └── db.js                   # Mongoose MongoDB connection & fallback manager
│   ├── models/
│   │   ├── Tenant.js               # Multi-tenant organization model
│   │   ├── User.js                 # Users & RBAC roles
│   │   ├── Vendor.js               # Vendor master with trust scores
│   │   ├── ToleranceRule.js        # Configurable tolerances per vendor/global
│   │   ├── PurchaseOrder.js        # POs with embedded line items
│   │   ├── GoodsReceipt.js         # GRNs with dock inspection lines
│   │   ├── Invoice.js              # Extracted bills with bounding boxes
│   │   ├── MatchRun.js             # Reconciliation audit records
│   │   ├── Exception.js            # Reason codes, SLA countdown & resolution
│   │   └── AuditLog.js             # Immutable audit log
│   ├── routes/
│   │   ├── auth.js                 # Authentication & current user
│   │   ├── invoices.js             # Upload, extraction, review & match trigger
│   │   ├── purchaseOrders.js       # PO queries
│   │   ├── goodsReceipts.js        # GRNs & 2-click dock receiving
│   │   ├── exceptions.js           # Exception queue & override handler
│   │   ├── vendors.js              # Vendor directory & trust index
│   │   ├── analytics.js            # KPI metrics (STP %, money saved, aging)
│   │   └── exports.js              # QuickBooks, Xero, Tally CSV generators
│   ├── services/
│   │   └── matchingEngine.js       # Core deterministic 3-way matching engine
│   ├── tests/
│   │   └── matchingEngine.test.js  # Node.js test suite for all edge cases
│   ├── seed.js                     # Demonstration seed data script
│   └── server.js                   # Express.js server entrypoint
├── frontend/
│   ├── index.html                  # Full-featured SPA layout
│   ├── css/
│   │   └── style.css               # Premium design system (Plus Jakarta Sans)
│   └── js/
│       └── app.js                  # Reactive client application controller
├── package.json
└── README.md
```

---

## 💡 Demonstrated Capabilities

### Website navigation

The homepage at `/` is a responsive Matchly landing page with an interactive sample match. The original invoice application remains available at `/dashboard`, linked from the homepage. Both the Node and Python servers use the same pages. The landing page is a single HTML file with inline CSS and JavaScript; Google Fonts are its only external visual dependency.


1. **Dashboard & Financial Controls:** Real-time STP match rate, Money Protected ($3,070+ saved from overbilling), and AP Aging breakdown.
2. **AI Document Review:** Split-screen preview showing document mockup with bounding box overlays on left, and editable table with confidence pills on right.
3. **3-Way Line Reconciliation:** Side-by-side comparative table (PO vs GRN vs Invoice) with highlighted variance diffs.
4. **Exception Management Queue:** Reason badges, 3-day SLA countdown, and audit-logged override modals.
5. **Dock Receiving Screen:** 2-click web receiving for dock staff without requiring an ERP license.
6. **Accounting CSV Export:** 1-click export formatted for QuickBooks Online, Xero, and Tally Prime.
