import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

function checkEncrypted(buf: Buffer, filePath: string): void {
  const fileName = path.basename(filePath);

  // OLE2 Compound Document (password-protected Office files, HWP)
  if (buf.length >= 8 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
    throw new Error(`암호화된 파일입니다: ${fileName} (OLE2 형식 - 비밀번호 보호)`);
  }

  // ZIP-based files (xlsx, docx, pptx) - check for encrypted flag
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B) {
    // Check general purpose bit flag for encryption (byte offset 6, bit 0)
    if (buf.length >= 8 && (buf[6] & 0x01) !== 0) {
      throw new Error(`암호화된 파일입니다: ${fileName} (ZIP 암호화)`);
    }
    // Check for EncryptedPackage inside OOXML
    const content = buf.toString('binary', 0, Math.min(buf.length, 4096));
    if (content.includes('EncryptedPackage') || content.includes('EncryptionInfo')) {
      throw new Error(`암호화된 파일입니다: ${fileName} (Office 암호화)`);
    }
  }

  // PDF encryption check
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') {
    const head = buf.toString('ascii', 0, Math.min(buf.length, 4096));
    if (head.includes('/Encrypt')) {
      throw new Error(`암호화된 파일입니다: ${fileName} (PDF 비밀번호 보호)`);
    }
  }

  // XML that looks encrypted (binary garbage at start instead of <?xml or <)
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xml') {
    const start = buf.toString('utf-8', 0, Math.min(buf.length, 100)).trim();
    if (!start.startsWith('<?xml') && !start.startsWith('<')) {
      throw new Error(`암호화되었거나 손상된 파일입니다: ${fileName} (올바른 XML 형식이 아님)`);
    }
  }
}

export { checkEncrypted };

interface ParsedInvoice {
  invoice_number: string;
  issue_date: string;
  supplier_id: string;
  supplier_name: string;
  supply_amount: number;
  tax_amount: number;
  total_amount: number;
  line_items: {
    line_number: number;
    item_description: string;
    line_total: number;
    quantity: number | null;
    unit_price: number | null;
  }[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (name) => name === 'TaxInvoiceTradeLineItem',
});

function getText(obj: any, ...keys: string[]): string {
  let current = obj;
  for (const key of keys) {
    if (!current) return '';
    current = current[key];
  }
  if (current == null) return '';
  return String(current).trim();
}

function getNumber(obj: any, ...keys: string[]): number {
  const text = getText(obj, ...keys);
  const num = parseFloat(text);
  return isNaN(num) ? 0 : num;
}

export function parseTaxInvoiceXML(filePath: string): ParsedInvoice {
  const buf = fs.readFileSync(filePath);
  checkEncrypted(buf, filePath);
  const xml = buf.toString('utf-8');
  const parsed = parser.parse(xml);

  const root = parsed.TaxInvoice;
  if (!root) throw new Error('Not a TaxInvoice XML');

  const exchangedDoc = root.ExchangedDocument || {};
  const invoiceDoc = root.TaxInvoiceDocument || {};
  const settlement = root.TaxInvoiceTradeSettlement;
  if (!settlement) throw new Error('Missing TaxInvoiceTradeSettlement');

  const invoice_number = getText(exchangedDoc, 'ID');

  const issueDateRaw = getText(invoiceDoc, 'IssueDateTime')
    || getText(exchangedDoc, 'IssueDateTime');
  if (!issueDateRaw) throw new Error('Missing IssueDateTime');
  const issue_date = `${issueDateRaw.slice(0, 4)}-${issueDateRaw.slice(4, 6)}-${issueDateRaw.slice(6, 8)}`;

  const invoicer = settlement.InvoicerParty || {};
  const supplier_id = getText(invoicer, 'ID');
  const supplier_name = getText(invoicer, 'NameText');
  if (!supplier_name) throw new Error('Missing InvoicerParty/NameText');

  const summation = settlement.SpecifiedMonetarySummation || {};
  const supply_amount = getNumber(summation, 'ChargeTotalAmount');
  const tax_amount = getNumber(summation, 'TaxTotalAmount');
  const total_amount = getNumber(summation, 'GrandTotalAmount');

  const lineItems = root.TaxInvoiceTradeLineItem || [];
  const items = (Array.isArray(lineItems) ? lineItems : [lineItems])
    .filter(Boolean)
    .map((item: any, i: number) => ({
      line_number: parseInt(getText(item, 'SequenceNumeric')) || i + 1,
      item_description: getText(item, 'NameText') || 'N/A',
      line_total: getNumber(item, 'InvoiceAmount'),
      quantity: getNumber(item, 'ChargeableUnitQuantity') || null,
      unit_price: getNumber(item, 'UnitPrice', 'Amount') || null,
    }));

  return {
    invoice_number,
    issue_date,
    supplier_id,
    supplier_name,
    supply_amount,
    tax_amount,
    total_amount,
    line_items: items,
  };
}
