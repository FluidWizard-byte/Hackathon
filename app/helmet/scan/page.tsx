"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type ZoneEntryResult = { authorized: boolean; zoneName: string };

function ZoneScanContent() {
  const searchParams = useSearchParams();
  const zoneId = searchParams.get("zone");
  const [result, setResult] = useState<ZoneEntryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zoneId) {
      setError("This QR code does not include a zone.");
      return;
    }
    let active = true;
    void fetch("/api/zones/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone_id: zoneId }),
    }).then(async (response) => {
      const data: unknown = await response.json();
      if (!response.ok || typeof data !== "object" || data === null || !("zoneName" in data) || !("authorized" in data)) {
        throw new Error(typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "Unable to enter this zone.");
      }
      if (active) setResult({ zoneName: String(data.zoneName), authorized: Boolean(data.authorized) });
    }).catch((entryError: unknown) => {
      if (active) setError(entryError instanceof Error ? entryError.message : "Unable to enter this zone.");
    });
    return () => { active = false; };
  }, [zoneId]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col justify-center bg-slate-950 px-5 py-6 text-white">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">SafeSite zone scan</p>
      {error ? <h1 className="mt-3 text-3xl font-black text-red-300">{error}</h1> : null}
      {!error && !result ? <h1 className="mt-3 text-3xl font-black">Checking zone access…</h1> : null}
      {result ? <><h1 className="mt-3 text-3xl font-black">{result.authorized ? "Zone entry recorded" : "Unauthorized entry recorded"}</h1><p className="mt-4 text-xl text-slate-200">{result.zoneName}</p></> : null}
    </main>
  );
}

export default function ZoneScanPage() {
  return (
    <Suspense fallback={<main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg flex-col justify-center bg-slate-950 px-5 py-6 text-white"><h1 className="text-3xl font-black">Loading zone scan…</h1></main>}>
      <ZoneScanContent />
    </Suspense>
  );
}
