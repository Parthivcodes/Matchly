# Matchly — Core Features Technical & Functional Specification (Phase 2)
**Version:** 1.0  
**Status:** Complete / Ready for Architecture & Schema (Phase 3)  
**System Target:** 3-Way Invoice Matching SaaS  

---

## 1. Document Ingestion Engine

Matchly ingests documents across three channels: direct UI upload, inbound email forwarding, and structured CSV/API imports.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DOCUMENT INGESTION                                 │
├──────────────────────────┬──────────────────────────┬───────────────────────────┤
│    Direct UI Upload      │   Email-to-Inbox (v1.1)  │    CSV / API Import       │
│  - Multi-file (PDF/IMG)  │  - Dedicated Org Alias   │  - Open POs & Lines       │
│  - Magic Byte Validation │  - SPF/DKIM/DMARC verify │  - Goods Receipts (GRNs)  │
│  - Presigned S3 Upload   │  - Attachment Extractor  │  - Vendor Master          │
└────────────┬─────────────┴────────────┬─────────────┴─────────────┬─────────────┘
             │                          │                           │
             ▼                          ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        INGESTION VALIDATION & SECURITY LAYER                    │
│  - ClamAV Virus / Malware Scan       - MIME-Type & Header Integrity             │
│  - AES-256 S3 Storage Encryption     - Idempotency & SHA-256 File Hash Check    │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        ▼
                      ┌───────────────────────────────────┐
                      │    Redis / BullMQ Ingestion Queue │
                      └───────────────────────────────────┘
```

### 1.1 Direct UI Upload (Invoices)
* **Supported Formats:** PDF (single & multi-page up to 25 pages), PNG, JPG, JPEG, TIFF.
* **Constraints:** Max 15 MB per file; batch upload up to 50 files concurrently.
* **Security & Validation Pipeline:**
  1. **Magic Number Verification:** Reject spoofed extensions (verify `%PDF-` header for PDFs, `\xFF\xD8\xFF` for JPEG, `\x89PNG` for PNG).
  2. **SHA-256 Fingerprint Check:** Compute document hash before upload. If the identical file exists in the tenant's repository within the last 90 days, warn the user immediately.
  3. **Direct S3 Presigned Upload:** Browser uploads directly to private S3 bucket using short-lived signed PUT URLs (`Expires=900`). The application server never buffers large binary streams into memory.
  4. **Post-Upload Event:** S3 `ObjectCreated` event sends message to Redis queue `invoice:processing` containing `{tenant_id, document_id, s3_key, file_hash}`.

### 1.2 Inbound Email-to-Inbox Architecture (v1.1 Roadmap Spec)
* **Tenant Address Format:** `inbound+{tenant_slug}_{token}@matchpay.app` (e.g., `inbound+acme_corp_8f2a@matchpay.app`).
* **Processing Flow:**
  1. Inbound MX routed to AWS SES / Postmark Inbound.
  2. Inbound webhook verifies SPF, DKIM, and DMARC status. Emails failing authentication are dropped to prevent spoofing.
  3. Worker extracts all PDF/image attachments while discarding signatures, marketing images (`width < 100px` or `height < 100px`), and `.ics` files.
  4. Invoices are queued with `source: EMAIL` and `metadata: {sender: email, subject: string, date: timestamp}`.

### 1.3 Master Data CSV Import Specifications (POs and GRNs)

#### Purchase Orders Import Schema (`purchase_orders.csv`)
```csv
po_number,vendor_code,order_date,currency,payment_terms_days,line_number,item_code,description,ordered_qty,uom,unit_price,tax_rate_pct
PO-2026-001,VEND-ACME,2026-03-01,USD,30,1,SKU-BOLT-01,"Hex Bolt M8 50mm Grade 8.8",1000,EA,0.45,10.0
PO-2026-001,VEND-ACME,2026-03-01,USD,30,2,SKU-NUT-01,"Steel Lock Nut M8 Galvanized",1000,EA,0.15,10.0
PO-2026-002,VEND-GLOBAL,2026-03-02,USD,45,1,SKU-PIPE-10,"PVC Pressure Pipe 2-inch 10ft",250,PCS,12.50,5.0
```

#### Goods Receipts Import Schema (`goods_receipts.csv`)
```csv
grn_number,po_number,received_date,warehouse_location,received_by,po_line_number,item_code,received_qty,rejected_qty,rejection_reason
GRN-8801,PO-2026-001,2026-03-05,WH-MAIN,Carlos M.,1,SKU-BOLT-01,1000,0,""
GRN-8801,PO-2026-001,2026-03-05,WH-MAIN,Carlos M.,2,SKU-NUT-01,800,50,"Damaged threads"
GRN-8809,PO-2026-002,2026-03-07,WH-EAST,Priya S.,1,SKU-PIPE-10,150,0,"Partial delivery batch 1"
```

#### Validation Rules on Import
1. **Idempotency:** Re-importing the same `po_number` + `line_number` updates existing records (upsert) unless already linked to an approved invoice.
2. **Referential Integrity:** GRN rows must link to an existing `po_number` and valid `po_line_number` or matching `item_code`.
3. **Atomic Batching:** Imports run within a database transaction; any structural corruption in the CSV rolls back the batch with line-by-line error reports.

---

## 2. AI Document Extraction Pipeline & Verification UI

```
┌──────────────────┐      ┌────────────────────────┐      ┌─────────────────────────┐
│ Ingested PDF/IMG │ ───► │ Multimodal Vision LLM  │ ───► │ Deterministic Validator │
│ Document         │      │ (JSON Schema Enforced) │      │ (Math & Tax Checksums)  │
└──────────────────┘      └────────────────────────┘      └────────────┬────────────┘
                                                                       │
                                                                       ▼
                                                          ┌─────────────────────────┐
                                                          │ Split-Screen Review UI  │
                                                          │ - Bounding Box Highlit  │
                                                          │ - Amber Low Conf (<85%) │
                                                          │ - 1-Click Keyboard Nav  │
                                                          └─────────────────────────┘
