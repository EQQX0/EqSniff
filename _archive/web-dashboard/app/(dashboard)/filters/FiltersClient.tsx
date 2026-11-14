"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { FilterIcon } from "@/components/ui/icons";
import type { FilterRule } from "@/lib/data";

// S06/S07/S21 — packet filters list + custom filter editor. Cloud/community
// filters are NOT built — see replica/recon.md skip list ("Cloud filters /
// community filter library" is the original's user data, not a feature).
export function FiltersClient({ initialFilters }: { initialFilters: FilterRule[] }) {
  const [filters, setFilters] = useState(initialFilters);
  const [open, setOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    const res = await fetch("/api/filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        protocol: data.get("protocol"),
        direction: data.get("direction"),
        hexPattern: data.get("hexPattern") || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return setError(json.error ?? "Could not create the filter.");
    }
    const created = (await res.json()) as FilterRule;
    setFilters((f) => [...f, created]);
    setOpen(false);
    router.refresh();
  }

  async function handleToggle(id: string, enabled: boolean) {
    setFilters((fs) => fs.map((x) => (x.id === id ? { ...x, enabled } : x)));
    const res = await fetch(`/api/filters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) setFilters((fs) => fs.map((x) => (x.id === id ? { ...x, enabled: !enabled } : x)));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Packet filters</h1>
          <p className="mt-1 text-sm text-muted">Create and manage custom filters for your own captures.</p>
        </div>
        <Button onClick={() => setOpen(true)}>New filter</Button>
      </div>

      <Tabs
        defaultTab="mine"
        tabs={[
          {
            id: "mine",
            label: "My filters",
            panel: (
              <Card>
                {filters.length === 0 ? (
                  <EmptyState
                    icon={<FilterIcon className="h-6 w-6" />}
                    title="No filters yet"
                    body="Create your first packet filter to start capturing specific traffic."
                    action={<Button onClick={() => setOpen(true)}>Create filter</Button>}
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {filters.map((f) => (
                      <li key={f.id} className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-sm font-medium text-text">{f.name}</p>
                          <p className="text-xs text-muted">
                            {f.protocol.toUpperCase()} · {f.direction}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge tone={f.source === "built_in" ? "neutral" : "accent"}>{f.source}</Badge>
                          <Switch
                            label={`Toggle ${f.name}`}
                            checked={f.enabled}
                            disabled={f.source === "built_in"}
                            onChange={(checked) => handleToggle(f.id, checked)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal open={open} onClose={() => setOpen(false)} title="Create filter">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Name" name="name" required autoFocus maxLength={80} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Protocol</span>
              <select name="protocol" className="h-10 rounded-md border border-border-input bg-surface px-3 text-sm text-text">
                <option value="any">Any</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-text">Direction</span>
              <select name="direction" className="h-10 rounded-md border border-border-input bg-surface px-3 text-sm text-text">
                <option value="both">Both</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </label>
          </div>
          <Input label="Hex pattern (optional)" name="hexPattern" hint="Hex bytes such as 4a 3f ?? 00." />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>Create filter</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
