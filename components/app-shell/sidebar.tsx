"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Globe, FolderOpen, ShieldCheck } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", code: "01", icon: LayoutDashboard, enabled: true },
  { href: "/domains", label: "Domains", code: "02", icon: Globe, enabled: false },
  { href: "/files", label: "Files", code: "03", icon: FolderOpen, enabled: false },
  { href: "/ssl", label: "SSL", code: "04", icon: ShieldCheck, enabled: false },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar/80 sticky top-0 flex h-screen w-16 shrink-0 flex-col gap-6 border-r border-white/10 px-2 py-5 backdrop-blur-xl md:w-64 md:px-4">
      <div className="flex items-center gap-3 px-1">
        <span className="accent-glow grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">R</span>
        <span className="font-display hidden text-lg font-bold tracking-wide text-white md:block">rinpanel</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const base = "relative flex items-center gap-3 rounded-md px-2 py-2 font-mono text-[0.8rem] tracking-wide uppercase md:px-3";
          if (!item.enabled) {
            return (
              <span key={item.href} className={`${base} cursor-not-allowed text-zinc-600`} title="Coming in a later slice">
                <Icon className="size-4 shrink-0" />
                <span className="hidden md:block">{item.label}</span>
                <span className="ml-auto hidden text-zinc-700 md:block">{item.code}</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${base} ${active ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
            >
              {active && <span className="absolute -left-2 h-5 w-0.5 bg-primary" />}
              <Icon className="size-4 shrink-0" />
              <span className="hidden md:block">{item.label}</span>
              <span className={`ml-auto hidden md:block ${active ? "text-primary-foreground/70" : "text-zinc-600"}`}>{item.code}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2 px-2 font-mono text-[0.65rem] text-zinc-500">
        <span className="size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
        <span className="hidden md:block">SESSION · PRIVATE</span>
      </div>
    </aside>
  );
}
