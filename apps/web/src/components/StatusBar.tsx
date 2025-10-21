import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { CheckCircle2, CircleAlert } from "lucide-react";

type Status = Record<
  string,
  { ok: boolean; service?: string; time?: string; url?: string; error?: string }
>;

export default function StatusBar() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    get<Status>("/_status").then(setS).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="text-xs text-red-600">Status error: {err}</div>;
  if (!s) return <div className="text-xs text-white/70">Comprobando servicios…</div>;

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {Object.entries(s).map(([k, v]) => (
        <span key={k} className={v.ok ? "chip-ok" : "chip-bad"}>
          <span className="inline-flex items-center gap-1">
            {v.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <CircleAlert className="h-3.5 w-3.5" />
            )}
            {k}: {v.ok ? "OK" : "DOWN"}
          </span>
        </span>
      ))}
    </div>
  );
}
