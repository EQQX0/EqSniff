"use client";

import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";

/** POSTs to a route that answers { url } and sends the browser there (Stripe Checkout or Portal). */
export function RedirectButton({
  endpoint,
  body,
  children,
  variant = "primary",
  className = "",
  disabled,
}: {
  endpoint: string;
  body?: unknown;
  children: ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        setError(res.status === 409 ? "You already own this." : "Something went wrong. Try again.");
        setLoading(false);
        return;
      }
      window.location.assign(json.url);
    } catch {
      setError("Network problem. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <Button variant={variant} className="w-full" loading={loading} disabled={disabled} onClick={go}>
        {children}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
