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

// ── OCR 폴백 (스캔/이미지 세금계산서 PDF용) ───────────────────────────────

export interface OcrConfig {
  langPath: string; // kor.traineddata / eng.traineddata 가 있는 디렉토리
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// OCR로 읽은 텍스트에서 긴 영숫자 토큰을 뽑아 후보 승인번호와 근사매칭.
// 가장 가까운 후보를 반환하되, (1) 거리 임계 이하이고 (2) 2등과 충분히 벌어질 때만 채택.
function matchKeyFromOcrText(text: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const tokens = (text.toLowerCase().match(/[0-9a-z]{12,32}/g) || []);
  if (tokens.length === 0) return null;

  let best: { key: string; dist: number } | null = null;
  let secondDist = Infinity;
  for (const key of candidates) {
    let tokenBest = Infinity;
    for (const tok of tokens) {
      const d = levenshtein(tok, key);
      if (d < tokenBest) tokenBest = d;
    }
    if (best === null || tokenBest < best.dist) {
      secondDist = best ? best.dist : secondDist;
      best = { key, dist: tokenBest };
    } else if (tokenBest < secondDist) {
      secondDist = tokenBest;
    }
  }
  if (!best) return null;
  // 24자 기준 거리 6 이하 + 2등과 3 이상 차이나면 유일 매칭으로 간주
  const threshold = Math.max(4, Math.floor(best.key.length * 0.3));
  if (best.dist <= threshold && secondDist - best.dist >= 3) return best.key;
  return null;
}

async function renderPdfFirstPagePng(pdfPath: string, scale = 3.0): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx as any, viewport, canvas } as any).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await doc.destroy().catch(() => {});
  }
}

// 폴더 내 모든 PDF를 읽어 전자세금계산서면 승인번호 → 경로 인덱스를 만든다.
// 텍스트 레이어가 없는 스캔 PDF는 ocr 설정이 있으면 OCR로 승인번호를 인식해 candidateKeys와 근사매칭한다.
export async function buildTaxPdfIndex(
  folder: string,
  candidateKeys: string[] = [],
  ocr?: OcrConfig,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  if (!folder || !fs.existsSync(folder)) return index;

  const remaining = new Set(candidateKeys.filter(Boolean));
  const imagePdfs: string[] = [];

  // 1차: 텍스트 레이어 기반 (빠름)
  for (const pdfPath of findPdfsRecursive(folder)) {
    let text = '';
    try {
      text = await readPdfText(pdfPath);
    } catch {
      // 읽기 실패 → OCR 후보로
    }
    const approvalNo = text.includes('세금계산서') ? extractApprovalNo(text) : null;
    if (approvalNo) {
      const key = normalizeApprovalNo(approvalNo);
      if (!index.has(key)) index.set(key, pdfPath);
      remaining.delete(key);
    } else {
      imagePdfs.push(pdfPath); // 텍스트 인식 실패 → 스캔/이미지일 가능성
    }
  }

  // 2차: OCR 폴백 (텍스트 인식 실패 + 아직 못 찾은 후보가 있을 때만)
  if (ocr && imagePdfs.length > 0 && remaining.size > 0) {
    const { createWorker } = await import('tesseract.js');
    let worker: any;
    try {
      worker = await createWorker(['kor', 'eng'], 1, {
        cachePath: ocr.langPath,
        cacheMethod: 'readOnly',
      } as any);
    } catch (err) {
      console.error('[OCR] worker init 실패:', err);
      return index;
    }
    try {
      for (const pdfPath of imagePdfs) {
        if (remaining.size === 0) break;
        try {
          const png = await renderPdfFirstPagePng(pdfPath);
          const { data: { text } } = await worker.recognize(png);
          const key = matchKeyFromOcrText(text, [...remaining]);
          if (key) {
            if (!index.has(key)) index.set(key, pdfPath);
            remaining.delete(key);
            console.log(`[OCR] matched ${path.basename(pdfPath)} -> ${key}`);
          }
        } catch (err) {
          console.error('[OCR] 처리 실패:', pdfPath, err);
        }
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
  }

  return index;
}

export interface BundleItem {
  paths: string[];
}

// 항목별 PDF 경로 목록을 순서대로 하나의 PDF로 병합한다.
export async function mergeBundle(items: BundleItem[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const item of items) {
    for (const p of item.paths) {
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
