import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";
import { brl } from "@/lib/format";
import { updateCampaignBudget, type FBCampaign } from "@/lib/facebook-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: FBCampaign;
  // USD→BRL pra mostrar o equivalente em real (a conta é em USD)
  rate: number;
}

type BudgetKind = "daily" | "lifetime";

function detectKind(c: FBCampaign): {
  kind: BudgetKind | null;
  currentCents: number;
  // true se o orçamento está no nível do conjunto (ABO) — não dá pra editar aqui
  isAdsetBudget: boolean;
} {
  if (c.daily_budget && c.daily_budget > 0) {
    return { kind: "daily", currentCents: c.daily_budget, isAdsetBudget: false };
  }
  if (c.lifetime_budget && c.lifetime_budget > 0) {
    return {
      kind: "lifetime",
      currentCents: c.lifetime_budget,
      isAdsetBudget: false,
    };
  }
  // Sem orçamento na campanha → é ABO (orçamento por conjunto)
  return { kind: null, currentCents: 0, isAdsetBudget: true };
}

export function BudgetEditDialog({ open, onOpenChange, campaign, rate }: Props) {
  const queryClient = useQueryClient();
  const { kind, currentCents, isAdsetBudget } = detectKind(campaign);
  const currentUsd = currentCents / 100;

  const [usdInput, setUsdInput] = useState<string>(currentUsd ? currentUsd.toFixed(2) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setUsdInput(currentUsd ? currentUsd.toFixed(2) : "");
      setError(null);
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }, [open, currentUsd]);

  const usd = Number(usdInput.replace(",", "."));
  const usdValid = Number.isFinite(usd) && usd > 0;
  const brlEquivalent = usdValid ? usd * rate : 0;
  const newCents = usdValid ? Math.round(usd * 100) : 0;
  const changed = newCents !== currentCents;

  async function save() {
    if (!kind) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCampaignBudget({
        campaign_id: campaign.id,
        ...(kind === "daily"
          ? { daily_budget: newCents }
          : { lifetime_budget: newCents }),
      });
      toast.success("Orçamento atualizado");
      // força refetch da lista de campanhas pra refletir o novo valor
      queryClient.invalidateQueries({ queryKey: ["fb-campaigns"] });
      onOpenChange(false);
    } catch (e) {
      const err = e as Error & { permission?: boolean };
      if (err.permission) {
        setError(
          "O token configurado não tem permissão ads_management. Atualize o FACEBOOK_TOKEN com o escopo correto.",
        );
      } else {
        setError(err.message ?? "Erro ao salvar");
      }
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar orçamento</DialogTitle>
            <DialogDescription>{campaign.name}</DialogDescription>
          </DialogHeader>

          {isAdsetBudget ? (
            <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
              <div>
                <p className="font-medium">Orçamento por conjunto (ABO)</p>
                <p className="text-muted-foreground mt-1">
                  Esta campanha não tem orçamento próprio — cada conjunto tem o
                  seu. A edição precisa ser feita no nível do conjunto pelo
                  Gerenciador de Anúncios.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm">
                <span className="text-muted-foreground">Tipo:</span>{" "}
                <span className="font-medium">
                  {kind === "daily" ? "Orçamento diário (CBO)" : "Orçamento total (CBO)"}
                </span>
                <span className="text-muted-foreground"> • Atual: </span>
                <span className="font-medium">
                  US$ {currentUsd.toFixed(2)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  ({brl(currentUsd * rate)})
                </span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="usd">Novo valor (USD)</Label>
                <Input
                  id="usd"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={usdInput}
                  onChange={(e) => setUsdInput(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Equivalente em BRL pela cotação do dia:{" "}
                  <strong>{usdValid ? brl(brlEquivalent) : "—"}</strong>
                </p>
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {!isAdsetBudget && (
              <Button
                disabled={!usdValid || !changed || submitting}
                onClick={() => setConfirmOpen(true)}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              O orçamento {kind === "daily" ? "diário" : "total"} de{" "}
              <strong>{campaign.name}</strong> vai mudar de{" "}
              <strong>US$ {currentUsd.toFixed(2)}</strong> para{" "}
              <strong>US$ {usd.toFixed(2)}</strong> ({brl(brlEquivalent)}).
              <br />
              Essa alteração é aplicada imediatamente no Meta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={save} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
