import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { FolderOpen, FileSpreadsheet, FileCheck, Settings, LayoutDashboard, Monitor } from 'lucide-react';
import { getAPI } from './lib/electron-mock';
import { HomePage } from './pages/HomePage';
import { InvoicesPage } from './pages/InvoicesPage';
import { MatchingPage } from './pages/MatchingPage';
import { MonthlyCostPage } from './pages/MonthlyCostPage';
import { ExportPage } from './pages/ExportPage';
import { SettingsPage } from './pages/SettingsPage';
import { DepartmentSelectPage } from './pages/DepartmentSelectPage';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: '홈' },
  { to: '/invoices', icon: FileSpreadsheet, label: '세금계산서' },
  { to: '/matching', icon: FileCheck, label: '기안문서' },
  { to: '/monthly-cost', icon: Monitor, label: '월별 비용' },
  { to: '/export', icon: FolderOpen, label: '내보내기' },
  { to: '/settings', icon: Settings, label: '설정' },
];

export default function App() {
  const [department, setDepartment] = useState<Department | null | undefined>(undefined);

  const loadDepartment = () => getAPI().getCurrentDepartment().then(setDepartment);

  useEffect(() => {
    loadDepartment();
  }, []);

  if (department === undefined) return null; // 로딩 중
  if (department === null) {
    return <DepartmentSelectPage onSelected={loadDepartment} />;
  }

  return (
    <HashRouter>
      <div className="flex h-screen bg-gray-50">
        <nav className="w-56 bg-white border-r border-gray-200 flex flex-col pt-8">
          <div className="px-5 mb-8">
            <h1 className="text-lg font-bold text-gray-900">AutoSlip</h1>
            <p className="text-xs text-gray-500 mt-0.5">월마감 전표 자동화</p>
            <div
              className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
              style={{ backgroundColor: `${department.color}1a`, color: department.color }}
            >
              {department.name}
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1 px-3">
            {navItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>

        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/matching" element={<MatchingPage />} />
            <Route path="/monthly-cost" element={<MonthlyCostPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
