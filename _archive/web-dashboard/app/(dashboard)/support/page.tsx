// S17 — Support: FAQ + ticket list. Copy is written fresh, not borrowed
// from the original's FAQ — see lib/data.ts FAQ.
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AccordionItem } from "@/components/ui/Accordion";
import { EmptyState } from "@/components/ui/EmptyState";
import { BellIcon } from "@/components/ui/icons";
import { FAQ, getSupportTickets } from "@/lib/data";

export default async function SupportPage() {
  const tickets = await getSupportTickets();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text">Support</h1>
        <p className="mt-1 text-sm text-muted">Answers to common questions, or open a ticket.</p>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-text">Frequently asked questions</h2>
        <div className="mt-2">
          {FAQ.map((item) => (
            <AccordionItem key={item.q} question={item.q} answer={item.a} />
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Your tickets</h2>
          <Button size="sm">Open a ticket</Button>
        </div>
        <div className="mt-4">
          {tickets.length === 0 ? (
            <EmptyState
              icon={<BellIcon className="h-6 w-6" />}
              title="No tickets yet"
              body="If the FAQ doesn't answer your question, open a ticket and we'll get back to you."
            />
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((t) => (
                <li key={t.id} className="py-3 text-sm">
                  <p className="font-medium text-text">{t.subject}</p>
                  <p className="text-xs text-muted">
                    {t.status} · updated {t.updatedAt}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