```

### 2.1 Extraction Data Contract (Structured JSON Schema)
The extraction engine executes against multimodal vision models with strict schema constraints:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "InvoiceExtraction",
  "type": "object",
  "required": ["invoice_number", "invoice_date", "currency", "grand_total", "lines"],
  "properties": {
    "vendor": {
      "type": "object",
      "properties": {
        "raw_name": { "type": "string" },
        "tax_id": { "type": "string" },
        "address": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "required": ["raw_name", "confidence"]
    },
    "invoice_number": { "type": "string" },
    "invoice_number_confidence": { "type": "number" },
    "invoice_date": { "type": "string", "format": "date" },
    "due_date": { "type": ["string", "null"], "format": "date" },
    "po_reference": { "type": ["string", "null"] },
    "po_reference_confidence": { "type": "number" },
    "currency": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "subtotal": { "type": "number" },
    "tax_total": { "type": "number" },
    "tax_breakdown": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "tax_type": { "type": "string" },
          "rate_pct": { "type": "number" },
          "amount": { "type": "number" }
        }
      }
    },
    "discount_total": { "type": "number" },
    "grand_total": { "type": "number" },
    "grand_total_confidence": { "type": "number" },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description", "quantity", "unit_price", "line_total"],
        "properties": {
          "line_number": { "type": "integer" },
          "item_code": { "type": ["string", "null"] },
          "description": { "type": "string" },
          "quantity": { "type": "number" },
          "uom": { "type": ["string", "null"] },
          "unit_price": { "type": "number" },
          "tax_rate_pct": { "type": "number" },
          "tax_amount": { "type": "number" },
          "line_total": { "type": "number" },
          "confidence": { "type": "number" },
          "bbox": {
            "type": "array",
            "items": { "type": "number" },
            "description": "[ymin, xmin, ymax, xmax] normalized 0-1000"
          }
        }
      }
    }
  }
}
```

### 2.2 Deterministic Post-Extraction Validation
Before rendering to the user, the backend executes mathematical integrity checks:
1. **Line Sum Verification:**
   $$\left| \sum_{j} \text{line\_total}_j - \text{subtotal} \right| \le 0.05$$
2. **Line Arithmetic Verification:**
   $$\forall j, \quad \left| (\text{quantity}_j \times \text{unit\_price}_j) - \text{line\_total}_j \right| \le 0.05$$
3. **Grand Total Verification:**
   $$\left| (\text{subtotal} + \text{tax\_total} - \text{discount\_total}) - \text{grand\_total} \right| \le 0.05$$
