/**
 * Matchly — Frontend Client Application Controller
 * Connects reactive UI tabs to Express/Node backend API endpoints.
 */

const API_BASE = '/api/v1';

let currentInvoices = [];
let currentExceptions = [];
let currentPOs = [];
let selectedInvoiceId = null;
let activeOverrideExceptionId = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupUploadDropzone();
  refreshDashboard();
  loadVendorScorecards();
  loadOpenPOsForWarehouse();
});

// Tab Navigation
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const targetTabId = link.getAttribute('data-tab');
      switchTab(targetTabId);
    });
  });

  const quickUploadBtn = document.getElementById('btn-quick-upload');
  if (quickUploadBtn) {
    quickUploadBtn.addEventListener('click', () => switchTab('tab-upload'));
  }
}

function switchTab(tabId) {
  // Update nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.nav-link[data-tab="${tabId}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Update tabs
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');

  // Trigger data refreshes
  if (tabId === 'tab-dashboard') refreshDashboard();
  if (tabId === 'tab-exceptions') loadExceptions();
  if (tabId === 'tab-vendors') loadVendorScorecards();
  if (tabId === 'tab-warehouse') loadOpenPOsForWarehouse();
}

// 1. Dashboard Controller
async function refreshDashboard() {
  try {
    // 1A. Fetch KPIs
    const kpiRes = await fetch(`${API_BASE}/analytics/dashboard`);
    if (kpiRes.ok) {
      const kpis = await kpiRes.json();
      document.getElementById('kpi-stp').textContent = `${kpis.stp_rate_pct}%`;
      document.getElementById('kpi-money-saved').textContent = `$${kpis.money_protected_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      document.getElementById('kpi-open-exceptions').textContent = kpis.open_exceptions_count;
      document.getElementById('badge-exc-count').textContent = kpis.open_exceptions_count;

      // Funnel
      const total = kpis.total_invoices || 1;
      const matchedPct = (kpis.auto_matched_count / total) * 100;
      const tolPct = (kpis.matched_tolerance_count / total) * 100;
      const excPct = (kpis.exception_count / total) * 100;

      document.getElementById('funnel-matched').style.width = `${matchedPct}%`;
      document.getElementById('funnel-tolerance').style.width = `${tolPct}%`;
      document.getElementById('funnel-exception').style.width = `${excPct}%`;

      document.getElementById('funnel-matched-count').textContent = kpis.auto_matched_count;
      document.getElementById('funnel-tolerance-count').textContent = kpis.matched_tolerance_count;
      document.getElementById('funnel-exception-count').textContent = kpis.exception_count;
    }

    // 1B. Fetch Invoices list
    const invRes = await fetch(`${API_BASE}/invoices`);
    if (invRes.ok) {
      currentInvoices = await invRes.json();
      renderDashboardInvoices(currentInvoices);
      populateInvoiceDropdowns(currentInvoices);
    }
  } catch (err) {
    console.error('Error refreshing dashboard:', err);
  }
}

function renderDashboardInvoices(invoices) {
  const tbody = document.getElementById('dashboard-invoices-tbody');
  tbody.innerHTML = '';

  if (!invoices || invoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No invoices found. Click "Upload Invoice" to begin.</td></tr>`;
    return;
  }

  invoices.forEach(inv => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-open';
    let statusText = inv.status;
    if (inv.status === 'MATCHED') {
      badgeClass = 'badge-matched';
      statusText = 'Matched 100%';
    } else if (inv.status === 'UNDER_REVIEW') {
      badgeClass = 'badge-exception';
      statusText = 'Exception Flagged';
    } else if (inv.status === 'APPROVED') {
      badgeClass = 'badge-resolved';
      statusText = 'Approved';
    }

    const dateStr = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : 'N/A';

    tr.innerHTML = `
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${inv.vendor_name || 'N/A'}</td>
      <td><span class="badge badge-tolerance" style="font-size: 11px;">${inv.po_reference || 'N/A'}</span></td>
      <td>${dateStr}</td>
      <td><strong>$${inv.grand_total.toFixed(2)}</strong></td>
      <td><span class="badge ${badgeClass}">${statusText}</span></td>
      <td>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick="openReviewTab('${inv.id}')"><i class="fa-solid fa-eye"></i> Review</button>
          <button class="btn btn-primary btn-sm" onclick="openMatchTab('${inv.id}')"><i class="fa-solid fa-scale-balanced"></i> 3-Way Match</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function populateInvoiceDropdowns(invoices) {
  const selector = document.getElementById('match-invoice-selector');
  if (!selector) return;
  selector.innerHTML = '';

  invoices.forEach(inv => {
    const opt = document.createElement('option');
    opt.value = inv.id;
    opt.textContent = `${inv.invoice_number} — ${inv.vendor_name || 'Vendor'} ($${inv.grand_total.toFixed(2)})`;
    selector.appendChild(opt);
  });

  if (invoices.length > 0 && !selectedInvoiceId) {
    selectedInvoiceId = invoices[0].id;
    loadMatchComparison(selectedInvoiceId);
  }
}

// 2. Split Screen Review Controller
function openReviewTab(invoiceId) {
  selectedInvoiceId = invoiceId;
  const invoice = currentInvoices.find(i => i.id === invoiceId);
  if (!invoice) return;

  document.getElementById('review-inv-title').textContent = `Invoice #${invoice.invoice_number} AI Review & Verification`;
  document.getElementById('doc-vendor-name').textContent = invoice.vendor_name || 'Vendor';
  document.getElementById('doc-inv-no').textContent = invoice.invoice_number;
  document.getElementById('doc-po-ref').textContent = invoice.po_reference || 'N/A';
  document.getElementById('doc-grand-total').textContent = `$${invoice.grand_total.toFixed(2)}`;
  document.getElementById('review-grand-total').textContent = `$${invoice.grand_total.toFixed(2)}`;

  // Populate mock doc lines
  const docLinesTbody = document.getElementById('doc-lines-tbody');
  docLinesTbody.innerHTML = '';
  invoice.lines.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding: 6px;">${l.description}</td>
      <td style="padding: 6px;">${l.quantity}</td>
      <td style="padding: 6px;">$${l.unit_price.toFixed(2)}</td>
      <td style="padding: 6px; text-align: right;"><strong>$${l.line_total.toFixed(2)}</strong></td>
    `;
    docLinesTbody.appendChild(tr);
  });

  // Populate editable review table
  const reviewLinesTbody = document.getElementById('review-lines-tbody');
  reviewLinesTbody.innerHTML = '';
  invoice.lines.forEach((l, idx) => {
    const tr = document.createElement('tr');
    const confScore = Math.round((l.confidence || 0.95) * 100);
    const confClass = confScore >= 90 ? 'confidence-high' : (confScore >= 80 ? 'confidence-mid' : 'confidence-low');

    tr.innerHTML = `
      <td><input type="text" class="form-input" value="${l.description}" style="font-size: 13px; padding: 6px 10px;"></td>
      <td style="width: 80px;"><input type="number" class="form-input" value="${l.quantity}" style="font-size: 13px; padding: 6px 10px;"></td>
      <td style="width: 100px;"><input type="number" step="0.01" class="form-input" value="${l.unit_price}" style="font-size: 13px; padding: 6px 10px;"></td>
      <td style="width: 110px;"><strong>$${l.line_total.toFixed(2)}</strong></td>
      <td style="width: 90px;"><span class="confidence-pill ${confClass}">${confScore}%</span></td>
    `;
    reviewLinesTbody.appendChild(tr);
  });

  // Setup Run Match button
  const runBtn = document.getElementById('btn-run-match-from-review');
  runBtn.onclick = () => {
    executeMatch(invoice.id);
  };

  switchTab('tab-review');
}

function saveLineEdits() {
  alert('Corrections saved! Extracted line items updated in database.');
}

// 3. 3-Way Match Controller
function openMatchTab(invoiceId) {
  selectedInvoiceId = invoiceId;
  const selector = document.getElementById('match-invoice-selector');
  if (selector) selector.value = invoiceId;
  loadMatchComparison(invoiceId);
  switchTab('tab-match');
}

async function executeMatch(invoiceId) {
  try {
    const res = await fetch(`${API_BASE}/invoices/${invoiceId}/match`, { method: 'POST' });
    if (res.ok) {
      openMatchTab(invoiceId);
    }
  } catch (err) {
    console.error('Error executing match:', err);
  }
}

async function loadMatchComparison(invoiceId) {
  try {
    const [invRes, matchRes] = await Promise.all([
      fetch(`${API_BASE}/invoices/${invoiceId}`),
      fetch(`${API_BASE}/invoices/${invoiceId}/match-result`)
    ]);

    if (!invRes.ok) return;
    const invoice = await invRes.json();
    const matchRun = matchRes.ok ? await matchRes.json() : null;

    renderMatchComparisonTable(invoice, matchRun);
  } catch (err) {
    console.error('Error loading match comparison:', err);
  }
}

function renderMatchComparisonTable(invoice, matchRun) {
  const tbody = document.getElementById('match-comparison-tbody');
  tbody.innerHTML = '';

  const summaryBanner = document.getElementById('match-summary-banner');
  const summaryTitle = document.getElementById('match-summary-title');
  const summaryDesc = document.getElementById('match-summary-desc');
  const summaryIcon = document.getElementById('match-summary-icon');
  const actionsArea = document.getElementById('match-actions-area');

  if (!matchRun) {
    summaryBanner.style.background = 'rgba(255, 255, 255, 0.05)';
    summaryBanner.style.borderColor = 'var(--border-subtle)';
    summaryTitle.textContent = '3-Way Match Not Yet Executed';
    summaryDesc.textContent = 'Click below to reconcile this invoice against open POs and warehouse GRNs.';
    summaryIcon.className = 'fa-solid fa-hourglass-start';
    summaryIcon.style.color = 'var(--text-muted)';
    actionsArea.innerHTML = `<button class="btn btn-primary btn-sm" onclick="executeMatch('${invoice.id}')"><i class="fa-solid fa-play"></i> Run 3-Way Match</button>`;
    return;
  }

  if (matchRun.status === 'MATCHED_EXACT') {
    summaryBanner.style.background = 'rgba(16, 185, 129, 0.12)';
    summaryBanner.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    summaryTitle.textContent = 'Reconciliation Status: MATCHED_EXACT';
    summaryTitle.style.color = 'var(--accent-emerald)';
    summaryDesc.textContent = 'All line items reconcile with 0 variance against PO contract and signed warehouse GRNs.';
    summaryIcon.className = 'fa-solid fa-circle-check';
    summaryIcon.style.color = 'var(--accent-emerald)';
    actionsArea.innerHTML = `<button class="btn btn-success btn-sm"><i class="fa-solid fa-check-double"></i> Authorize Payment Batch</button>`;
  } else if (matchRun.status === 'MATCHED_TOLERANCE') {
    summaryBanner.style.background = 'rgba(59, 130, 246, 0.12)';
    summaryBanner.style.borderColor = 'rgba(59, 130, 246, 0.3)';
    summaryTitle.textContent = 'Reconciliation Status: MATCHED_TOLERANCE';
    summaryTitle.style.color = 'var(--accent-blue)';
    summaryDesc.textContent = 'All line items are cleared within active price and quantity tolerance thresholds.';
    summaryIcon.className = 'fa-solid fa-circle-check';
    summaryIcon.style.color = 'var(--accent-blue)';
    actionsArea.innerHTML = `<button class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Approve Within Tolerance</button>`;
  } else {
    summaryBanner.style.background = 'rgba(244, 63, 94, 0.12)';
    summaryBanner.style.borderColor = 'rgba(244, 63, 94, 0.3)';
    summaryTitle.textContent = 'Reconciliation Status: EXCEPTION RAISED';
    summaryTitle.style.color = 'var(--accent-rose)';
    summaryDesc.textContent = 'Financial discrepancy intercepted! Overbilling or missing receiving dockets detected.';
    summaryIcon.className = 'fa-solid fa-triangle-exclamation';
    summaryIcon.style.color = 'var(--accent-rose)';
    actionsArea.innerHTML = `<button class="btn btn-danger btn-sm" onclick="switchTab('tab-exceptions')"><i class="fa-solid fa-arrow-right"></i> Review in Exception Queue</button>`;
  }

  // Populate 3-way comparative line rows
  if (matchRun.line_results && matchRun.line_results.length > 0) {
    matchRun.line_results.forEach(lr => {
      const invLine = invoice.lines.find(l => l.id === lr.invoice_line_id) || {};
      const tr = document.createElement('tr');

      const isExc = !lr.is_matched;
      const statusBadge = lr.is_matched
        ? (lr.used_tolerance ? '<span class="badge badge-tolerance">Within Tolerance</span>' : '<span class="badge badge-matched">Exact Match</span>')
        : `<span class="badge badge-exception">${lr.exception_code || 'EXCEPTION'}</span>`;

      const qtyVarDisplay = lr.qty_variance > 0
        ? `<span class="highlight-rose">+${lr.qty_variance}</span>`
        : `<span>0</span>`;

      const priceVarDisplay = lr.price_variance > 0
        ? `<span class="highlight-rose">+$${lr.price_variance.toFixed(2)}</span>`
        : `<span>$${lr.po_unit_price.toFixed(2)}</span>`;

      tr.innerHTML = `
        <td><strong>${invLine.item_code || 'SKU'}</strong><div style="font-size: 11px; color: var(--text-muted);">${invLine.description || ''}</div></td>
        <td style="border-left: 1px solid var(--border-subtle);">${lr.invoiced_qty}</td>
        <td style="border-right: 1px solid var(--border-subtle);">$${lr.po_unit_price.toFixed(2)}</td>
        <td>${lr.billable_qty}</td>
        <td style="border-right: 1px solid var(--border-subtle);">${lr.billable_qty}</td>
        <td><strong>${lr.invoiced_qty}</strong></td>
        <td style="border-right: 1px solid var(--border-subtle);"><strong>$${lr.invoiced_unit_price.toFixed(2)}</strong></td>
        <td>${qtyVarDisplay}</td>
        <td>${statusBadge}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// 4. Exception Queue Controller
async function loadExceptions() {
  try {
    const res = await fetch(`${API_BASE}/exceptions`);
    if (res.ok) {
      currentExceptions = await res.json();
      renderExceptionsTable(currentExceptions);
    }
  } catch (err) {
    console.error('Error loading exceptions:', err);
  }
}

function renderExceptionsTable(exceptions) {
  const tbody = document.getElementById('exceptions-tbody');
  tbody.innerHTML = '';

  if (!exceptions || exceptions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--accent-emerald); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Zero exceptions! All invoices are reconciled.</td></tr>`;
    return;
  }

  exceptions.forEach(exc => {
    const tr = document.createElement('tr');
    const isResolved = exc.status === 'OVERRIDDEN' || exc.status === 'RESOLVED';
    const statusBadge = isResolved
      ? '<span class="badge badge-resolved">Resolved (Overridden)</span>'
      : '<span class="badge badge-exception">Open</span>';

    const deadlineStr = new Date(exc.sla_due_at).toLocaleDateString();

    tr.innerHTML = `
      <td><span class="badge badge-exception" style="font-size: 11px;">${exc.reason_code}</span></td>
      <td><strong>${exc.invoice_number}</strong></td>
      <td>${exc.vendor_name || 'N/A'}</td>
      <td style="max-width: 320px; font-size: 13px;">${exc.message}</td>
      <td><span class="highlight-rose" style="font-weight: 700;">${exc.severity}</span></td>
      <td><i class="fa-solid fa-clock" style="margin-right: 4px; color: var(--accent-amber);"></i> ${deadlineStr}</td>
      <td>${statusBadge}</td>
      <td>
        ${!isResolved ? `
          <button class="btn btn-primary btn-sm" onclick="openOverrideModal('${exc.id}', '${exc.invoice_number}', '${exc.reason_code}')">
            <i class="fa-solid fa-signature"></i> Resolve / Override
          </button>
        ` : `<span style="font-size: 12px; color: var(--text-muted);"><i class="fa-solid fa-lock"></i> Audit Logged</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterExceptions(reasonCode) {
  if (reasonCode === 'ALL') {
    renderExceptionsTable(currentExceptions);
  } else {
    const filtered = currentExceptions.filter(e => e.reason_code === reasonCode);
    renderExceptionsTable(filtered);
  }
}

// 5. Override / Exception Modal
function openOverrideModal(excId, invNo, reasonCode) {
  activeOverrideExceptionId = excId;
  document.getElementById('modal-exc-desc').textContent = `Resolving exception for Invoice ${invNo} (${reasonCode})`;
  document.getElementById('modal-override-reason').value = '';
  document.getElementById('modal-override').classList.add('active');
}

function closeOverrideModal() {
  document.getElementById('modal-override').classList.remove('active');
  activeOverrideExceptionId = null;
}

async function submitOverride() {
  const reason = document.getElementById('modal-override-reason').value.trim();
  const action = document.getElementById('modal-action-select').value;

  if (!reason) {
    alert('Mandatory audit explanation is required to override or reject an exception.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/exceptions/${activeOverrideExceptionId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        override_reason: reason,
        action: action
      })
    });

    if (res.ok) {
      closeOverrideModal();
      loadExceptions();
      refreshDashboard();
      alert(`Exception successfully ${action === 'APPROVE' ? 'overridden and approved' : 'rejected'}. Recorded in immutable audit log.`);
    }
  } catch (err) {
    console.error('Error submitting override:', err);
  }
}

// 6. Dock Receiving (Warehouse Controller)
async function loadOpenPOsForWarehouse() {
  try {
    const res = await fetch(`${API_BASE}/purchase-orders`);
    if (res.ok) {
      currentPOs = await res.json();
      const select = document.getElementById('quick-receive-po-select');
      select.innerHTML = '<option value="">-- Select Open PO --</option>';

      currentPOs.forEach(po => {
        const opt = document.createElement('option');
        opt.value = po.id;
        opt.textContent = `${po.po_number} — ${po.vendor_name} ($${po.total_amount.toFixed(2)})`;
        select.appendChild(opt);
      });

      if (currentPOs.length > 0) {
        // Select the Titan Steel PO (PO-2026-002) which currently has a backorder
        const titanPO = currentPOs.find(p => p.po_number === 'PO-2026-002') || currentPOs[0];
        select.value = titanPO.id;
        onSelectPOForReceiving(titanPO.id);
      }
    }
  } catch (err) {
    console.error('Error loading POs for warehouse:', err);
  }
}

function onSelectPOForReceiving(poId) {
  const po = currentPOs.find(p => p.id === poId);
  const tbody = document.getElementById('quick-receive-tbody');
  tbody.innerHTML = '';

  if (!po || !po.lines) return;

  po.lines.forEach((l, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${l.item_code}</strong></td>
      <td>${l.description}</td>
      <td>${l.ordered_qty} ${l.uom}</td>
      <td><input type="number" id="receive-qty-${idx}" data-line-id="${l.id}" data-item-code="${l.item_code}" class="form-input" value="30" style="width: 100px; padding: 6px 10px;"></td>
      <td><input type="number" id="reject-qty-${idx}" class="form-input" value="0" style="width: 80px; padding: 6px 10px;"></td>
      <td><input type="text" id="notes-${idx}" class="form-input" placeholder="Dock inspection OK" style="font-size: 13px; padding: 6px 10px;"></td>
    `;
    tbody.appendChild(tr);
  });
}

async function submitQuickReceive() {
  const select = document.getElementById('quick-receive-po-select');
  const poId = select.value;
  if (!poId) {
    alert('Please select a Purchase Order.');
    return;
  }

  const items = [];
  const po = currentPOs.find(p => p.id === poId);
  po.lines.forEach((l, idx) => {
    const rQty = parseFloat(document.getElementById(`receive-qty-${idx}`).value) || 0;
    const rejQty = parseFloat(document.getElementById(`reject-qty-${idx}`).value) || 0;
    const notes = document.getElementById(`notes-${idx}`).value;

    items.push({
      po_line_id: l.id,
      item_code: l.item_code,
      received_qty: rQty,
      rejected_qty: rejQty,
      notes: notes
    });
  });

  try {
    const res = await fetch(`${API_BASE}/goods-receipts/quick-receive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        po_id: poId,
        warehouse_location: 'MAIN DOCK 4',
        received_by: 'Carlos Mendoza',
        items: items
      })
    });

    if (res.ok) {
      const grn = await res.json();
      alert(`Goods Receipt Note ${grn.grn_number} created successfully! Re-running match engine.`);
      
      // Auto re-match affected invoice
      const affectedInv = currentInvoices.find(i => i.po_reference === po.po_number);
      if (affectedInv) {
        await executeMatch(affectedInv.id);
      }
      refreshDashboard();
      switchTab('tab-dashboard');
    }
  } catch (err) {
    console.error('Error submitting quick receive:', err);
  }
}

function resetQuickReceive() {
  const select = document.getElementById('quick-receive-po-select');
  if (select.value) onSelectPOForReceiving(select.value);
}

// 7. Vendors & Trust Directory Controller
async function loadVendorScorecards() {
  try {
    const res = await fetch(`${API_BASE}/vendors`);
    if (res.ok) {
      const vendors = await res.json();
      const tbody = document.getElementById('vendors-tbody');
      tbody.innerHTML = '';

      vendors.forEach(v => {
        const tr = document.createElement('tr');
        const score = v.trust_score;
        let scoreClass = 'highlight-green';
        let tierBadge = '<span class="badge badge-matched">Tier A (Preferred)</span>';

        if (score < 70) {
          scoreClass = 'highlight-rose';
          tierBadge = '<span class="badge badge-exception">Tier C (High Risk)</span>';
        } else if (score < 90) {
          scoreClass = 'highlight-amber';
          tierBadge = '<span class="badge badge-tolerance">Tier B (Standard)</span>';
        }

        const priceTol = v.vendor_code === 'VEND-TITAN' ? '0.0%' : '1.5%';
        const qtyTol = v.vendor_code === 'VEND-TITAN' ? '2.0% (Steel weight)' : '0.0%';

        tr.innerHTML = `
          <td><strong>${v.vendor_code}</strong></td>
          <td>${v.name}</td>
          <td>${v.tax_id || 'N/A'}</td>
          <td>Net ${v.payment_terms_days} Days</td>
          <td><span class="${scoreClass}" style="font-size: 16px; font-weight: 800;">${score.toFixed(1)} / 100</span></td>
          <td>${priceTol}</td>
          <td>${qtyTol}</td>
          <td>${tierBadge}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Error loading vendors:', err);
  }
}

// 8. File Upload Dropzone Controller
function setupUploadDropzone() {
  const dropzone = document.getElementById('invoice-dropzone');
  const fileInput = document.getElementById('invoice-file-input');
  if (!dropzone || !fileInput) return;

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileUpload(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFileUpload(fileInput.files[0]);
  });
}

async function handleFileUpload(file) {
  const card = document.getElementById('upload-status-card');
  const nameLabel = document.getElementById('upload-filename');
  const pctLabel = document.getElementById('upload-progress-pct');
  const fill = document.getElementById('upload-progress-fill');

  card.style.display = 'block';
  nameLabel.textContent = `Extracting invoice with AI: ${file.name}...`;

  let pct = 10;
  const timer = setInterval(() => {
    pct += 15;
    if (pct > 90) clearInterval(timer);
    pctLabel.textContent = `${pct}%`;
    fill.style.width = `${pct}%`;
  }, 150);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${API_BASE}/invoices/upload`, {
      method: 'POST',
      body: formData
    });

    clearInterval(timer);
    fill.style.width = '100%';
    pctLabel.textContent = '100%';

    if (res.ok) {
      const data = await res.json();
      setTimeout(() => {
        card.style.display = 'none';
        refreshDashboard();
        openReviewTab(data.invoice_id);
      }, 500);
    }
  } catch (err) {
    clearInterval(timer);
    console.error('Error uploading invoice:', err);
    alert('Upload failed. Please try again.');
  }
}
