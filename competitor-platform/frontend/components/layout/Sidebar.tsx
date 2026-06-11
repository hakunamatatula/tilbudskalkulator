"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, Globe, LayoutDashboard } from "lucide-react";
import { clsx } from "clsx";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/competitors", label: "Competitors", icon: Globe },
  { href: "/dashboard/keywords", label: "Keywords", icon: BarChart3 },
  { href: "/dashboard/content", label: "Content Drafts", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-white border-r border-gray-200 min-h-screen">
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <span className="text-lg font-semibold text-brand-900 tracking-tight">
          CompeteIQ
        </span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              pathname === href
                ? "bg-brand-50 text-brand-600"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">CompeteIQ MVP v0.1</p>
      </div>
    </aside>
  );
}
