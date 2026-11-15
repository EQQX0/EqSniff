import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";

/** Downloads the installer, checks it and starts it. The app closes when the installer opens. */
export function UpdateNow({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.installUpdate();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className}`}>
      <Button size="sm" onClick={go} loading={busy}>
        {busy ? "Downloading…" : "Update now"}
      </Button>
      {error && <span role="alert" className="max-w-xs text-xs text-danger">{error}</span>}
    </span>
  );
}
