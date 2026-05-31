export interface Summary {
  people: number;
  used: number;
  remaining: number;
  overQuota: number;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function SummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="kpis">
      <Card value={String(summary.people)} label="Employees" />
      <Card value={fmt(summary.used)} label="Days used" />
      <Card value={fmt(summary.remaining)} label="Days remaining" tone="green" />
      <Card
        value={String(summary.overQuota)}
        label="Over quota"
        tone={summary.overQuota > 0 ? "red" : undefined}
      />
    </div>
  );
}

function Card({ value, label, tone }: { value: string; label: string; tone?: "green" | "red" | "amber" }) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ""}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