*If any validation fails, the invoice status is tagged `VALIDATION_WARNING` and the UI marks the discrepancy with an arithmetic warning badge.*

### 2.3 Split-Screen Human Correction UI
* **Left Panel:** High-resolution SVG/Canvas document viewer with zoom, rotate, and interactive SVG bounding box overlays. Clicking any field in the right panel highlights its source bounding box on the PDF.
* **Right Panel:** Tabular spreadsheet-like editing grid:
  * Confidence $\ge 0.85$: Standard neutral UI styling.
  * Confidence $< 0.85$: Amber background pill indicating manual verification recommended.
  * Missing required values: Red border with instant field validation tooltips.
* **Keyboard Hotkeys:**
  * `Tab` / `Shift+Tab`: Jump between extracted fields.
  * `Ctrl+Enter` / `Cmd+Enter`: Confirm extraction and immediately trigger 3-Way Matching Engine.
  * `Alt+A`: Add new line item.
  * `Alt+D`: Delete current line item.

---

## 3. 3-Way Matching Engine Specification

### 3.1 Document Linking & PO Resolution
When an invoice is submitted for matching:
1. **Pass 1 (Direct Reference):** Look up PO where `po_number` matches `invoice.po_reference` (case-insensitive, whitespace and leading zeroes stripped).
2. **Pass 2 (Vendor + Amount Link):** If `po_reference` is null or invalid, query open POs for the same `vendor_id` where:
   $$\left| \text{PO.total\_amount} - \text{Invoice.grand\_total} \right| \le \text{PO.total\_amount} \times 0.05$$
   and `PO.order_date` is within 60 days preceding `Invoice.invoice_date`.
3. If Pass 1 and Pass 2 fail $\implies$ Raise exception `PO_NOT_FOUND`.

```
                      INVOICE SUBMITTED
                              │
                              ▼
                   Has Valid PO Reference?
                     ├── Yes ──► Link PO
                     └── No  ──► Search Open POs by Vendor & Total
                                   ├── Found 1 match ──► Candidate PO (Prompt user)
                                   └── None ───────────► EXCEPTION: PO_NOT_FOUND
                              │
                              ▼
                   Gather all linked GRNs
                              │
                              ▼
            Gather all prior Invoices for this PO
                              │
                              ▼
             Execute Line-by-Line Match Engine
```

### 3.2 Line Item Mapping Logic
Each invoice line $\mathcal{I}_j$ is mapped to a purchase order line $\mathcal{P}_i$:
1. **Direct SKU Match:** Exact match between `Normalize(I_j.item_code)` and `Normalize(P_i.item_code)`.
2. **Fuzzy Description Similarity:** Token-Sort Cosine Similarity $S(\mathcal{I}_j.\text{desc}, \mathcal{P}_i.\text{desc})$.
   * If highest score $S \ge 0.88 \implies$ Auto-map to $\mathcal{P}_i$.
   * If $0.70 \le S < 0.88 \implies$ Suggest mapping with amber indicator requiring clerk 1-click confirmation.
   * If $S < 0.70 \implies$ No match found $\implies$ Raise `ITEM_NOT_ON_PO`.

### 3.3 The Core Matching Formulas

For each mapped line pair $(\mathcal{I}_j, \mathcal{P}_i)$:

#### Step 1: Calculate Billable Quantity
Let:
* $\mathcal{G}(\mathcal{P}_i)$ be the set of all received quantities across all GRNs linked to $\mathcal{P}_i$:
  $$Q_{\text{received}} = \sum_{g} \text{grn\_lines.received\_qty}$$
* $\mathcal{H}(\mathcal{P}_i)$ be the set of all previously invoiced quantities from already approved/paid invoices linked to $\mathcal{P}_i$:
  $$Q_{\text{prior\_invoiced}} = \sum_{h} \text{invoice\_lines.quantity}$$

Then the Net Billable Quantity is:
$$Q_{\text{billable}} = \max\left(0,\, Q_{\text{received}} - Q_{\text{prior\_invoiced}}\right)$$

#### Step 2: Quantity Reconciliation & Tolerances
Calculate Quantity Variance:
$$\Delta Q = \mathcal{I}_j.\text{quantity} - Q_{\text{billable}}$$

