export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('ko-KR').format(amount);
}

export function formatCurrency(amount: number): string {
  return `₩${formatAmount(amount)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 월마감 디폴트 월(YYYY-MM)을 계산한다.
 * 매월 1~10일은 전달, 11일부터는 현재 달을 기본값으로 한다.
 */
export function getDefaultMonth(date: Date = new Date()): string {
  const base = new Date(date.getFullYear(), date.getMonth(), 1);
  if (date.getDate() <= 10) {
    base.setMonth(base.getMonth() - 1);
  }
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}
