import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ListChecks,
  ClipboardCheck,
  FileText,
  Menu,
  X,
  Shield,
  ChevronDown,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navigationItems = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Analyses', path: '/executions', icon: ListChecks },
  { label: 'Validate Criteria', path: '/validate-criteria', icon: ClipboardCheck },
  { label: 'View Reports', path: '/reports', icon: FileText },
];

const isMatch = (pathname, itemPath) => {
  if (itemPath === '/') {
    return pathname === '/';
  }

  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
};

const Layout = ({ children }) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const activeSection = useMemo(
    () => navigationItems.find((item) => isMatch(location.pathname, item.path))?.label || 'Dashboard',
    [location.pathname]
  );

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const navigateTo = (path) => {
    navigate(path);
    setIsMobileOpen(false);
  };

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    logout();
  };

  const renderNav = () => (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Navigation</p>
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1.5">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = isMatch(location.pathname, item.path);

            return (
              <li key={item.path}>
                <button
                  type="button"
                  onClick={() => navigateTo(item.path)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
                    active
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? 'text-blue-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="fixed inset-x-0 top-0 z-40 border-b-4 border-amber-500 bg-slate-800">
        <div className="flex h-16 items-center px-4 sm:px-6">
          <button
            type="button"
            className="mr-3 rounded-md p-2 text-slate-200 transition-colors hover:bg-slate-700 sm:hidden"
            onClick={() => setIsMobileOpen((prev) => !prev)}
            aria-label="Toggle navigation"
          >
            {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border-2 border-amber-500 bg-white">
              <Shield className="h-5 w-5 text-slate-800" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide text-white sm:text-base">Evidence Analysis System</h1>
              <p className="hidden text-xs text-slate-300 sm:block">{activeSection}</p>
            </div>
          </div>

          <div className="ml-auto" ref={menuRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-slate-600 bg-slate-700/60 px-3 py-2 text-sm text-slate-100 transition-colors hover:bg-slate-700"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
            >
              <span className="max-w-[130px] truncate">{user?.full_name || user?.username || 'User'}</span>
              <ChevronDown className="h-4 w-4" />
            </button>

            {isUserMenuOpen && (
              <div className="absolute right-4 mt-2 w-64 rounded-md border border-slate-200 bg-white shadow-lg sm:right-6">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-800">{user?.full_name || user?.username}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4 text-slate-500" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex pt-16">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 border-r border-slate-200 bg-white sm:block">
          {renderNav()}
        </aside>

        {isMobileOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-slate-900/35 sm:hidden"
              onClick={() => setIsMobileOpen(false)}
              aria-hidden="true"
            />
            <aside className="fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] w-72 border-r border-slate-200 bg-white sm:hidden">
              {renderNav()}
            </aside>
          </>
        )}

        <main className="w-full overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
