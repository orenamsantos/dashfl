import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import { parseTictoCsv, consolidateByOrder, type ParsedSale } from "@/lib/ticto-csv";
import { importSalesBatch } from "@/lib/sales-import.functions";

function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-xl border border-border bg-card shadow-[0_1px_0_0_oklch(1_0_0_/_4%)_inset,0_20px_40px_-32px_#000] " +
        className
      }
    >
      {children}
    </div>
  );
}

export const Route = createFileRoute("/_app/import")({
  head: () => ({ meta: [{ title: "Importar Vendas — AdsTracker" }] }),
  component: ImportPage,
});

const BATCH_SIZE = 200;

interface RunSummary {
  read: number;
  inserted: number;
  updated: number;
  dedup: number;
  failed: number;
  errors: { id: string | null; message: string }[];
  parseErrors: { line: number; message: string }[];
  headers: string[];
}

function ImportPage() {
  const importBatch = useServerFn(importSalesBatch);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [preview, setPreview] = useState<ParsedSale[] | null>(null);
  const [parseInfo, setParseInfo] = useState<{
    headers: string[];
    total: number;
    parseErrors: number;
  } | null>(null);

  async function handlePreview(f: File) {
    setFile(f);
    setSummary(null);
    setProgress(0);
    const parsed = await parseTictoCsv(f);
    setPreview(parsed.rows.slice(0, 5));
    setParseInfo({
      headers: parsed.headers,
      total: parsed.rows.length,
      parseErrors: parsed.errors.length,
    });
  }

  async function handleImport() {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const parsed = await parseTictoCsv(file);
      // Consolida order bump (mesmo Código da Transação) ANTES de fatiar em
      // lotes, senão as duas linhas podem cair em batches diferentes e a soma
      // do bump se perde.
      const consolidated = consolidateByOrder(parsed.rows);
      const total = consolidated.length;
      let inserted = 0;
      let updated = 0;
      let dedup = 0;
      let failed = 0;
      const errors: { id: string | null; message: string }[] = [];

      for (let i = 0; i < consolidated.length; i += BATCH_SIZE) {
        const slice = consolidated.slice(i, i + BATCH_SIZE);
        try {
          const res = await importBatch({ data: { rows: slice as never } });
          inserted += res.inserted;
          updated += res.updated;
          dedup += res.dedup ?? 0;
          failed += res.failed;
          if (res.errors?.length) errors.push(...res.errors);
        } catch (e) {
          failed += slice.length;
          errors.push({ id: null, message: (e as Error).message });
        }
        setProgress(Math.round(((i + slice.length) / Math.max(total, 1)) * 100));
      }

      setSummary({
        read: total + parsed.errors.length,
        inserted,
        updated,
        dedup,
        failed,
        errors,
        parseErrors: parsed.errors.map((e) => ({ line: e.line, message: e.message })),
        headers: parsed.headers,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Importar vendas</h1>
        <p className="text-sm text-muted-foreground">
          Faça upload do CSV exportado em <em>Minhas Vendas → Exportar dados</em> na Ticto.
          Vendas existentes (mesmo ID de transação) são atualizadas, sem duplicar.
        </p>
      </div>

      <Panel className="p-5">
        <label
          className={
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-[oklch(1_0_0_/_2%)] px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-[oklch(1_0_0_/_3.5%)] " +
            (busy ? "pointer-events-none opacity-60" : "")
          }
        >
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/12 ring-1 ring-primary/20">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {file ? file.name : "Arraste o CSV ou clique para selecionar"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Formato Ticto · .csv
            </div>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePreview(f);
            }}
          />
        </label>

        {parseInfo && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
              <strong>{parseInfo.total}</strong>
              <span className="text-muted-foreground">linhas · {parseInfo.headers.length} colunas</span>
            </span>
            {parseInfo.parseErrors > 0 && (
              <span className="rounded-md bg-destructive/12 px-2.5 py-1 text-xs text-destructive">
                {parseInfo.parseErrors} sem ID
              </span>
            )}
          </div>
        )}

        {preview && preview.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-[oklch(1_0_0_/_2.5%)] text-muted-foreground">
                <tr>
                  <th className="p-2.5 text-left font-medium">ID</th>
                  <th className="p-2.5 text-left font-medium">Produto</th>
                  <th className="p-2.5 text-right font-medium">Valor</th>
                  <th className="p-2.5 text-left font-medium">Status</th>
                  <th className="p-2.5 text-left font-medium">Data</th>
                  <th className="p-2.5 text-left font-medium">utm_campaign</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2.5 font-mono">{r.id}</td>
                    <td className="max-w-[160px] truncate p-2.5">{r.product ?? "—"}</td>
                    <td className="p-2.5 text-right tabular-nums">
                      {r.amount != null ? r.amount.toFixed(2) : "—"}
                    </td>
                    <td className="p-2.5">{r.status}</td>
                    <td className="p-2.5 text-muted-foreground">
                      {r.order_date ? new Date(r.order_date).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="p-2.5 text-muted-foreground">{r.utm_campaign ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
          <Button onClick={handleImport} disabled={!file || busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Importando..." : "Iniciar importação"}
          </Button>
          {busy && (
            <div className="flex-1 space-y-1.5">
              <Progress value={progress} />
              <div className="text-xs text-muted-foreground">{progress}%</div>
            </div>
          )}
        </div>
      </Panel>

      {summary && (
        <Panel className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            {summary.failed === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            Resultado da importação
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <Stat label="Linhas lidas" value={summary.read} />
              <Stat label="Novas" value={summary.inserted} tone="success" />
              <Stat label="Atualizadas" value={summary.updated} />
              <Stat
                label="Duplicatas removidas"
                value={summary.dedup}
                tone={summary.dedup > 0 ? "success" : "muted"}
              />
              <Stat
                label="Erros"
                value={summary.failed + summary.parseErrors.length}
                tone={summary.failed + summary.parseErrors.length > 0 ? "error" : "muted"}
              />
            </div>

            {summary.parseErrors.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Linhas inválidas no CSV ({summary.parseErrors.length})
                </summary>
                <ul className="mt-2 space-y-1 text-xs font-mono max-h-48 overflow-auto">
                  {summary.parseErrors.slice(0, 100).map((e, i) => (
                    <li key={i}>
                      linha {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {summary.errors.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer text-destructive">
                  Erros do banco ({summary.errors.length})
                </summary>
                <ul className="mt-2 space-y-1 text-xs font-mono max-h-48 overflow-auto">
                  {summary.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      {e.id ?? "—"}: {e.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Se aparecer “relation public.sales does not exist” ou “column ... does not exist”,
                  rode o SQL em <code>supabase/setup-sales.sql</code> no SQL Editor do Supabase.
                </p>
              </details>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "error" | "muted";
}) {
  const color =
    tone === "success"
      ? "text-[var(--color-success)]"
      : tone === "error"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}
