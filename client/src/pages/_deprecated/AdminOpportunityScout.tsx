import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Gauge,
  History,
  Lightbulb,
  ListChecks,
  Play,
  RefreshCcw,
  Save,
  SearchCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AdminOpportunityScoutAssistantResponse,
  AdminOpportunityScoutDiagnosticsResponse,
  AdminOpportunityScoutExecutionLoop,
  AdminOpportunityScoutGate,
  AdminOpportunityScoutOpportunity,
  AdminOpportunityScoutRun,
  AdminOpportunityScoutSettings,
  AdminOpportunityScoutSource,
  mehyarSoftApi,
} from "@/lib/mehyarsoft-api";

type ScoutTab = "today" | "history" | "settings" | "diagnostics";

type EditableIdea = {
  title: string;
  summary: string;
  target_customer: string;
  monetization_path: string;
  owner_notes: string;
  kanban_title: string;
  kanban_body: string;
  recommended_assignee: string;
};

const tabs: { key: ScoutTab; label: string; icon: typeof Lightbulb }[] = [
  { key: "today", label: "Today's Ideas", icon: Lightbulb },
  { key: "history", label: "History", icon: History },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "diagnostics", label: "Sources / Diagnostics", icon: SearchCheck },
];

const safeStatusTone: Record<string, string> = {
  new: "bg-brand-100 text-brand-900 dark:bg-white/10 dark:text-brand-100",
  edited: "bg-cyan-100 text-cyan-900 dark:bg-cyan-400/15 dark:text-cyan-100",
  approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100",
  rejected: "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-100",
  kanban_created: "bg-purple-100 text-purple-900 dark:bg-purple-400/15 dark:text-purple-100",
};

function dollars(cents?: number | null) {
  return `$${Math.round((cents || 0) / 100).toLocaleString()}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function labelize(value?: string | null) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function listPreview(items: unknown, fallback = "Not returned") {
  if (Array.isArray(items)) return items.length ? items.map((item) => typeof item === "string" ? item : JSON.stringify(item)).slice(0, 4).join(" · ") : fallback;
  if (items && typeof items === "object") return JSON.stringify(items);
  return fallback;
}

function settingBool(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function GateList({ gates }: { gates: AdminOpportunityScoutGate[] }) {
  if (!gates.length) return <p className="text-sm text-muted-foreground">No gates returned yet.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {gates.map((gate) => (
        <div key={gate.key} className="rounded-2xl border border-border bg-secondary/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-foreground">{labelize(gate.key)}</p>
            <Badge className={gate.status === "blocked" ? "bg-red-100 text-red-900 dark:bg-red-400/15 dark:text-red-100" : gate.status === "warn" || gate.status === "attention" ? "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100"}>{labelize(gate.status)}</Badge>
          </div>
          {gate.detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{gate.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

function OpportunityCard({
  opportunity,
  selected,
  onSelect,
}: {
  opportunity: AdminOpportunityScoutOpportunity;
  selected: boolean;
  onSelect: (opportunity: AdminOpportunityScoutOpportunity) => void;
}) {
  const status = opportunity.status || "new";
  return (
    <button
      type="button"
      onClick={() => onSelect(opportunity)}
      className={`w-full rounded-[1.35rem] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_44px_rgba(8,63,84,0.10)] ${selected ? "border-brand-700 bg-card shadow-[0_16px_44px_rgba(8,63,84,0.10)] dark:border-brand-200" : "border-border bg-card"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{opportunity.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{opportunity.summary || opportunity.monetization_path || "No summary returned yet."}</p>
        </div>
        <Badge className={safeStatusTone[status] || "bg-secondary text-secondary-foreground"}>{labelize(status)}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-secondary/50 p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Budget</p><p className="mt-1 font-semibold text-foreground">{dollars(opportunity.estimated_cost_cents ?? opportunity.startup_cost_cents)}</p></div>
        <div className="rounded-2xl bg-secondary/50 p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Confidence</p><p className="mt-1 font-semibold text-foreground">{labelize(opportunity.confidence)} · {opportunity.score || opportunity.priority_score || 0}/100</p></div>
        <div className="rounded-2xl bg-secondary/50 p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Difficulty</p><p className="mt-1 font-semibold text-foreground">{opportunity.labor_hours ? `${opportunity.labor_hours}h build` : `${opportunity.priority_tier || "low"} priority`}</p></div>
        <div className="rounded-2xl bg-secondary/50 p-3"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Target customer</p><p className="mt-1 font-semibold text-foreground">{opportunity.target_customer || "Local SMB"}</p></div>
      </div>
    </button>
  );
}

