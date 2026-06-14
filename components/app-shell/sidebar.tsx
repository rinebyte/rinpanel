"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Globe, FolderOpen, ShieldCheck, LogOut } from "lucide-react";
import { logout } from "@/app/(dashboard)/logout-action";

const NAV = [
  { href: "/", label: "Dashboard", code: "01", icon: LayoutDashboard, enabled: true },
  { href: "/domains", label: "Domains", code: "02", icon: Globe, enabled: true },
  { href: "/files", label: "Files", code: "03", icon: FolderOpen, enabled: true },
  { href: "/ssl", label: "SSL", code: "04", icon: ShieldCheck, enabled: false },
];

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
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

      {/* USER + LOGOUT footer */}
      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-1">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/15 ring-1 ring-lime-500/30 font-mono text-xs font-bold uppercase text-lime-300"
          >
            {username.slice(0, 1)}
          </span>
          <div className="hidden min-w-0 flex-col md:flex">
            <span className="eyebrow">session · private</span>
            <span className="truncate font-mono text-sm text-zinc-200">{username}</span>
          </div>
          <span className="ml-auto hidden md:block size-1.5 rounded-full bg-emerald-400 animate-glow-pulse" aria-label="live session" />
        </div>

        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-2 font-mono text-[0.7rem] tracking-wide uppercase text-zinc-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 md:justify-start md:gap-3 md:px-3"
          aria-label="Sign out"
        >
          <LogOut className="size-4 shrink-0" />
          <span className="hidden md:block">Sign out</span>
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="glass corner-ticks relative m-auto rounded-xl p-0 text-zinc-200 backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-reveal"
      >
        <div className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-5 p-6">
          <div>
            <p className="eyebrow">session · terminate</p>
            <h2 className="font-display mt-1 text-xl font-bold tracking-wide text-white">Sign out?</h2>
            <p className="mt-2 font-mono text-xs text-zinc-400">Konfirmasi dulu — session JWT bakal dihapus.</p>
          </div>

          <div className="flex gap-3">
            <form method="dialog" className="flex-1">
              <button
                type="submit"
                className="h-10 w-full rounded-md border border-white/10 bg-white/[0.03] font-mono text-xs tracking-wide uppercase text-zinc-300 hover:border-white/20 hover:text-white"
              >
                Cancel
              </button>
            </form>
            <form action={logout} className="flex-1">
              <button
                type="submit"
                className="accent-glow h-10 w-full rounded-md bg-primary font-mono text-xs font-semibold tracking-wide uppercase text-primary-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </aside>
  );
}
