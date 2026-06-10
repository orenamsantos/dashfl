import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchFBStatus } from "@/lib/facebook-api";

// Nome curto da conta: "C03 - USD - BR" → "C03".
function short(name: string): string {
  const first = name.trim().split(/[\s—-]/)[0];
  return first || name;
}

// Seletor de conta de anúncios. Só aparece quando há 2+ contas configuradas
// (com uma só, não há o que escolher). Value = id da conta ("act_...") ou "all".
export function AccountSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const status = useQuery({
    queryKey: ["fb-status"],
    queryFn: fetchFBStatus,
    staleTime: 1000 * 60 * 10,
  });
  const accounts = status.data?.accounts ?? [];
  if (accounts.length < 2) return null;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={"w-auto gap-2 " + (className ?? "")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todas as contas</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {short(a.name)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
