import { useEffect, useState } from 'react';
import { getAPI } from '../lib/electron-mock';
import { Server, Landmark, Building2, Briefcase, ArrowRight } from 'lucide-react';

const ICONS: Record<string, typeof Server> = {
  Server,
  Landmark,
  Building2,
  Briefcase,
};

export function DepartmentSelectPage({ onSelected }: { onSelected: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    getAPI().getDepartments().then(setDepartments);
  }, []);

  const handleSelect = async (id: string) => {
    setSelecting(id);
    const ok = await getAPI().selectDepartment(id);
    if (!ok) {
      setSelecting(null);
      return;
    }
    // Electron은 select 시 재시작되므로 아래는 브라우저(mock) 폴백.
    onSelected();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900">AutoSlip</h1>
        <p className="text-gray-500 mt-2">사용할 부서를 선택하세요. 선택한 부서로 입장합니다.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-3xl">
        {departments.map((d) => {
          const Icon = ICONS[d.icon] ?? Briefcase;
          const busy = selecting === d.id;
          return (
            <button
              key={d.id}
              onClick={() => handleSelect(d.id)}
              disabled={selecting !== null}
              className="group relative flex flex-col items-center gap-4 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span
                className="flex h-16 w-16 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${d.color}1a`, color: d.color }}
              >
                <Icon size={32} />
              </span>
              <span className="text-lg font-semibold text-gray-900">{d.name}</span>
              <span className="flex items-center gap-1 text-sm font-medium text-gray-400 group-hover:text-gray-700">
                {busy ? '입장 중…' : '입장'}
                {!busy && <ArrowRight size={14} />}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-10 text-xs text-gray-400">
        부서는 한 번 선택하면 이 PC에 고정됩니다. 변경은 설정에서 할 수 있습니다.
      </p>
    </div>
  );
}
