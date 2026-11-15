export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass lift rounded-lg p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight text-text">{value}</p>
    </div>
  );
}