function SelectedOpportunityDetail({
  opportunity,
  executionLoop,
  editable,
  setEditable,
  rejectReason,
  setRejectReason,
  selectedActionId,
  onApprove,
  onReject,
  onEdit,
  onRegenerate,
  onCreateKanban,
}: {
  opportunity: AdminOpportunityScoutOpportunity | null;
  executionLoop: AdminOpportunityScoutExecutionLoop | null;
  editable: EditableIdea;
  setEditable: (next: EditableIdea) => void;
  rejectReason: string;
  setRejectReason: (value: string) => void;
  selectedActionId: string | null;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onCreateKanban: () => void;
}) {
  if (!opportunity) {
    return <Card className="border-border bg-card"><CardContent className="p-6"><div className="text-center"><Lightbulb className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" /><h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">No idea selected</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Run Opportunity Scout or select an existing idea to inspect evidence, plan, and Kanban blueprint.</p></div></CardContent></Card>;
  }
  const isBusy = selectedActionId === opportunity.id;
  const plan = opportunity.plan || {};
  return (
    <div className="space-y-5">
      <Card className="border-border bg-card"><CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Execution plan</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">{plan.objective || opportunity.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{opportunity.monetization_path || "Plan waits for backend generated monetization path."}</p>
          </div>
          <Badge className="bg-secondary text-secondary-foreground">{opportunity.kanban_task_id ? `Kanban: ${opportunity.kanban_task_id}` : "No Kanban card yet"}</Badge>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Expected profit</p><p className="mt-1 text-2xl font-semibold text-foreground">{dollars(opportunity.expected_profit_cents ?? opportunity.profit_potential_cents)}</p></div>
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">First-cash path</p><p className="mt-1 text-sm font-semibold leading-6 text-foreground">{String(opportunity.revenue_assumptions?.expected_first_cash_path || plan.expected_first_cash_path || "Manual owner execution only")}</p></div>
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">ROI filters</p><p className="mt-1 text-sm font-semibold leading-6 text-foreground">{executionLoop?.roi?.passes_filters ? "Pass" : "Review required"} · score {String(executionLoop?.roi?.score ?? opportunity.priority_score ?? 0)}</p></div>
        </div>
      </CardContent></Card>

      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><SearchCheck className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Raw trend evidence</h4>
        <div className="mt-4 space-y-3">
          {(opportunity.evidence || []).length ? (opportunity.evidence || []).slice(0, 5).map((item, index) => <pre key={`${opportunity.id}-evidence-${index}`} className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border bg-secondary/40 p-3 text-xs leading-5 text-muted-foreground">{JSON.stringify(item, null, 2)}</pre>) : <p className="text-sm text-muted-foreground">No evidence rows returned yet.</p>}
        </div>
      </CardContent></Card>

      <Card className="border-border bg-card"><CardContent className="p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><ClipboardList className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Kanban blueprint</h4>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Cards stay internal and require approval/config gates. This UI never spends, publishes, emails, SMS, runs ads, or uses historical audiences.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Title</p><p className="mt-2 font-semibold text-foreground">{String(plan.kanban_title || "No title returned")}</p></div>
          <div className="rounded-2xl border border-border bg-secondary/40 p-4"><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Assignee</p><p className="mt-2 font-semibold text-foreground">{String(plan.recommended_assignee || "productops")}</p></div>
        </div>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-secondary/40 p-4 text-xs leading-5 text-muted-foreground">{String(plan.kanban_body || listPreview(opportunity.kanban_blueprint || executionLoop?.kanban_blueprint, "No body returned"))}</pre>
      </CardContent></Card>

      <Card className="border-border bg-card"><CardContent className="space-y-4 p-5">
        <h4 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-foreground"><ListChecks className="h-5 w-5 text-brand-700 dark:text-brand-100" aria-hidden="true" />Edit/review idea</h4>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="scout-title">Title</Label><Input id="scout-title" value={editable.title} onChange={(event) => setEditable({ ...editable, title: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="scout-customer">Target customer</Label><Input id="scout-customer" value={editable.target_customer} onChange={(event) => setEditable({ ...editable, target_customer: event.target.value })} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="scout-summary">Summary</Label><Textarea id="scout-summary" rows={3} value={editable.summary} onChange={(event) => setEditable({ ...editable, summary: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="scout-monetization">Monetization path</Label><Textarea id="scout-monetization" rows={3} value={editable.monetization_path} onChange={(event) => setEditable({ ...editable, monetization_path: event.target.value })} /></div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="scout-kanban-title">Kanban title</Label><Input id="scout-kanban-title" value={editable.kanban_title} onChange={(event) => setEditable({ ...editable, kanban_title: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="scout-assignee">Recommended assignee</Label><Input id="scout-assignee" value={editable.recommended_assignee} onChange={(event) => setEditable({ ...editable, recommended_assignee: event.target.value })} /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="scout-kanban-body">Kanban body</Label><Textarea id="scout-kanban-body" rows={5} value={editable.kanban_body} onChange={(event) => setEditable({ ...editable, kanban_body: event.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="scout-notes">Owner notes</Label><Textarea id="scout-notes" rows={3} value={editable.owner_notes} onChange={(event) => setEditable({ ...editable, owner_notes: event.target.value })} placeholder="Private notes; no external action." /></div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onEdit} disabled={isBusy}><Save aria-hidden="true" /> Save edits</Button>
          <Button variant="outline" onClick={onApprove} disabled={isBusy}><CheckCircle2 aria-hidden="true" /> Approve</Button>
          <Button variant="outline" onClick={onRegenerate} disabled={isBusy}><RefreshCcw aria-hidden="true" /> Regenerate plan</Button>
          <Button variant="cta" onClick={onCreateKanban} disabled={isBusy || opportunity.status !== "approved"}><ClipboardList aria-hidden="true" /> Create Kanban tasks</Button>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-400/10">
          <Label htmlFor="scout-reject" className="text-amber-950 dark:text-amber-100">Reject reason</Label>
          <div className="mt-2 flex flex-col gap-3 md:flex-row"><Input id="scout-reject" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Why this is not worth doing" /><Button variant="outline" onClick={onReject} disabled={isBusy || !rejectReason.trim()}><XCircle aria-hidden="true" /> Reject</Button></div>
        </div>
      </CardContent></Card>
    </div>
  );
}

function WealthAssistPanel({ token, selectedId }: { token: string; selectedId?: string | null }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("What is the safest next money action for this opportunity without spending money or contacting anyone?");
  const [response, setResponse] = useState<AdminOpportunityScoutAssistantResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const ask = async () => {
    setIsLoading(true);
    try {
      setResponse(await mehyarSoftApi.askOpportunityScoutAssistant(token, { prompt, opportunity_id: selectedId || undefined }));
      toast({ title: "AI wealth assist returned", description: "Internal-only guidance loaded. External actions remain blocked." });
    } catch (error) {
      toast({ title: "AI assist unavailable", description: error instanceof Error ? error.message : "Assistant endpoint did not respond.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const assistant = response?.assistant || {};
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
      <CardContent className="p-5">
        <div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><Bot className="h-5 w-5" aria-hidden="true" /></div><div><h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">AI wealth assist</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Private next-action suggestions only. It cannot send, post, buy, run ads, charge, email, SMS, or use legacy audiences.</p></div></div>
        <div className="mt-4 space-y-3"><Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} /><Button variant="secondary" onClick={() => void ask()} disabled={isLoading || !prompt.trim()}><Sparkles aria-hidden="true" /> {isLoading ? "Thinking..." : "Ask for next action"}</Button></div>
        {response ? <div className="mt-4 space-y-3 rounded-2xl border border-border bg-secondary/40 p-4 text-sm leading-6"><p className="font-semibold text-foreground">{String(assistant.summary || "No summary returned")}</p><p className="text-muted-foreground">Next steps: {listPreview(assistant.next_steps)}</p><p className="text-muted-foreground">Risks: {listPreview(assistant.risks, "No risks returned")}</p><Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100">Owner approval required</Badge></div> : null}
      </CardContent>
    </Card>
  );
}

export default function AdminOpportunityScout({ token }: { token: string }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ScoutTab>("today");
  const [opportunities, setOpportunities] = useState<AdminOpportunityScoutOpportunity[]>([]);
  const [history, setHistory] = useState<AdminOpportunityScoutOpportunity[]>([]);
  const [runs, setRuns] = useState<AdminOpportunityScoutRun[]>([]);
  const [settings, setSettings] = useState<AdminOpportunityScoutSettings | null>(null);
  const [gates, setGates] = useState<AdminOpportunityScoutGate[]>([]);
  const [sources, setSources] = useState<AdminOpportunityScoutSource[]>([]);
  const [diagnostics, setDiagnostics] = useState<AdminOpportunityScoutDiagnosticsResponse | null>(null);
  const [executionLoop, setExecutionLoop] = useState<AdminOpportunityScoutExecutionLoop | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editable, setEditable] = useState<EditableIdea>({ title: "", summary: "", target_customer: "", monetization_path: "", owner_notes: "", kanban_title: "", kanban_body: "", recommended_assignee: "productops" });
  const [rejectReason, setRejectReason] = useState("");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<AdminOpportunityScoutSettings | null>(null);

  const selectedOpportunity = useMemo(() => opportunities.find((item) => item.id === selectedId) || history.find((item) => item.id === selectedId) || opportunities[0] || history[0] || null, [history, opportunities, selectedId]);

  const applySelection = async (opportunity: AdminOpportunityScoutOpportunity | null) => {
    if (!opportunity) return;
    setSelectedId(opportunity.id);
    setEditable({
      title: opportunity.title || "",
      summary: opportunity.summary || "",
      target_customer: opportunity.target_customer || "",
      monetization_path: opportunity.monetization_path || "",
      owner_notes: opportunity.owner_notes || "",
      kanban_title: String(opportunity.plan?.kanban_title || opportunity.title || ""),
      kanban_body: String(opportunity.plan?.kanban_body || opportunity.summary || ""),
      recommended_assignee: String(opportunity.plan?.recommended_assignee || "productops"),
    });
    try {
      setExecutionLoop(await mehyarSoftApi.getOpportunityScoutExecutionLoop(token, opportunity.id));
    } catch {
      setExecutionLoop(null);
    }
  };

  const loadToday = async (showError = false) => {
    setIsLoading(true);
    try {
      const response = await mehyarSoftApi.getOpportunityScoutToday(token);
      setOpportunities(response.opportunities || []);
      setSettings(response.settings || null);
      setSettingsDraft(response.settings || null);
      setGates(response.gates || []);
      await applySelection((response.opportunities || [])[0] || selectedOpportunity);
    } catch (error) {
      setOpportunities([]);
      if (showError) toast({ title: "Opportunity Scout unavailable", description: error instanceof Error ? error.message : "Today endpoint did not respond.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistory = async () => {
    const [runsResponse, opportunitiesResponse] = await Promise.all([
      mehyarSoftApi.getOpportunityScoutRuns(token).catch(() => ({ runs: [] })),
      mehyarSoftApi.getOpportunityScoutOpportunities(token).catch(() => ({ opportunities: [] })),
    ]);
    setRuns(runsResponse.runs || []);
    setHistory(opportunitiesResponse.opportunities || []);
  };

  const loadDiagnostics = async () => {
    const [sourceResponse, diagnosticsResponse] = await Promise.all([
      mehyarSoftApi.getOpportunityScoutSources(token).catch(() => ({ sources: [] })),
      mehyarSoftApi.getOpportunityScoutDiagnostics(token).catch(() => null),
    ]);
    setSources(sourceResponse.sources || []);
    setDiagnostics(diagnosticsResponse);
  };

  useEffect(() => {
    void loadToday();
    void loadHistory();
    void loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (selectedOpportunity && selectedOpportunity.id !== selectedId) void applySelection(selectedOpportunity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOpportunity?.id]);

  const runNow = async () => {
    setIsRunning(true);
    try {
      const response = await mehyarSoftApi.runOpportunityScout(token);
      toast({ title: "Opportunity Scout run finished", description: `${response.opportunities_created || 0} created · ${response.duplicates_skipped || 0} duplicates skipped · ${response.blocked_count || 0} blocked.` });
      await Promise.all([loadToday(true), loadHistory()]);
    } catch (error) {
      toast({ title: "Run failed", description: error instanceof Error ? error.message : "Manual run endpoint did not finish.", variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([loadToday(true), loadHistory(), loadDiagnostics()]);
  };

  const mutateSelected = async (action: () => Promise<unknown>, successTitle: string, successDescription: string) => {
    if (!selectedOpportunity) return;
    setSelectedActionId(selectedOpportunity.id);
    try {
      await action();
      toast({ title: successTitle, description: successDescription });
      await Promise.all([loadToday(), loadHistory()]);
    } catch (error) {
      toast({ title: `${successTitle} failed`, description: error instanceof Error ? error.message : "Protected API rejected the action.", variant: "destructive" });
    } finally {
      setSelectedActionId(null);
    }
  };

  const saveSettings = async () => {
    if (!settingsDraft) return;
    setIsLoading(true);
    try {
      const response = await mehyarSoftApi.updateOpportunityScoutSettings(token, settingsDraft);
      setSettings(response.settings);
      setSettingsDraft(response.settings);
      toast({ title: "Settings saved", description: "Opportunity Scout settings updated; external action gates remain visible." });
      await loadToday();
    } catch (error) {
      toast({ title: "Settings save failed", description: error instanceof Error ? error.message : "Protected settings endpoint rejected the change.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const todayStats = useMemo(() => ({
    ideas: opportunities.length,
    approved: opportunities.filter((item) => item.status === "approved" || item.status === "kanban_created").length,
    budget: Math.max(0, ...(opportunities.map((item) => item.estimated_cost_cents || 0)), settings?.max_budget_cents || 5000),
  }), [opportunities, settings]);

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]"><CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center"><div className="flex gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div><div><h3 className="text-xl font-semibold tracking-[-0.025em] text-foreground">No-spend opportunity intelligence</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Generates 1-3 low-cost ideas under the configured $0-$50 cap, stores evidence/history, and only creates internal Kanban after owner approval and config gates. Historical email/SMS audiences are compliance-sensitive and blocked.</p></div></div><div className="flex flex-wrap gap-3"><Button variant="cta" onClick={() => void runNow()} disabled={isRunning}><Play aria-hidden="true" /> {isRunning ? "Running..." : "Run now"}</Button><Button variant="outline" onClick={() => void refreshAll()} disabled={isLoading || isRunning}><RefreshCcw aria-hidden="true" /> Refresh</Button></div></CardContent></Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border bg-card"><CardContent className="p-5"><Lightbulb className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">Today ideas</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{todayStats.ideas}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="p-5"><CheckCircle2 className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">Approved / queued</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{todayStats.approved}</p></CardContent></Card>
        <Card className="border-border bg-card"><CardContent className="p-5"><Gauge className="mb-3 text-brand-700 dark:text-brand-100" aria-hidden="true" /><p className="text-sm text-muted-foreground">Budget cap</p><p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-foreground">{dollars(settings?.max_budget_cents || todayStats.budget)}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-3">{tabs.map((tab) => <Button key={tab.key} variant={activeTab === tab.key ? "secondary" : "outline"} onClick={() => setActiveTab(tab.key)}><tab.icon aria-hidden="true" /> {tab.label}</Button>)}</div>

      {activeTab === "today" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Today's Ideas</h3><p className="text-sm text-muted-foreground">Pain → low-cost offer → internal execution plan. No external action leaves this dashboard.</p></div>{isLoading ? <Badge className="bg-secondary text-secondary-foreground">Loading...</Badge> : null}</div>
            {opportunities.length ? opportunities.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} selected={selectedOpportunity?.id === opportunity.id} onSelect={(item) => void applySelection(item)} />) : <Card className="border-border bg-card"><CardContent className="p-8 text-center"><Lightbulb className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" /><h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-foreground">No ideas returned yet</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Click Run now to call the protected backend. Safe empty state: no spend, no sends, no publishing, no legacy audience use.</p></CardContent></Card>}
            <WealthAssistPanel token={token} selectedId={selectedOpportunity?.id} />
          </div>
          <SelectedOpportunityDetail
            opportunity={selectedOpportunity}
            executionLoop={executionLoop}
            editable={editable}
            setEditable={setEditable}
            rejectReason={rejectReason}
            setRejectReason={setRejectReason}
            selectedActionId={selectedActionId}
            onApprove={() => void mutateSelected(() => mehyarSoftApi.approveOpportunityScoutOpportunity(token, selectedOpportunity!.id), "Idea approved", "Approval recorded. Kanban still requires a separate config-gated click.")}
            onReject={() => void mutateSelected(() => mehyarSoftApi.rejectOpportunityScoutOpportunity(token, selectedOpportunity!.id, rejectReason), "Idea rejected", "Reject reason stored for history and duplicate learning.")}
            onEdit={() => void mutateSelected(() => mehyarSoftApi.updateOpportunityScoutOpportunity(token, selectedOpportunity!.id, { title: editable.title, summary: editable.summary, target_customer: editable.target_customer, monetization_path: editable.monetization_path, owner_notes: editable.owner_notes, plan: { kanban_title: editable.kanban_title, kanban_body: editable.kanban_body, recommended_assignee: editable.recommended_assignee } }), "Idea edited", "Owner edits were saved without any external action.")}
            onRegenerate={() => void mutateSelected(() => mehyarSoftApi.regenerateOpportunityScoutPlan(token, selectedOpportunity!.id), "Plan regenerated", "Backend created fresh private plan candidates from safe signals.")}
            onCreateKanban={() => void mutateSelected(() => mehyarSoftApi.createOpportunityScoutKanban(token, selectedOpportunity!.id, { title: editable.kanban_title, body: editable.kanban_body, assignee: editable.recommended_assignee }), "Kanban card created", "Internal task created after approval/config gates. No public action was taken.")}
          />
        </div>
      ) : null}

      {activeTab === "history" ? <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><Card className="border-border bg-card"><CardContent className="p-5"><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Run history</h3><div className="mt-4 space-y-3">{runs.length ? runs.map((run) => <div key={run.id} className="rounded-2xl border border-border bg-secondary/40 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">{run.trigger_type || "manual"} · {run.status || "unknown"}</p><Badge className="bg-secondary text-secondary-foreground">{run.opportunities_created ?? 0} ideas</Badge></div><p className="mt-2 text-sm text-muted-foreground">Started {formatDate(run.started_at)} · signals {run.signals_fetched ?? 0} · duplicates {run.duplicates_skipped ?? 0} · blocked {run.blocked_count ?? 0}</p></div>) : <p className="text-sm text-muted-foreground">No run rows returned yet.</p>}</div></CardContent></Card><Card className="border-border bg-card"><CardContent className="p-5"><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Stored opportunity history</h3><div className="mt-4 space-y-3">{history.length ? history.map((item) => <OpportunityCard key={item.id} opportunity={item} selected={selectedOpportunity?.id === item.id} onSelect={(opportunity) => void applySelection(opportunity)} />) : <p className="text-sm text-muted-foreground">No stored opportunities returned yet.</p>}</div></CardContent></Card></div> : null}

      {activeTab === "settings" && settingsDraft ? <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]"><Card className="border-border bg-card"><CardContent className="space-y-4 p-5"><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Settings</h3><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="scout-daily">Max daily ideas</Label><Input id="scout-daily" type="number" min={1} max={3} value={settingsDraft.max_daily_ideas} onChange={(event) => setSettingsDraft({ ...settingsDraft, max_daily_ideas: Number(event.target.value) })} /></div><div className="space-y-2"><Label htmlFor="scout-budget">Max budget cents</Label><Input id="scout-budget" type="number" min={0} max={5000} value={settingsDraft.max_budget_cents} onChange={(event) => setSettingsDraft({ ...settingsDraft, max_budget_cents: Number(event.target.value) })} /></div><div className="space-y-2"><Label htmlFor="scout-score">Min score</Label><Input id="scout-score" type="number" min={0} max={100} value={settingsDraft.min_score} onChange={(event) => setSettingsDraft({ ...settingsDraft, min_score: Number(event.target.value) })} /></div><div className="space-y-2"><Label htmlFor="scout-roi">Min ROI score</Label><Input id="scout-roi" type="number" min={0} max={100} value={settingsDraft.min_roi_score} onChange={(event) => setSettingsDraft({ ...settingsDraft, min_roi_score: Number(event.target.value) })} /></div><div className="space-y-2"><Label htmlFor="scout-time">Scheduled local time</Label><Input id="scout-time" value={settingsDraft.scheduled_local_time} onChange={(event) => setSettingsDraft({ ...settingsDraft, scheduled_local_time: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="scout-dupe">Duplicate window days</Label><Input id="scout-dupe" type="number" min={1} max={365} value={settingsDraft.duplicate_window_days} onChange={(event) => setSettingsDraft({ ...settingsDraft, duplicate_window_days: Number(event.target.value) })} /></div></div><div className="grid gap-3 md:grid-cols-2"><Button variant={settingsDraft.enabled ? "secondary" : "outline"} onClick={() => setSettingsDraft({ ...settingsDraft, enabled: !settingsDraft.enabled })}>Scheduled scout: {settingBool(settingsDraft.enabled)}</Button><Button variant={settingsDraft.kanban_creation_enabled ? "secondary" : "outline"} onClick={() => setSettingsDraft({ ...settingsDraft, kanban_creation_enabled: !settingsDraft.kanban_creation_enabled })}>Kanban creation: {settingBool(settingsDraft.kanban_creation_enabled)}</Button><Button variant={settingsDraft.assistant_enabled ? "secondary" : "outline"} onClick={() => setSettingsDraft({ ...settingsDraft, assistant_enabled: !settingsDraft.assistant_enabled })}>AI assist: {settingBool(settingsDraft.assistant_enabled)}</Button><Button variant={settingsDraft.diagnostics_enabled ? "secondary" : "outline"} onClick={() => setSettingsDraft({ ...settingsDraft, diagnostics_enabled: !settingsDraft.diagnostics_enabled })}>Diagnostics: {settingBool(settingsDraft.diagnostics_enabled)}</Button></div><Button variant="cta" onClick={() => void saveSettings()} disabled={isLoading}><Save aria-hidden="true" /> Save settings</Button></CardContent></Card><Card className="border-border bg-card"><CardContent className="p-5"><h3 className="mb-4 text-2xl font-semibold tracking-[-0.025em] text-foreground">Approval gates</h3><GateList gates={gates} /></CardContent></Card></div> : null}

      {activeTab === "diagnostics" ? <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]"><Card className="border-border bg-card"><CardContent className="p-5"><h3 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">Sources</h3><div className="mt-4 space-y-3">{sources.length ? sources.map((source) => <div key={source.key} className="rounded-2xl border border-border bg-secondary/40 p-4"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-foreground">{labelize(source.key)}</p><Badge className={source.available ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-100"}>{source.available ? "available" : "attention"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">Enabled: {String(source.enabled ?? source.configured ?? false)} · read-only: {String(source.read_only ?? source.private_analysis_only ?? true)} · API key present: {source.api_key_present === undefined ? "not required" : String(source.api_key_present)}</p></div>) : <p className="text-sm text-muted-foreground">No source rows returned yet.</p>}</div></CardContent></Card><Card className="border-border bg-card"><CardContent className="p-5"><h3 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.025em] text-foreground"><AlertTriangle className="h-6 w-6 text-brand-700 dark:text-brand-100" aria-hidden="true" />Diagnostics</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Names/status only. No API keys, OAuth payloads, raw audience data, or PII are rendered.</p><pre className="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-2xl border border-border bg-secondary/40 p-4 text-xs leading-5 text-muted-foreground">{JSON.stringify(diagnostics?.diagnostics || diagnostics || { status: "not_loaded" }, null, 2)}</pre></CardContent></Card></div> : null}
    </div>
  );
}
