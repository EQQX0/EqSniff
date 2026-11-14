import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
        {children}
      </Card>
    </div>
  );
}

export function FormStatus({ error, message }: { error?: string; message?: string }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (message) {
    return (
      <p role="status" className="text-sm text-success">
        {message}
      </p>
    );
  }
  return null;
}
