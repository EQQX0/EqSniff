"use client";

import { useId, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

export function AccordionItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b border-border py-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 text-left text-sm font-medium text-text
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
      >
        <span>{question}</span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 transition-transform duration-base ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id={id} hidden={!open} className="pt-2 text-sm text-muted">
        {answer}
      </div>
    </div>
  );
}
