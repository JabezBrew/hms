import { useState, useCallback } from 'react';
import { billingApi } from '@/lib/api/billing';
import { toast } from 'sonner';

/**
 * Format payment method for display
 */
function formatPaymentMethod(method) {
  const methods = {
    cash: 'Cash',
    card: 'Credit/Debit Card',
    mobile_money: 'Mobile Money',
    bank_transfer: 'Bank Transfer',
    insurance: 'Insurance',
  };
  return methods[method] || method;
}

/**
 * Generate receipt HTML content
 */
function generateReceiptHtml(receiptData, payment) {
  // Generate items HTML
  const itemsHtml = receiptData.invoice_items && receiptData.invoice_items.length > 0
    ? `
      <div class="items-section">
        <div class="section-title">Services/Items</div>
        <table class="items-table">
          <thead>
            <tr>
              <th class="item-name">Description</th>
              <th class="item-qty">Qty</th>
              <th class="item-price">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${receiptData.invoice_items.map(item => `
              <tr>
                <td class="item-name">${item.service_name}${item.description ? `<br><span class="item-desc">${item.description}</span>` : ''}</td>
                <td class="item-qty">${item.quantity}</td>
                <td class="item-price">GH₵${parseFloat(item.total_price).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    : '';

  // Calculate totals
  const subtotal = parseFloat(receiptData.invoice_subtotal || 0);
  const tax = parseFloat(receiptData.invoice_tax || 0);
  const discount = parseFloat(receiptData.invoice_discount || 0);
  const total = parseFloat(receiptData.invoice_total || 0);
  const amountPaid = parseFloat(receiptData.payment_details?.amount || payment?.amount || 0);
  const balanceDue = parseFloat(receiptData.invoice_balance_due || 0);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt ${receiptData.receipt_number}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'IBM Plex Mono', 'Courier New', monospace; padding: 20px; max-width: 400px; margin: 0 auto; font-size: 12px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 15px; }
        .header h1 { font-size: 18px; margin: 0 0 5px 0; }
        .header p { margin: 3px 0; font-size: 11px; color: #666; }
        .receipt-number { font-size: 13px; font-weight: bold; margin: 10px 0; padding: 8px; background: #f5f5f5; }
        .details { margin: 15px 0; }
        .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #ddd; }
        .row:last-child { border-bottom: none; }
        .label { color: #666; font-size: 11px; }
        .value { font-weight: 500; font-size: 11px; text-align: right; }
        .section-title { font-weight: bold; font-size: 12px; margin: 15px 0 10px 0; padding-bottom: 5px; border-bottom: 1px solid #333; }
        .items-section { margin: 15px 0; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .items-table th { text-align: left; padding: 5px 3px; border-bottom: 1px solid #333; font-weight: 600; }
        .items-table td { padding: 5px 3px; border-bottom: 1px dashed #ddd; vertical-align: top; }
        .item-name { width: 60%; }
        .item-qty { width: 15%; text-align: center; }
        .item-price { width: 25%; text-align: right; }
        .item-desc { font-size: 10px; color: #666; }
        .totals-section { margin-top: 15px; padding-top: 10px; border-top: 2px solid #333; }
        .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
        .totals-row.total { font-weight: bold; font-size: 13px; border-top: 1px solid #333; margin-top: 5px; padding-top: 8px; }
        .totals-row.paid { color: #2e7d32; font-weight: bold; }
        .totals-row.balance { color: ${balanceDue > 0 ? '#c62828' : '#2e7d32'}; }
        .footer { text-align: center; margin-top: 25px; padding-top: 15px; border-top: 1px dashed #ddd; font-size: 10px; color: #666; }
        @media print { body { padding: 10px; } }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Payment Receipt</h1>
        <p>${receiptData.facility_name || 'Hospital Management System'}</p>
      </div>
      <div class="receipt-number">Receipt #${receiptData.receipt_number}</div>
      <div class="details">
        <div class="row">
          <span class="label">Date</span>
          <span class="value">${new Date(receiptData.receipt_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
        <div class="row">
          <span class="label">Invoice</span>
          <span class="value">${receiptData.invoice_number}</span>
        </div>
        <div class="row">
          <span class="label">Patient</span>
          <span class="value">${receiptData.patient_name || 'N/A'}</span>
        </div>
        <div class="row">
          <span class="label">MRN</span>
          <span class="value">${receiptData.patient_mrn || 'N/A'}</span>
        </div>
        <div class="row">
          <span class="label">Payment Method</span>
          <span class="value">${formatPaymentMethod(receiptData.payment_details?.payment_method || payment?.payment_method)}</span>
        </div>
        ${receiptData.payment_details?.reference_number ? `<div class="row"><span class="label">Reference</span><span class="value">${receiptData.payment_details.reference_number}</span></div>` : ''}
      </div>

      ${itemsHtml}

      <div class="totals-section">
        ${receiptData.invoice_items && receiptData.invoice_items.length > 0 ? `
          <div class="totals-row">
            <span>Subtotal</span>
            <span>GH₵${subtotal.toFixed(2)}</span>
          </div>
          ${tax > 0 ? `<div class="totals-row"><span>Tax</span><span>GH₵${tax.toFixed(2)}</span></div>` : ''}
          ${discount > 0 ? `<div class="totals-row"><span>Discount</span><span>-GH₵${discount.toFixed(2)}</span></div>` : ''}
          <div class="totals-row total">
            <span>Invoice Total</span>
            <span>GH₵${total.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="totals-row paid">
          <span>Amount Paid</span>
          <span>GH₵${amountPaid.toFixed(2)}</span>
        </div>
        ${balanceDue > 0 ? `
          <div class="totals-row balance">
            <span>Balance Due</span>
            <span>GH₵${balanceDue.toFixed(2)}</span>
          </div>
        ` : `
          <div class="totals-row balance">
            <span>Balance</span>
            <span>Paid in Full</span>
          </div>
        `}
      </div>

      <div class="footer">
        <p>Thank you for your payment</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
      </div>
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;
}

/**
 * Generate invoice HTML content for printing
 */
function generateInvoiceHtml(invoiceData) {
  // Generate items HTML
  const itemsHtml = invoiceData.items && invoiceData.items.length > 0
    ? `
      <div class="items-section">
        <div class="section-title">Services/Items</div>
        <table class="items-table">
          <thead>
            <tr>
              <th class="item-name">Description</th>
              <th class="item-qty">Qty</th>
              <th class="item-unit">Unit Price</th>
              <th class="item-price">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${invoiceData.items.map(item => `
              <tr>
                <td class="item-name">${item.service_name || item.service?.name || 'Service'}${item.description ? `<br><span class="item-desc">${item.description}</span>` : ''}</td>
                <td class="item-qty">${item.quantity}</td>
                <td class="item-unit">GH₵${parseFloat(item.unit_price).toFixed(2)}</td>
                <td class="item-price">GH₵${parseFloat(item.total_price).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    : '';

  // Calculate totals
  const subtotal = parseFloat(invoiceData.subtotal || 0);
  const tax = parseFloat(invoiceData.tax_amount || 0);
  const discount = parseFloat(invoiceData.discount_amount || 0);
  const insuranceAmount = parseFloat(invoiceData.insurance_amount || 0);
  const total = parseFloat(invoiceData.total_amount || 0);
  const amountPaid = parseFloat(invoiceData.amount_paid || 0);
  const balanceDue = parseFloat(invoiceData.balance_due || 0);

  // Get status badge color
  const statusColors = {
    draft: '#9e9e9e',
    pending: '#ff9800',
    partially_paid: '#2196f3',
    paid: '#4caf50',
    overdue: '#f44336',
    cancelled: '#9e9e9e',
    voided: '#9e9e9e',
  };
  const statusColor = statusColors[invoiceData.status] || '#666';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice ${invoiceData.invoice_number}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'IBM Plex Mono', 'Courier New', monospace; padding: 30px; max-width: 800px; margin: 0 auto; font-size: 12px; }
        .header { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
        .header-left h1 { font-size: 24px; margin: 0 0 5px 0; }
        .header-left p { margin: 3px 0; font-size: 11px; color: #666; }
        .header-right { text-align: right; }
        .invoice-number { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
        .invoice-status { display: inline-block; padding: 4px 12px; border-radius: 4px; color: white; font-size: 11px; font-weight: 600; text-transform: uppercase; background: ${statusColor}; }
        .info-section { display: flex; justify-content: space-between; margin: 20px 0; }
        .info-box { width: 48%; }
        .info-box h3 { font-size: 11px; font-weight: 600; color: #666; text-transform: uppercase; margin: 0 0 8px 0; letter-spacing: 0.5px; }
        .info-row { padding: 4px 0; font-size: 11px; }
        .info-label { color: #666; }
        .section-title { font-weight: bold; font-size: 12px; margin: 20px 0 10px 0; padding-bottom: 5px; border-bottom: 1px solid #333; }
        .items-section { margin: 20px 0; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .items-table th { text-align: left; padding: 8px 5px; border-bottom: 2px solid #333; font-weight: 600; }
        .items-table td { padding: 8px 5px; border-bottom: 1px dashed #ddd; vertical-align: top; }
        .item-name { width: 45%; }
        .item-qty { width: 10%; text-align: center; }
        .item-unit { width: 20%; text-align: right; }
        .item-price { width: 25%; text-align: right; }
        .item-desc { font-size: 10px; color: #666; }
        .totals-section { margin-top: 20px; margin-left: auto; width: 300px; }
        .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 11px; }
        .totals-row.subtotal { border-top: 1px solid #ddd; padding-top: 10px; }
        .totals-row.total { font-weight: bold; font-size: 14px; border-top: 2px solid #333; margin-top: 5px; padding-top: 10px; }
        .totals-row.paid { color: #2e7d32; }
        .totals-row.balance { color: ${balanceDue > 0 ? '#c62828' : '#2e7d32'}; font-weight: bold; }
        .insurance-note { font-size: 10px; color: #666; margin-top: 5px; }
        .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px dashed #ddd; font-size: 10px; color: #666; }
        .payment-info { margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 4px; }
        .payment-info h3 { font-size: 11px; font-weight: 600; margin: 0 0 10px 0; }
        @media print {
          body { padding: 15px; }
          .invoice-status { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <h1>INVOICE</h1>
          <p>${invoiceData.facility_name || 'Hospital Management System'}</p>
        </div>
        <div class="header-right">
          <div class="invoice-number">${invoiceData.invoice_number}</div>
          <div class="invoice-status">${invoiceData.status?.replace('_', ' ') || 'Pending'}</div>
        </div>
      </div>

      <div class="info-section">
        <div class="info-box">
          <h3>Bill To</h3>
          <div class="info-row"><strong>${invoiceData.patient_name || 'N/A'}</strong></div>
          <div class="info-row">MRN: ${invoiceData.patient_mrn || 'N/A'}</div>
        </div>
        <div class="info-box" style="text-align: right;">
          <h3>Invoice Details</h3>
          <div class="info-row"><span class="info-label">Invoice Date:</span> ${new Date(invoiceData.invoice_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          <div class="info-row"><span class="info-label">Due Date:</span> ${invoiceData.due_date ? new Date(invoiceData.due_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</div>
          ${invoiceData.encounter_number ? `<div class="info-row"><span class="info-label">Encounter:</span> ${invoiceData.encounter_number}</div>` : ''}
        </div>
      </div>

      ${itemsHtml}

      <div class="totals-section">
        <div class="totals-row subtotal">
          <span>Subtotal</span>
          <span>GH₵${subtotal.toFixed(2)}</span>
        </div>
        ${tax > 0 ? `<div class="totals-row"><span>Tax</span><span>GH₵${tax.toFixed(2)}</span></div>` : ''}
        ${discount > 0 ? `<div class="totals-row"><span>Discount</span><span>-GH₵${discount.toFixed(2)}</span></div>` : ''}
        <div class="totals-row total">
          <span>Total Amount</span>
          <span>GH₵${total.toFixed(2)}</span>
        </div>
        ${insuranceAmount > 0 ? `
          <div class="totals-row">
            <span>Insurance Coverage</span>
            <span>-GH₵${insuranceAmount.toFixed(2)}</span>
          </div>
          <div class="insurance-note">* Pending insurance claim approval</div>
        ` : ''}
        ${amountPaid > 0 ? `
          <div class="totals-row paid">
            <span>Amount Paid</span>
            <span>-GH₵${amountPaid.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="totals-row balance">
          <span>Balance Due</span>
          <span>GH₵${balanceDue.toFixed(2)}</span>
        </div>
      </div>

      ${invoiceData.notes ? `
        <div class="payment-info">
          <h3>Notes</h3>
          <p>${invoiceData.notes}</p>
        </div>
      ` : ''}

      <div class="footer">
        <p>Thank you for choosing our services</p>
        <p>Generated: ${new Date().toLocaleString()}</p>
      </div>
      <script>window.onload = function() { window.print(); }</script>
    </body>
    </html>
  `;
}

/**
 * Hook for printing receipts and invoices with loading state
 *
 * @returns {Object} { printReceipt, printInvoice, printingId, isPrinting }
 *
 * @example
 * const { printReceipt, printInvoice, printingId } = useReceiptPrint();
 *
 * // Print receipt
 * <Button
 *   onClick={() => printReceipt(payment)}
 *   disabled={printingId === payment.id}
 * >
 *   {printingId === payment.id ? 'Loading...' : 'Print Receipt'}
 * </Button>
 *
 * // Print invoice
 * <Button
 *   onClick={() => printInvoice(invoice.id)}
 *   disabled={printingId === invoice.id}
 * >
 *   {printingId === invoice.id ? 'Loading...' : 'Print Invoice'}
 * </Button>
 */
export function useReceiptPrint() {
  const [printingId, setPrintingId] = useState(null);

  const printReceipt = useCallback(async (payment) => {
    if (!payment.receipt_id) {
      toast.error('No receipt available for this payment');
      return;
    }

    setPrintingId(payment.id);

    try {
      // Fetch full receipt details including invoice items (also logs audit)
      const receiptData = await billingApi.getReceiptPrintDetail(payment.receipt_id);

      // Generate and open print window
      const receiptWindow = window.open('', '_blank', 'width=450,height=700');
      if (!receiptWindow) {
        toast.error('Please allow popups to print receipts');
        return;
      }

      const receiptContent = generateReceiptHtml(receiptData, payment);
      receiptWindow.document.write(receiptContent);
      receiptWindow.document.close();
    } catch (err) {
      toast.error('Failed to load receipt details');
      console.error('Receipt print error:', err);
    } finally {
      setPrintingId(null);
    }
  }, []);

  const printInvoice = useCallback(async (invoiceId) => {
    if (!invoiceId) {
      toast.error('No invoice ID provided');
      return;
    }

    setPrintingId(invoiceId);

    try {
      // Fetch invoice details for printing (also logs audit)
      const invoiceData = await billingApi.getInvoicePrintDetail(invoiceId);

      // Generate and open print window
      const invoiceWindow = window.open('', '_blank', 'width=850,height=700');
      if (!invoiceWindow) {
        toast.error('Please allow popups to print invoices');
        return;
      }

      const invoiceContent = generateInvoiceHtml(invoiceData);
      invoiceWindow.document.write(invoiceContent);
      invoiceWindow.document.close();
    } catch (err) {
      toast.error('Failed to load invoice for printing');
      console.error('Invoice print error:', err);
    } finally {
      setPrintingId(null);
    }
  }, []);

  return {
    printReceipt,
    printInvoice,
    printingId,
    isPrinting: printingId !== null,
  };
}

export default useReceiptPrint;