* **Case A: Zero GRN:**
  $$\text{If } Q_{\text{received}} == 0 \implies \mathbf{Raise\ EXCEPTION(GRN\_MISSING)}$$
* **Case B: Overbilling vs Received:**
  $$\text{If } \Delta Q > 0:$$
  Check if within Quantity Tolerance:
  $$\text{Qty\_Passed} \iff \Delta Q \le \max\left( Q_{\text{billable}} \times \frac{\text{Tol}_{qty\%}}{100},\, \text{Tol}_{qty\_abs} \right)$$
  If false $\implies \mathbf{Raise\ EXCEPTION(QTY\_BILLED\_EXCEEDS\_RECEIVED)}$
* **Case C: Over-Delivery vs PO Order:**
  $$\text{If } (Q_{\text{prior\_invoiced}} + \mathcal{I}_j.\text{quantity}) > \mathcal{P}_i.\text{ordered\_qty} \times \left(1 + \frac{\text{Tol}_{qty\%}}{100}\right) \implies \mathbf{Raise\ EXCEPTION(QTY\_BILLED\_EXCEEDS\_ORDERED)}$$

#### Step 3: Price Reconciliation & Tolerances
Calculate Unit Price Variance:
$$\Delta P = \mathcal{I}_j.\text{unit\_price} - \mathcal{P}_i.\text{unit\_price}$$

* If $\Delta P \le 0 \implies$ **PASS** (Vendor billed at or below agreed contract price).
* If $\Delta P > 0 \implies$ Vendor billed higher than PO.
  Evaluate Price Tolerance:
  $$\text{Price\_Passed} \iff \Delta P \le \mathcal{P}_i.\text{unit\_price} \times \frac{\text{Tol}_{price\%}}{100} \quad\mathbf{OR}\quad \Delta P \le \text{Tol}_{price\_abs}$$
  If false $\implies \mathbf{Raise\ EXCEPTION(PRICE\_HIGHER)}$

#### Step 4: Tax & Currency Checks
* **Currency:** $\mathcal{I}.\text{currency} == \mathcal{P}.\text{currency}$. If mismatch $\implies \mathbf{Raise\ EXCEPTION(CURRENCY\_MISMATCH)}$.
* **Tax Rate:** $|\mathcal{I}_j.\text{tax\_rate\_pct} - \mathcal{P}_i.\text{tax\_rate\_pct}| \le 0.5\%$. If mismatch $\implies \mathbf{Raise\ EXCEPTION(TAX\_MISMATCH)}$.

### 3.4 Match Status Determination State Machine
```
                       EVALUATE ALL LINES
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
       Any Exception Raised?         All Lines Passed?
               │                               │
              Yes                              │
               │                               ▼
               ▼                     Any Line Used Tolerance?
     STATUS: EXCEPTION                         │
                                     ┌─────────┴─────────┐
                                     ▼                   ▼
                                    Yes                  No
                                     │                   │
                                     ▼                   ▼
                        STATUS: MATCHED_TOLERANCE   STATUS: MATCHED_EXACT
```

---

## 4. Complex Transaction Edge Cases

### 4.1 Partial Deliveries & Split Invoicing (The Multi-Invoice Lifecycle)
Consider an order for 1,000 units of widgets at $10.00 each on `PO-100`:
* **Event 1:** Warehouse receives shipment 1 of 400 units $\rightarrow$ `GRN-01` ($Q_{\text{received}} = 400$).
* **Event 2:** Vendor sends `INV-A` for 400 units @ $10.00.
  * $Q_{\text{billable}} = 400 - 0 = 400$.
  * Invoice Qty = 400. Variance = 0.
  * **Result:** `MATCHED_EXACT`. Approved. $Q_{\text{prior\_invoiced}}$ becomes 400.
* **Event 3:** Vendor erroneously sends `INV-B` for 600 units before next shipment arrives.
  * $Q_{\text{received}} = 400$. $Q_{\text{prior\_invoiced}} = 400$.
  * $Q_{\text{billable}} = \max(0, 400 - 400) = 0$.
  * Invoice Qty = 600. Variance = $+600$.
  * **Result:** $\mathbf{EXCEPTION(QTY\_BILLED\_EXCEEDS\_RECEIVED)}$. Invoice blocked!
