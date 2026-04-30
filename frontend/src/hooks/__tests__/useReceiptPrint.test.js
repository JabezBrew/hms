import { describe, expect, it } from 'vitest';
import {
  escapePrintHtml,
  generateInvoiceHtml,
  generateReceiptHtml,
} from '../useReceiptPrint';

function parsePrintHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function expectNoExecutableInjectedMarkup(document) {
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('svg')).toBeNull();
  expect(document.querySelector('[onerror]')).toBeNull();
  expect(document.querySelector('[onload]')).toBeNull();
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
    .toContain("default-src 'none'");
}

describe('billing print HTML generation', () => {
  it('escapes HTML metacharacters for print document text', () => {
    expect(escapePrintHtml(`<img src=x onerror="alert('x')"> &`))
      .toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;');
  });

  it('renders receipt API fields as text instead of executable markup', () => {
    const html = generateReceiptHtml({
      receipt_number: '</title><script>alert(1)</script>',
      facility_name: '<img src=x onerror="alert(1)">',
      receipt_date: '2026-04-30T10:30:00Z',
      invoice_number: 'INV-<svg onload=alert(1)>',
      patient_name: 'Jane <script>alert(1)</script>',
      patient_mrn: 'MRN&<001>',
      payment_details: {
        amount: '12.34',
        payment_method: 'unknown_method<script>alert(1)</script>',
        reference_number: 'REF</span><img src=x onerror=alert(1)>',
      },
      invoice_items: [
        {
          service_name: 'Consult <img src=x onerror=alert(1)>',
          description: 'Desc <svg onload=alert(1)>',
          quantity: '1<script>alert(1)</script>',
          total_price: '12.34',
        },
      ],
      invoice_subtotal: '12.34',
      invoice_tax: '0',
      invoice_discount: '0',
      invoice_total: '12.34',
      invoice_balance_due: '0',
    }, { id: 'payment-1', amount: '12.34', payment_method: 'cash' });

    const document = parsePrintHtml(html);

    expectNoExecutableInjectedMarkup(document);
    expect(document.body.textContent).toContain('Consult <img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('REF</span><img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });

  it('renders invoice API fields as text instead of executable markup', () => {
    const html = generateInvoiceHtml({
      invoice_number: '</title><script>alert(1)</script>',
      facility_name: '<img src=x onerror="alert(1)">',
      status: 'pending<script>alert(1)</script>',
      patient_name: 'Jane <script>alert(1)</script>',
      patient_mrn: 'MRN&<001>',
      invoice_date: '2026-04-30T10:30:00Z',
      due_date: '2026-05-01T10:30:00Z',
      encounter_number: 'ENC</div><svg onload=alert(1)>',
      notes: 'Pay before discharge <img src=x onerror=alert(1)>',
      items: [
        {
          service_name: 'Lab <img src=x onerror=alert(1)>',
          description: 'Panel <svg onload=alert(1)>',
          quantity: '2<script>alert(1)</script>',
          unit_price: '10.00',
          total_price: '20.00',
        },
      ],
      subtotal: '20.00',
      tax_amount: '0',
      discount_amount: '0',
      insurance_amount: '0',
      total_amount: '20.00',
      amount_paid: '0',
      balance_due: '20.00',
    });

    const document = parsePrintHtml(html);

    expectNoExecutableInjectedMarkup(document);
    expect(document.body.textContent).toContain('Lab <img src=x onerror=alert(1)>');
    expect(document.body.textContent).toContain('Pay before discharge <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
});
