import { getFilters } from "@/lib/data";
import { FiltersClient } from "./FiltersClient";

export default async function FiltersPage() {
  const filters = await getFilters();
  return <FiltersClient initialFilters={filters} />;
}
