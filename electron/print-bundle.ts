import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';

// 승인번호 정규화: 소문자 + 영숫자만. 비교 키로 사용.
export function normalizeApprovalNo(s: string): string {
  return (s || '').toLowerCase().replace(/[^0-9a-z]/g, '');
}

// tax_invoices.source_file(예: "2026052641000061enm9s874-2.XML") → 승인번호 정규화 키
export function approvalNoFromSourceFile(sourceFile: string): string {
  let base = (sourceFile || '').replace(/\.[^.]+$/, ''); // 확장자 제거
  base = base.replace(/\s*\(\d+\)\s*$/, ''); // " (1)" 제거
  base = base.replace(/-\d+$/, ''); // 다운로드 중복 접미사 "-2" 제거
  return normalizeApprovalNo(base);
}

// PDF 텍스트에서 승인번호 추출
export function extractApprovalNo(text: string): string | null {
  const m = text.match(/승인번호\s*([0-9A-Za-z]+)/);
  return m ? m[1] : null;
}

async function readPdfText(pdfPath: string): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(pdfPath)) });
  try {
    const r = await parser.getText();
    return r.text || '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function findPdfsRecursive(folder: string): string[] {
  const out: string[] = [];
  const stack = [folder];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && path.extname(e.name).toLowerCase() === '.pdf') out.push(full);
    }
  }
  return out;
}

// 폴더 내 모든 PDF를 읽어 전자세금계산서면 승인번호 → 경로 인덱스를 만든다.
export async function buildTaxPdfIndex(folder: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (!folder || !fs.existsSync(folder)) return index;

  for (const pdfPath of findPdfsRecursive(folder)) {
    let text: string;
    try {
      text = await readPdfText(pdfPath);
    } catch {
      continue;
    }
    if (!text.includes('세금계산서')) continue;
    const approvalNo = extractApprovalNo(text);
    if (!approvalNo) continue;
    const key = normalizeApprovalNo(approvalNo);
    if (!index.has(key)) index.set(key, pdfPath);
  }
  return index;
}

export interface BundleItem {
  taxPdfPath: string;
  approvalPdfPaths: string[];
}

// 세금계산서 PDF + 매칭된 기안 PDF들을 하나의 PDF로 병합한다.
export async function mergeBundle(items: BundleItem[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const item of items) {
    const paths = [item.taxPdfPath, ...item.approvalPdfPaths];
    for (const p of paths) {
      if (!p || !fs.existsSync(p)) continue;
      try {
        const src = await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((pg) => merged.addPage(pg));
      } catch {
        // 손상/암호화된 PDF는 건너뛴다
      }
    }
  }

  return merged.save();
}
