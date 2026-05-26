import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Loader2, Upload, CheckCircle2, AlertCircle } from "lucide-react";
import { parseTictoCsv, consolidateByOrder, type ParsedSale } from "@/lib/ticto-csv";
import { importSalesBatch } from "@/lib/sales-import.functions";

export const Route = createFileRoute("/_app/import")({
  head: () => ({ meta: [{ title: "Importar Vendas — AdsTracker" }] }),
  component: ImportPage,
});

const BATCH_SIZE = 200;

interface RunSummary {
  read: number;
  inserted: number;
  updated: number;
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
      let failed = 0;
      const errors: { id: string | null; message: string }[] = [];

      for (let i = 0; i < consolidated.length; i += BATCH_SIZE) {
        const slice = consolidated.slice(i, i + BATCH_SIZE);
        try {
          const res = await importBatch({ data: { rows: slice as never } });
          inserted += res.inserted;
          updated += res.updated;
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
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar Vendas (Ticto)</h1>
        <p className="text-sm text-muted-foreground">
          Faça upload do CSV exportado em <em>Minhas Vendas → Exportar dados</em>. Vendas já
          existentes (mesmo ID de transação) são atualizadas, sem duplicar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecionar arquivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePreview(f);
            }}
          />
          {parseInfo && (
            <div className="text-sm text-muted-foreground space-y-1">
              <div>
                <strong className="text-foreground">{parseInfo.total}</strong> linhas válidas
                detectadas · {parseInfo.headers.length} colunas
                {parseInfo.parseErrors > 0 && (
                  <span className="text-destructive ml-2">
                    · {parseInfo.parseErrors} linha(s) sem ID
                  </span>
                )}
              </div>
            </div>
          )}
          {preview && preview.length > 0 && (
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Produto</th>
                    <th className="text-right p-2">Valor</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Data</th>
                    <th className="text-left p-2">utm_campaign</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 font-mono">{r.id}</td>
                      <td className="p-2">{r.product ?? "—"}</td>
                      <td className="p-2 text-right">
                        {r.amount != null ? r.amount.toFixed(2) : "—"}
                      </td>
                      <td className="p-2">{r.status}</td>
                      <td className="p-2">
                        {r.order_date ? new Date(r.order_date).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="p-2 text-muted-foreground">{r.utm_campaign ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Importar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleImport} disabled={!file || busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Importando..." : "Iniciar importação"}
          </Button>
          {busy && (
            <div className="space-y-2">
              <Progress value={progress} />
              <div className="text-xs text-muted-foreground">{progress}%</div>
            </div>
          )}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {summary.failed === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive" />
              )}
              Resultado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Linhas lidas" value={summary.read} />
              <Stat label="Novas" value={summary.inserted} tone="success" />
              <Stat label="Atualizadas" value={summary.updated} />
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
          </CardContent>
        </Card>
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