* **Event 4:** Warehouse receives shipment 2 of 600 units $\rightarrow$ `GRN-02`.
  * Total $Q_{\text{received}} = 400 + 600 = 1,000$.
  * Re-matching `INV-B` automatically: $Q_{\text{billable}} = 1,000 - 400 = 600$.
  * Variance = 0 $\rightarrow$ `INV-B` clears automatically!

### 4.2 Multiple GRNs Consolidated into a Single Invoice
A vendor delivers 3 separate truckloads over a week (`GRN-1`: 100, `GRN-2`: 150, `GRN-3`: 250), then issues one weekly consolidation invoice for 500 units.
* The engine sums all unbilled GRN quantities for that PO line:
  $$Q_{\text{received}} = 100 + 150 + 250 = 500$$
  $$Q_{\text{prior\_invoiced}} = 0 \implies Q_{\text{billable}} = 500$$
* Invoice quantity 500 matches $Q_{\text{billable}}$ with 0 variance $\rightarrow$ `MATCHED_EXACT`.

### 4.3 Credit Notes & Downward Billing Adjustments
When damaged stock is returned, the vendor issues a Credit Note (`CN-55` for $-50$ units @ $10.00 = -\$500$):
* Credit notes are linked directly to the original invoice `INV-A`.
* Processing the credit note deducts from the cumulative invoiced ledger:
  $$Q_{\text{prior\_invoiced\_new}} = Q_{\text{prior\_invoiced}} - 50$$
* This immediately frees up 50 units of billable capacity on the PO line for replacement shipments.

---

## 5. Duplicate & Fraud Detection Engine

Every incoming invoice undergoes a 2-stage duplicate screening prior to matching.

```
Incoming Invoice: [Vendor: Acme | Inv#: INV-00921 | Total: $1,450.00 | Date: 2026-03-15]
       │
       ▼
[LEVEL 1: Exact Duplicate Filter]
  Hash: MD5(tenant_id + vendor_id + Normalize("INV-00921"))
  ├── Already exists in database?
  └── YES ──► HARD BLOCK: Exception DUPLICATE_EXACT (Reference prior Inv ID)
       │
      NO
       ▼
[LEVEL 2: Fuzzy Near-Duplicate Filter]
  Query records where:
    - vendor_id == current.vendor_id
    - abs(current.date - existing.date) <= 45 days
    - existing.grand_total == current.grand_total
    OR
    - LevenshteinDistance(Normalize(current.inv_no), Normalize(existing.inv_no)) <= 1
  ├── Match found?
  └── YES ──► FLAG: Exception DUPLICATE_SUSPECTED (Route to Controller queue)
       │
      NO
       ▼
Pass to 3-Way Match
```

### Normalization Routine:
```python
def normalize_invoice_number(raw_num: str) -> str:
    # Remove all whitespace, hyphens, slashes, and leading zeroes
    cleaned = re.sub(r'[\s\-_/\\.]', '', raw_num).upper()
    return cleaned.lstrip('0')
```
*Example:* `INV-00921`, `inv/921`, and `INV_921` all normalize to `INV921`, catching attempted duplicate submissions across different formats.

---

## 6. Exception Management & Resolution Workflows

### 6.1 Exception Lifecycle States
An exception progresses through a controlled state machine:
```
[ OPEN ] ──► [ UNDER_INVESTIGATION ] ──► [ RESOLVED_OVERRIDDEN ]
   │                    │             ──► [ RESOLVED_REMATCHED ]
   │                    │             ──► [ REJECTED ]
   └────────────────────┴─────────────► [ PENDING_CREDIT_NOTE ]
```

### 6.2 Resolution Actions & Audit Requirements
| User Action | Permitted Roles | Required User Inputs | System Action |
| :--- | :--- | :--- | :--- |
| **Approve / Override** | Controller, Admin | Mandatory Reason Category + Written Explanation | Clears exception; records override in immutable audit trail; routes to payment queue. |
| **Reject Bill** | AP Clerk, Controller | Rejection Reason from standard list | Marks invoice `REJECTED`; generates dispute summary PDF; marks PO lines as unbilled. |
| **Request Credit Note** | AP Clerk, Procurement | Credit Note Amount expected | Moves invoice to `PENDING_CREDIT_NOTE` state; freezes payment until credit note is uploaded. |
| **Trigger Re-Match** | AP Clerk, Warehouse | None | Re-runs 3-way matching engine against newly arrived GRNs or updated PO revisions. |
| **Reassign** | Any | Assignee User ID + Internal Comment | Updates task owner; triggers email & in-app notification. |

