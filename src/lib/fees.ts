import type { Fee } from "@/types";

interface FeeRowDb {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number;
  applies_to: "revenue" | "commission";
}

function fromDb(r: FeeRowDb): Fee {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    value: Number(r.value),
    appliesTo: r.applies_to,
  };
}

export async function listFees(): Promise<Fee[]> {
  const res = await fetch("/api/fees");
  const json = await res.json();
  if (!res.ok || json?.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return (json.fees as FeeRowDb[]).map(fromDb);
}

export async function addFee(input: Omit<Fee, "id">): Promise<Fee> {
  const res = await fetch("/api/fees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "add",
      fee: {
        name: input.name,
        kind: input.kind,
        value: input.value,
        applies_to: input.appliesTo,
      },
    }),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return fromDb(json.fee as FeeRowDb);
}

export async function deleteFee(id: string): Promise<void> {
  const res = await fetch("/api/fees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", id }),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
}
