// 미리 정의된 부서 목록 (앱 번들).
// Phase A(자동 업데이트)에서 앱 업데이트로 이 목록이 갱신된다.
export interface Department {
  id: string;
  name: string;
  color: string;
  icon: string; // lucide-react 아이콘 이름
}

export const DEPARTMENTS: Department[] = [
  { id: 'it-system', name: 'IT시스템팀', color: '#3b82f6', icon: 'Server' },
  { id: 'finance', name: '재무팀', color: '#10b981', icon: 'Landmark' },
  { id: 'general-affairs', name: '총무팀', color: '#f59e0b', icon: 'Building2' },
];

export function findDepartment(id: string | undefined | null): Department | null {
  if (!id) return null;
  return DEPARTMENTS.find((d) => d.id === id) ?? null;
}