### 6.3 SLA Monitoring & Escalations
* Default SLA: **3 business days** to resolve open exceptions.
* Automated Reminders:
  * **Day 2 (T-24h):** In-app notification and email reminder sent to assigned reviewer.
  * **Day 3 (Breach):** Escalation notification sent to Finance Controller; dashboard tags exception with an "SLA Breached" badge.

---

## 7. Vendor Management & Scorecards

### 7.1 Vendor Master Data Structure
Each vendor record contains:
* `vendor_id`, `name`, `tax_id` (GSTIN / EIN / VAT), `contact_email`, `currency`, `payment_terms_days`.
* `default_tolerances`: Custom price/qty tolerance overrides for this vendor.
* `gl_account_code`: Default general ledger expense account for accounting export.

### 7.2 Vendor Error-Rate Scoring Algorithm
Matchly calculates a live **Vendor Trust Index** (0 to 100) based on historical performance over a rolling 90-day window:

$$\text{Score} = 100 - \left( w_1 \cdot \text{ErrRate} + w_2 \cdot \text{OverbillRate} + w_3 \cdot \text{DupAttempts} \right)$$

Where:
* $\text{ErrRate} = \frac{\text{Invoices with Exceptions}}{\text{Total Invoices Received}} \times 100$ (Weight $w_1 = 0.50$).
* $\text{OverbillRate} = \frac{\text{Total Overbilled Dollars Detected}}{\text{Total Spend}} \times 100$ (Weight $w_2 = 0.35$).
* $\text{DupAttempts} = \text{Count of Duplicate Invoices Attempted} \times 5$ (Weight $w_3 = 0.15$).

**Score Tiering:**
* **90 – 100 (Tier A / Preferred):** High billing accuracy; eligible for automatic straight-through payment clearing.
* **70 – 89 (Tier B / Standard):** Normal tolerance checks applied.
* **< 70 (Tier C / High Risk):** Strict 0% tolerances enforced; all invoices require Finance Controller sign-off.

---

## 8. Amount-Threshold Approval Rules

### 8.1 Approval Routing Matrix
When an invoice is matched or overridden, it is routed based on gross invoice value:

```
                      INVOICE CLEARED FROM MATCH / OVERRIDE
                                        │
                                        ▼
                           Grand Total <= $2,500?
                             ├── Yes ──► Status: AUTO_APPROVED
                             └── No
                                  │
                                  ▼
                     $2,500 < Grand Total <= $10,000?
                             ├── Yes ──► Requires: AP Lead / Procurement Sign-off
                             └── No
                                  │
                                  ▼
                           Grand Total > $10,000 OR Overridden Exception
                                  └── Requires: Finance Controller / CFO Sign-off
```

### 8.2 1-Click Secure Email Approval (v1.1 Roadmap)
Approvers receive an actionable email notification with line diffs and two cryptographically signed buttons: `[Approve]` and `[Reject]`. The links contain short-lived HMAC-signed JWT tokens allowing one-click execution without requiring full desktop login.

---

## 9. Dashboard, Analytics & Reporting Engine

```
┌────────────────────────────────────────────────────────────────────────┐
│                      FINANCIAL CONTROLLER DASHBOARD                    │
├───────────────────┬───────────────────┬────────────────────────────────┤
│   Auto-Match STP  │  Money Protected  │       Open Exceptions          │
│       78.4%       │    $14,820.50     │     12 Invoices ($18.2K)       │
│  (▲ 3.2% vs last) │ (Overbill+Dups)   │   (3 Breaching 3-day SLA)      │
├───────────────────┴───────────────────┴────────────────────────────────┤
│  MATCH FUNNEL: [ 78.4% Matched ] [ 11.2% Within Tol ] [ 10.4% Except ] │
├───────────────────────────────────────┬────────────────────────────────┤
│  EXCEPTIONS BY REASON CODE            │  AP AGING BUCKETS              │
│  - Price Higher:        42%           │  - 0 to 2 days:    8 invoices  │
│  - Qty > Received:      28%           │  - 3 to 5 days:    3 invoices  │
│  - GRN Missing:         18%           │  - > 5 days:       1 invoice   │
│  - Duplicate Suspected: 12%           │                                │
└───────────────────────────────────────┴────────────────────────────────┘
```

