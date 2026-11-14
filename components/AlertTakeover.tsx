"use client";

import { useEffect } from "react";

type AlertTakeoverProps = { isOpen: boolean; severity: "amber" | "red"; title: string; message: string; primaryLabel: string; onPrimary: () => void };

export function AlertTakeover({ isOpen, severity, title, message, primaryLabel, onPrimary }: AlertTakeoverProps) {
  useEffect(() => { if (isOpen && "vibrate" in navigator) navigator.vibrate([250, 100, 250, 100, 500]); }, [isOpen]);
  if (!isOpen) return null;
  const colors = severity === "red" ? "bg-red-700 text-white" : "bg-amber-400 text-slate-950";
  return <section role="alertdialog" aria-modal="true" aria-labelledby="alert-takeover-title" className={`fixed inset-0 z-50 flex min-h-screen flex-col justify-between p-6 ${colors}`}><div className="pt-10"><p className="text-lg font-black uppercase tracking-[0.2em]">Safety alert</p><h2 id="alert-takeover-title" className="mt-5 text-5xl font-black leading-tight">{title}</h2><p className="mt-6 text-2xl font-bold leading-snug">{message}</p></div><button type="button" onClick={onPrimary} className="min-h-28 rounded-2xl bg-slate-950 px-6 py-5 text-3xl font-black text-white active:bg-slate-800">{primaryLabel}</button></section>;
}
