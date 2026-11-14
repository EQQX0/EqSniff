import { DashboardShell } from "@/components/DashboardShell";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return <DashboardShell email={data.user?.email ?? ""}>{children}</DashboardShell>;
}