### 9.1 KPI Formulations
1. **Straight-Through Processing (STP) Rate:**
   $$\text{STP \%} = \frac{\text{Count}(\text{MATCHED\_EXACT})}{\text{Total Invoices Processed}} \times 100$$
2. **Money Protected KPI:**
   $$\text{Money Protected} = \sum (\text{Overbilled Price Variance}) + \sum (\text{Overbilled Qty Variance} \times \text{Price}) + \sum (\text{Intercepted Duplicates})$$
3. **AP Aging Tracker:**
   Categorizes unapproved invoices into `< 3 days`, `3–7 days`, and `> 7 days` from upload date.

---

## 10. Accounting Export Engine (CSV & API)

Matchly generates ready-to-import CSV files tailored specifically to the major SMB accounting platforms.

### 10.1 QuickBooks Online Bill Import Format
```csv
Bill No,Vendor,Bill Date,Due Date,Terms,Account,Line Description,Line Amount,Line Billable Status
INV-9821,Acme Industrial Supplies,03/15/2026,04/14/2026,Net 30,Cost of Goods Sold,Hex Bolt M8 50mm,450.00,NotBillable
INV-9821,Acme Industrial Supplies,03/15/2026,04/14/2026,Net 30,Cost of Goods Sold,Steel Lock Nut M8,150.00,NotBillable
```

### 10.2 Xero Payables Import Format
```csv
*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Total,*Description,*Quantity,*UnitAmount,*AccountCode,*TaxType
Acme Industrial Supplies,INV-9821,15/03/2026,14/04/2026,600.00,Hex Bolt M8 50mm,1000,0.45,300,Tax on Purchases
Acme Industrial Supplies,INV-9821,15/03/2026,14/04/2026,600.00,Steel Lock Nut M8,1000,0.15,300,Tax on Purchases
```

### 10.3 Tally Prime XML / CSV Format
Provides Ledger mapping with `VOUCHERTYPE="Purchase"` and explicit `LEDGERNAME` tags for IGST/CGST/SGST tax accounting.

---

## 11. Multi-Tenant SaaS & Stripe Billing Architecture

### 11.1 Plan Tiers & Resource Quotas
```
┌──────────────────────────┬──────────────────────────┬──────────────────────────┐
│      Starter ($49/mo)    │     Growth ($199/mo)     │      Scale ($499/mo)     │
├──────────────────────────┼──────────────────────────┼──────────────────────────┤
│ - 150 Invoices / Month   │ - 1,200 Invoices / Month │ - 4,500 Invoices / Month │
│ - 2 User Seats           │ - 8 User Seats           │ - Unlimited Seats        │
│ - Standard 3-Way Engine  │ - Custom Tolerances/Vend │ - Dedicated Webhooks/API │
│ - CSV Import/Export      │ - Amount Approval Tiers  │ - Custom Export Mappings │
│ - Overage: $0.25 / inv   │ - Overage: $0.18 / inv   │ - Overage: $0.12 / inv   │
└──────────────────────────┴──────────────────────────┴──────────────────────────┘
```

### 11.2 Stripe Billing Integration Flow
1. **Checkout Session:** When upgrading from the 14-day free trial, frontend redirects to Stripe Checkout with `customer_id` and `price_id`.
2. **Webhook Synchronization:**
   * `checkout.session.completed`: Upgrades tenant subscription status to `ACTIVE` and records `stripe_customer_id`.
   * `customer.subscription.updated` / `deleted`: Updates subscription status and resets billing period quotas.
   * `invoice.payment_failed`: Marks tenant `PAST_DUE` and sends email notification.
3. **Metered Ingestion Counter:**
   * Each document upload increments `invoices_processed_count` in Redis.
   * If usage reaches 85% of monthly quota, trigger an in-app banner warning.
   * If usage exceeds quota, bill overage via Stripe Metered Billing items or require immediate plan upgrade.
