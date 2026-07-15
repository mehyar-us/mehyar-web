// Public quote view — renders a hosted quote at /q/[slug]
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import MainLayout from "@/layouts/MainLayout";

export default function QuoteView() {
  const [, params] = useRoute("/q/:slug");
  const slug = params?.slug;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/quotes/${slug}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok || !j.ok) setError(j.error || "Not found");
      else setData(j.quote);
    }).catch((e) => setError(String(e)));
  }, [slug]);

  if (error) {
    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto px-4 py-16">
          <Card><CardContent className="py-12 text-center">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-3" />
            <h1 className="text-xl font-bold mb-2">Quote not found</h1>
            <p className="text-zinc-600">{error}</p>
            <a href="/" className="inline-block mt-4 text-blue-700 underline">Go to mehyar.us →</a>
          </CardContent></Card>
        </div>
      </MainLayout>
    );
  }

  if (!data) {
    return (
      <MainLayout>
        <div className="text-center py-32 text-zinc-500">
          <Loader2 className="inline w-6 h-6 animate-spin mr-2" /> Loading…
        </div>
      </MainLayout>
    );
  }

  const isPaid = data.status === "paid";
  const isInvoice = data.status === "invoice";
  const labelMap: Record<string, string> = { quote: "Quote", invoice: "Invoice", paid: "Receipt", void: "Cancelled" };
  const label = labelMap[data.status] || "Quote";

  return (
    <MainLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 print:py-2">
        {/* Print-only header banner */}
        <div className="print:hidden mb-4">
          <a href="/" className="text-xs text-zinc-500 hover:underline">← mehyar.us</a>
        </div>

        <Card className={`print:shadow-none print:border-0 ${isPaid ? "border-emerald-400" : ""}`}>
          <CardContent className="p-8">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-zinc-200 pb-4 mb-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-5 h-5 text-zinc-700" />
                  <h1 className="text-2xl font-bold text-zinc-900">{label} #{data.quote_number}</h1>
                  {isPaid && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold"><CheckCircle2 className="w-3 h-3" /> Paid</span>}
                </div>
                <div className="text-sm text-zinc-500">
                  Issued {new Date(data.created_at + "Z").toLocaleDateString()}
                  {data.due_date && <> · {isInvoice ? "Due" : "Valid until"} {new Date(data.due_date).toLocaleDateString()}</>}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-zinc-900">MehyarSoft</div>
                <div className="text-xs text-zinc-500">by Mehyar Swelim</div>
                <div className="text-xs text-zinc-500">mehyar.us · mrswelim@gmail.com</div>
                <button onClick={() => window.print()} className="mt-2 text-xs px-3 py-1 rounded border border-zinc-300 hover:bg-zinc-50 print:hidden">
                  🖨 Print / Save PDF
                </button>
              </div>
            </div>

            {/* Bill to */}
            <div className="mb-6">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold mb-1">Bill to</div>
              <div className="font-medium text-zinc-900">{data.client_name}</div>
              {data.client_email && <div className="text-sm text-zinc-600">{data.client_email}</div>}
              {data.client_address && <div className="text-sm text-zinc-600 whitespace-pre-line">{data.client_address}</div>}
            </div>

            {/* Line items */}
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200">
                  <th className="py-2">Service</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(data.items || []).map((it: any, i: number) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="py-3">
                      <div className="font-medium text-zinc-900">{it.name}</div>
                      {it.desc && <div className="text-xs text-zinc-500 mt-0.5">{it.desc}</div>}
                    </td>
                    <td className="py-3 text-right tabular-nums">{it.qty}</td>
                    <td className="py-3 text-right tabular-nums">${Number(it.price || 0).toLocaleString()}</td>
                    <td className="py-3 text-right tabular-nums font-medium">${(it.qty * it.price).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-300">
                  <td colSpan={3} className="py-3 text-right text-sm font-semibold">Total due</td>
                  <td className="py-3 text-right text-2xl font-bold text-emerald-700 tabular-nums">${Number(data.total_usd || 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>

            {/* Payment info */}
            <div className="border-t border-zinc-200 pt-4 text-xs text-zinc-600">
              <h3 className="font-semibold text-zinc-900 mb-2">💳 How to pay</h3>
              <p className="mb-1"><strong>ACH/Wire:</strong> Reach out to mrswelim@gmail.com for routing details.</p>
              <p className="mb-1"><strong>Card:</strong> Reply to the email this quote came from and we'll send a Stripe link.</p>
              <p className="mb-1"><strong>Check:</strong> Mail to address on file; allow 5 business days.</p>
              <p className="mt-3 italic text-zinc-500">
                Thanks for the business. Reply to the email this came from with any questions — usually responds in under 4 hours during US business hours.
              </p>
            </div>

            {!isPaid && (
              <div className="mt-4 p-3 rounded-lg bg-violet-50 border border-violet-200 text-xs text-violet-900">
                <strong>⏱ Valid for {data.due_days || 15} days.</strong> After that, pricing may shift.
                To proceed, just reply to the email this quote came from — or book a 15-min kickoff:{" "}
                <a href="https://mehyar.us/book" className="underline font-semibold">mehyar.us/book</a>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs text-zinc-400 mt-4 print:hidden">
          Generated by <a href="https://mehyar.us" className="hover:underline">MehyarSoft</a> · Mehyar Swelim
        </div>
      </div>
    </MainLayout>
  );
}
