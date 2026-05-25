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
