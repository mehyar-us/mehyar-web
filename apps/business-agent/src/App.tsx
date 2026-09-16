import TeamPanel from './TeamPanel';
import MailboxPanel from './MailboxPanel';
import InvitationInbox from './InvitationInbox';
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  CirclePause,
  CirclePlay,
  CreditCard,
  ExternalLink,
  Globe,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  ApiError,
  post,
  displayValue,
  type AuthCapabilities,
  type Grant,
  type Catalog,
  type Memory,
  type Message,
  type Provider,
  type Snapshot,
  type Tenant,
  type User,
} from "./api";

import BillingPanel from "./BillingPanel";
import ApprovalsPanel from "./ApprovalsPanel";
import ResearchPanel from "./ResearchPanel";
import BusinessBriefPanel,{businessDetailLabel} from "./BusinessBriefPanel";
import AgentNamePanel from './AgentNamePanel';
import googleLogo from "./assets/google-g.svg?raw";

type Tab =
  | "chat"
  | "today"
  | "activity"
  | "approvals"
  | "knowledge"
  | "connections"
  | "team"
  | "billing"
  | "settings";
const navigation: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Conversation", icon: MessageSquare },
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "team", label: "Team", icon: Users },
  { id: "billing", label: "Billing & usage", icon: CreditCard },
  { id: "settings", label: "Settings", icon: Settings },
];
const prompts = [
  {
    icon: Globe,
    title: "Get to know my business",
    text: "Help me create an accurate business brief. Tell me what information you need from me.",
  },
  {
    icon: MessageSquare,
    title: "Draft a customer reply",
    text: "Help me draft a response to a customer. Ask me for their message and the relevant business details first.",
  },
  {
    icon: CalendarDays,
    title: "Plan my appointments",
    text: "Help me define appointment hours, service durations, buffers, and rescheduling rules.",
  },
  {
    icon: Zap,
    title: "Find my next automation",
    text: "Based on my approved business knowledge, suggest a useful automation and explain what connections and permissions it needs.",
  },
];
const safeDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
};
const labelStatus = (value: string) =>
  value.replaceAll("_", " ").replaceAll("-", " ");
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" width="34" height="34" />
      {!compact && (
        <span>
          Mayor<span className="brand-ai">AI</span>
        </span>
      )}
    </div>
  );
}
function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="loading-inline" role="status">
      <LoaderCircle size={17} className="spin" />
      {label}
    </span>
  );
}
function Empty({
  icon: Icon = Sparkles,
  title,
  children,
  action,
}: {
  icon?: typeof Sparkles;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ProviderSymbol({ provider }: { provider: "google" | "microsoft" }) {
  const logoId = useId().replaceAll(":", "");
  return provider === "google" ? (
    <span
      className="google-symbol"
      aria-hidden="true"
      // Static official Google asset; scoped IDs isolate repeated SVG masks.
      dangerouslySetInnerHTML={{
        __html: googleLogo.replaceAll("_1298_12516", `_${logoId}`),
      }}
    />
  ) : (
    <span className="microsoft-symbol" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
function CapabilitySelection({
  provider,
  selected,
  onChange,
}: {
  provider?: Provider;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const reasonId = useId();
  const unavailable =
    provider?.capabilities.filter((cap) => !cap.enabled) || [];
  const sharedReason =
    unavailable.length > 1 &&
    unavailable.length === provider?.capabilities.length &&
    new Set(unavailable.map((cap) => cap.reason)).size === 1
      ? unavailable[0].reason ||
        "These tools are not available yet. You can add them when setup is complete."
      : null;
  return (
    <fieldset className="capabilities">
      <legend>
        Choose what your assistant can access <span>Optional</span>
      </legend>
      {sharedReason && (
        <p id={reasonId} className="small muted capability-shared-reason">
          {sharedReason}
        </p>
      )}
      {provider?.capabilities?.length ? (
        provider.capabilities.map((cap) => (
          <label
            key={cap.id}
            className={`capability ${!cap.enabled ? "unavailable" : ""}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(cap.id)}
              disabled={!cap.enabled}
              aria-describedby={
                !cap.enabled && sharedReason ? reasonId : undefined
              }
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, cap.id]
                    : selected.filter((id) => id !== cap.id),
                )
              }
            />
            <span>
              {cap.label}
              {!cap.enabled && !sharedReason && (
                <small>
                  {cap.reason || "Available after provider approval"}
                </small>
              )}
            </span>
          </label>
        ))
      ) : (
        <p className="small muted">
          Sign-in permissions will appear when the connection service is
          available.
        </p>
      )}
      <p className="small muted">
        Leave these unchecked to sign in only. Sending messages and changing
        appointments also need your saved approval rules.
      </p>
    </fieldset>
  );
}
function WorkspaceForm({
  initial,
  busy,
  onSubmit,
}: {
  initial?: { name?: string; website?: string; goal?: string };
  busy: boolean;
  onSubmit: (value: { name: string; website: string; goal: string }) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [website, setWebsite] = useState(initial?.website || "");
  const [goal, setGoal] = useState(initial?.goal || "");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: name.trim(),
          website: website.trim(),
          goal: goal.trim(),
        });
      }}
    >
      <label className="field">
        Business name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="organization"
          placeholder="Your business name"
          autoFocus
        />
      </label>
      <label className="field">
        Business website <span className="optional">Optional</span>
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://yourbusiness.com"
          autoComplete="url"
          maxLength={2048}
        />
      </label>
      <label className="field">
        What would you like help with?
        <textarea
          required
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="For example: turn more inquiries into appointments, and keep follow-ups organized."
          maxLength={2000}
          rows={3}
        />
      </label>
      <div className="notice">
        <ShieldCheck size={18} />
        <p>
          You'll review what your assistant learns and choose its permissions
          before it takes action.
        </p>
      </div>
      <button className="button primary" disabled={busy} type="submit">
        {busy ? (
          <Spinner label="Creating workspace…" />
        ) : (
          <>
            Create my workspace
            <ArrowRight size={17} />
          </>
        )}
      </button>
    </form>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [auth, setAuth] = useState<AuthCapabilities | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [attachGrant, setAttachGrant] = useState<Grant | null>(null);
  const [revokeGrant, setRevokeGrant] = useState<Grant | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationBriefDraft,setConversationBriefDraft]=useState<{tenantId:string;id:string;text:string;field?:string;industryPack?:string}|null>(null);
  useEffect(()=>setConversationBriefDraft(null),[tenantId,user?.id]);
  const [tab, setTab] = useState<Tab>(() =>
    window.location.pathname === "/billing"
      ? "billing"
      : new URLSearchParams(window.location.search).has("connected")
        ? "connections"
        : "chat",
  );
  const [authCallbackError, setAuthCallbackError] = useState(() =>
    new URLSearchParams(window.location.search).has("auth_error"),
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [menu, setMenu] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [connectProvider, setConnectProvider] = useState<
    "google" | "microsoft" | null
  >(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>(
    [],
  );
  const [website, setWebsite] = useState("");
  const [goal, setGoal] = useState("");
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [deleteMemory, setDeleteMemory] = useState<Memory | null>(null);
  const latestTenant = useRef(tenantId);
  latestTenant.current = tenantId;
  const workspaceRequest = useRef<AbortController | null>(null);
  const retryMessage = useRef<{
    tenantId: string;
    content: string;
    key: string;
  } | null>(null);
  const retryWorkspace = useRef<{ payload: string; key: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const fail = useCallback((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    setError(
      cause instanceof Error
        ? cause.message
        : "Something went wrong. Please try again.",
    );
    if (cause instanceof ApiError && cause.status === 401) {
      setUser(null);
      setSnapshot(null);
      setMessages([]);
      setTenants([]);
      setTenantId("");
    }
  }, []);

  const requestedBillingTenant = useRef(
    window.location.pathname === "/billing"
      ? new URLSearchParams(window.location.search).get("tenantId")
      : null,
  );
  const loadTenants = useCallback(async () => {
    const data = await api<{ tenants: Tenant[] }>("/api/tenants");
    setTenants(data.tenants);
    const requested = requestedBillingTenant.current;
    requestedBillingTenant.current = null;
    setTenantId((current) =>
      requested && data.tenants.some((tenant) => tenant.id === requested)
        ? requested
        : data.tenants.some((tenant) => tenant.id === current)
          ? current
          : data.tenants[0]?.id || "",
    );
  }, []);
  const initialize = useCallback(async () => {
    setError("");
    setInitialized(false);
    try {
      const session = await api<{ user: User | null }>("/api/session");
      setUser(session.user);
      if (session.user) await loadTenants();
    } catch (cause) {
      fail(cause);
    } finally {
      setInitialized(true);
    }
  }, [fail, loadTenants]);
  useEffect(() => {
    void initialize();
    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.has("connected") ||
      currentUrl.searchParams.has("auth_error")
    ) {
      currentUrl.searchParams.delete("connected");
      currentUrl.searchParams.delete("auth_error");
      window.history.replaceState(
        null,
        "",
        currentUrl.pathname + currentUrl.search + currentUrl.hash,
      );
    }
    void api<AuthCapabilities>("/api/auth/capabilities")
      .then(setAuth)
      .catch(() => setAuth(null));
    void api<Catalog>("/api/catalog")
      .then(setCatalog)
      .catch(() => setCatalog(null));
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("mayor-onboarding") || "null",
      );
      if (saved) {
        setWebsite(saved.website || "");
        setGoal(saved.goal || "");
      }
    } catch {
      /* A missing draft never prevents sign-in. */
    }
  }, [initialize]);
  useEffect(() => {
    if (!user) {
      setGrants([]);
      return;
    }
    let cancelled = false;
    void api<{ grants: Grant[] }>("/api/auth/grants")
      .then((result) => {
        if (!cancelled) setGrants(result.grants);
      })
      .catch(() => {
        if (!cancelled) setGrants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const refreshWorkspace = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const [detail, conversation] = await Promise.all([
        api<Snapshot>(`/api/tenants/${encodeURIComponent(id)}`, { signal }),
        api<{ messages: Message[] }>(
          `/api/tenants/${encodeURIComponent(id)}/messages`,
          { signal },
        ),
      ]);
      if (latestTenant.current === id && !signal?.aborted) {
        setSnapshot(detail);
        setMessages(conversation.messages);
      }
    },
    [],
  );
  useEffect(() => {
    workspaceRequest.current?.abort();
    setSnapshot(null);
    setMessages([]);
    setDraft("");
    setMemoryKey("");
    setMemoryValue("");
    setNotice("");
    setError("");
    if (!tenantId) return;
    const controller = new AbortController();
    workspaceRequest.current = controller;
    setWorkspaceLoading(true);
    void refreshWorkspace(tenantId, controller.signal)
      .catch(fail)
      .finally(() => {
        if (!controller.signal.aborted) setWorkspaceLoading(false);
      });
    return () => controller.abort();
  }, [tenantId, refreshWorkspace, fail]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);
  const tenant = snapshot?.tenant;
  const canManage = ["owner", "admin", "manager"].includes(
    snapshot?.membership.role || "",
  );
  const paused = tenant?.paused || tenant?.status === "paused";
  const endpoint = tenantId
    ? `/api/tenants/${encodeURIComponent(tenantId)}`
    : "";
  const go = (next: Tab) => {
    setTab(next);
    setMenu(false);
    setNotice("");
  };

  async function startAuth(
    provider: "google" | "microsoft",
    caps: string[],
    connection = false,
  ) {
    setBusy("auth");
    setError("");
    try {
      if (!connection)
        sessionStorage.setItem(
          "mayor-onboarding",
          JSON.stringify({ website, goal }),
        );
      const result = await post<{ url: string }>(
        `/api/auth/start/${provider}`,
        { capabilities: caps, ...(connection && tenantId ? { tenantId } : {}) },
      );
      const url = new URL(result.url, window.location.origin);
      if (url.protocol !== "https:" && url.origin !== window.location.origin)
        throw new Error(
          "The sign-in address is invalid. Please contact support.",
        );
      window.location.assign(url.href);
    } catch (cause) {
      fail(cause);
      setBusy("");
    }
  }
  async function createWorkspace(value: {
    name: string;
    website: string;
    goal: string;
  }) {
    setBusy("create");
    setError("");
    const payload = JSON.stringify(value);
    if (retryWorkspace.current?.payload !== payload)
      retryWorkspace.current = { payload, key: crypto.randomUUID() };
    try {
      const result = await post<{ tenant: Tenant }>("/api/tenants", value, {
        "X-Idempotency-Key": retryWorkspace.current.key,
      });
      await loadTenants();
      setTenantId(result.tenant.id);
      setNewWorkspace(false);
      setTab("chat");
      sessionStorage.removeItem("mayor-onboarding");
      retryWorkspace.current = null;
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !online || busy || !tenantId) return;
    const id = tenantId;
    setError("");
    setBusy("message");
    if (
      retryMessage.current?.content !== content ||
      retryMessage.current?.tenantId !== id
    )
      retryMessage.current = {
        tenantId: id,
        content,
        key: crypto.randomUUID(),
      };
    try {
      const result = await post<{
        message: Message;
        reply?: Message;
        error?: { message?: string };
      }>(
        `${endpoint}/messages`,
        { content },
        { "X-Idempotency-Key": retryMessage.current.key },
      );
      if (latestTenant.current === id) {
        setDraft("");
        if (result.error)
          setError(
            result.error.message ||
              "Your message was saved, but the assistant couldn't reply. Try again shortly.",
          );
      }
      retryMessage.current = null;
      await refreshWorkspace(id);
    } catch (cause) {
      if (latestTenant.current === id) fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function togglePause() {
    if (!tenantId) return;
    const id = tenantId;
    setBusy("pause");
    setError("");
    try {
      await post(`${endpoint}/pause`, { paused: !paused });
      await refreshWorkspace(id);
      if (latestTenant.current === id)
        setNotice(
          paused
            ? "Your workspace has resumed within its saved permissions."
            : "Your assistant is paused. No new automated actions will start.",
        );
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function saveMemory(event: FormEvent) {
    event.preventDefault();
    const id = tenantId;
    setBusy("memory");
    setError("");
    try {
      await post(`${endpoint}/memory`, {
        key: memoryKey.trim(),
        value: memoryValue.trim(),
      });
      await refreshWorkspace(id);
      if (latestTenant.current === id) {
        setMemoryKey("");
        setMemoryValue("");
        setNotice("Business knowledge saved.");
      }
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function removeMemory() {
    if (!deleteMemory) return;
    const id = tenantId;
    setBusy("delete");
    try {
      await api(`${endpoint}/memory/${encodeURIComponent(deleteMemory.id)}`, {
        method: "DELETE",
      });
      setDeleteMemory(null);
      await refreshWorkspace(id);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function signOut() {
    setBusy("logout");
    try {
      await post("/api/auth/sign-out", {});
      workspaceRequest.current?.abort();
      setUser(null);
      setTenantId("");
      setSnapshot(null);
      setMessages([]);
      setTenants([]);
      setDraft("");
      sessionStorage.removeItem("mayor-onboarding");
      setWebsite("");
      setGoal("");
      setError("");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function attachAuthorization() {
    if (!attachGrant || !tenantId) return;
    const id = tenantId;
    setBusy("attach");
    setError("");
    try {
      await post("/api/auth/grants/attach", {
        grantId: attachGrant.id,
        tenantId: id,
      });
      const result = await api<{ grants: Grant[] }>("/api/auth/grants");
      setGrants(result.grants);
      setAttachGrant(null);
      await refreshWorkspace(id);
      setNotice(
        "Authorization assigned to this business. Sync and automation availability are shown separately.",
      );
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }
  async function revokeAuthorization() {
    if (!revokeGrant || !tenantId) return;
    const id = tenantId;
    setBusy("revoke");
    setError("");
    try {
      await post("/api/auth/grants/revoke", {
        grantId: revokeGrant.id,
        tenantId: id,
      });
      const result = await api<{ grants: Grant[] }>("/api/auth/grants");
      setGrants(result.grants);
      setRevokeGrant(null);
      await refreshWorkspace(id);
      setNotice(
        "This workspace's authorization is disconnected. Your provider's account consent and your sign-in remain separate.",
      );
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy("");
    }
  }

  const feedback = (
    <>
      {authCallbackError && (
        <div className="banner error" role="alert">
          <CircleHelp size={18} />
          <span>
            Authorization was not completed. Your existing access is unchanged.
            Try again or choose a different account.
          </span>
          <button
            className="icon-button"
            onClick={() => setAuthCallbackError(false)}
            aria-label="Dismiss authorization error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!online && (
        <div className="banner offline" role="status">
          <WifiOff size={17} />
          <span>
            You're offline. You can compose a draft; sending and account changes
            need a connection.
          </span>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          <CircleHelp size={18} />
          <span>{error}</span>
          <button
            className="icon-button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="banner success" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
  if (!initialized)
    return (
      <div className="startup">
        <Logo />
        <Spinner label="Opening your workspace…" />
      </div>
    );

  if (!user)
    return (
      <div className="welcome-page">
        <div className="welcome-story">
          <Logo />
          <div className="welcome-copy">
            <span className="eyebrow">
              A little less busy. A lot more business.
            </span>
            <h1>
              Your next <br />
              great hire
              <br />
              <em>is always here.</em>
            </h1>
            <p>
              One assistant that gets to know your business. A clear place for
              customer conversations, appointments, and the work in between.
            </p>
            <div className="welcome-illustration" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit-core">
                <img src="/icon.svg" alt="" />
              </div>
              <span className="orbit-chip chip-mail">
                <MessageSquare size={17} />
                Customers
              </span>
              <span className="orbit-chip chip-calendar">
                <CalendarDays size={17} />
                Appointments
              </span>
              <span className="orbit-chip chip-knowledge">
                <BookOpen size={17} />
                Your knowledge
              </span>
            </div>
          </div>
          <p className="welcome-footer">
            <ShieldCheck size={16} />
            Your business. Your permissions. Your control.
          </p>
        </div>
        <main className="welcome-form">
          <div className="welcome-form-inner">
            <span className="eyebrow">MEET MAYOR AI</span>
            <h2>
              Let's start with <br />
              your business.
            </h2>
            <p className="lead">
              Tell us a little. We'll build the workspace around you.
            </p>
            {feedback}
            <label className="field">
              Business website <span className="optional">Optional</span>
              <div className="input-icon">
                <Globe size={18} />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourbusiness.com"
                  maxLength={2048}
                />
              </div>
            </label>
            <label className="field">
              What would make your day easier?
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="Fewer missed inquiries? More organized appointments?"
                maxLength={2000}
              />
            </label>
            <CapabilitySelection
              provider={auth?.providers.google}
              selected={selectedCapabilities}
              onChange={setSelectedCapabilities}
            />
            <button
              className="button google-button"
              disabled={
                !online || !!busy || !auth?.providers.google?.configured
              }
              onClick={() => void startAuth("google", selectedCapabilities)}
            >
              <ProviderSymbol provider="google" />
              {busy === "auth"
                ? "Opening secure sign-in…"
                : "Continue with Google"}
              <ArrowRight size={17} />
            </button>
            <button
              className="button secondary"
              disabled={
                !online || !!busy || !auth?.providers.microsoft?.configured
              }
              onClick={() => void startAuth("microsoft", [])}
            >
              <ProviderSymbol provider="microsoft" />
              Continue with Microsoft
            </button>
            {!auth?.providers.google?.configured &&
              !auth?.providers.microsoft?.configured && (
                <p className="setup-note">
                  Sign-in is awaiting configuration. Your workspace will be
                  available once the connection service is ready.{" "}
                  <button
                    className="text-button"
                    onClick={() => window.location.reload()}
                  >
                    Check again
                  </button>
                </p>
              )}
            <p className="consent-note">
              Your provider will ask you to approve access. You can continue
              with identity only and connect tools later.
            </p>
            <a className="back-link" href="https://mehyar.us">
              ← Back to Mehyar
            </a>
          </div>
        </main>
      </div>
    );

  if (!tenantId && !workspaceLoading)
    return (
      <div className="setup-page">
        <header>
          <Logo />
          <button
            className="button quiet"
            onClick={() => void signOut()}
            disabled={!!busy}
          >
            Sign out
            <LogOut size={16} />
          </button>
        </header>
        <main className="setup-card">
          <span className="eyebrow">YOUR BUSINESS, YOUR SPACE</span>
          <h1>Welcome, {user.name?.split(" ")[0] || "there"}.</h1>
          <p className="lead">
            Give your assistant a home. Add what you know now; you can refine
            the details together.
          </p>
          {feedback}
          <InvitationInbox key={user.id} online={online} onAccepted={async id=>{await loadTenants();setTenantId(id);}}/>
          <WorkspaceForm
            busy={busy === "create"}
            initial={{ website, goal }}
            onSubmit={(value) => void createWorkspace(value)}
          />
        </main>
      </div>
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="sidebar-logo">
          <Logo />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-select">
          <div className="workspace-monogram">
            {(
              tenant?.name ||
              tenants.find((t) => t.id === tenantId)?.name ||
              "B"
            )
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div>
            <label htmlFor="workspace">YOUR WORKSPACE</label>
            <div className="select-wrap">
              <select
                id="workspace"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {tenants.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>
        <button
          className="new-workspace"
          onClick={() => setNewWorkspace(true)}
          disabled={!online}
        >
          <Plus size={14} />
          Add a business
        </button>
        <nav aria-label="Workspace navigation">
          {navigation.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""} ${index === 4 || index === 6 ? "nav-separated" : ""}`}
              onClick={() => go(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.7} />
              {label}
              {id === "chat" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="control-note">
            <ShieldCheck size={18} />
            <p>
              You set the direction.
              <br />
              <strong>Mayor works within your rules.</strong>
            </p>
          </div>
          <div className="user-row">
            <div className="avatar">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{user.name || "Your account"}</strong>
              <span>{user.email}</span>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void signOut()}
              disabled={!!busy}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>{navigation.find((item) => item.id === tab)?.label}</span>
            <span className="topbar-separator">/</span>
            <span className="topbar-business">
              {tenant?.name || "Workspace"}
            </span>
          </div>
          <div className="topbar-actions">
            {tenant && (
              <span className={`status-pill ${paused ? "paused" : ""}`}>
                <span />
                {labelStatus(tenant.status || "draft")}
              </span>
            )}
            <button
              className={`button pause-button ${paused ? "resume" : ""}`}
              onClick={() => void togglePause()}
              disabled={!online || !tenant || !canManage || !!busy}
              title={
                canManage
                  ? undefined
                  : "Only a workspace owner or manager can pause execution"
              }
            >
              {busy === "pause" ? (
                <LoaderCircle size={16} className="spin" />
              ) : paused ? (
                <CirclePlay size={16} />
              ) : (
                <CirclePause size={16} />
              )}
              {paused ? "Resume assistant" : "Pause assistant"}
            </button>
          </div>
        </header>
        <main
          id="main-content"
          className={`main-content ${tab === "chat" ? "conversation-page" : ""}`}
        >
          <div className="feedback-area">{feedback}</div>
          {workspaceLoading ? (
            <div className="page-loading">
              <Spinner label="Loading your business…" />
            </div>
          ) : !snapshot ? (
            <Empty
              title="Your workspace couldn't load"
              action={
                <button
                  className="button primary"
                  onClick={() => void refreshWorkspace(tenantId).catch(fail)}
                >
                  Try again
                </button>
              }
            >
              Your data is still private. Try refreshing the connection.
            </Empty>
          ) : (
            <>
              {tab === "chat" && (
                <div className="chat-layout">
                  <section
                    className="chat-main"
                    aria-label="Business conversation"
                  >
                    {messages.length === 0 ? (
                      <div className="chat-welcome">
                        <div className="assistant-mark">
                          <Sparkles size={24} />
                        </div>
                        <span className="eyebrow">
                          YOUR BUSINESS HAS A NEW TEAMMATE
                        </span>
                        <h1>
                          Big plans.
                          <br />
                          <span>Let's make room for them.</span>
                        </h1>
                        <p>
                          I'm {tenant?.agentName || "Mayor"}, your business
                          assistant.
                          <br />
                          Tell me what needs your attention. We'll take it from
                          here, together.
                        </p>
                        <div className="starter-grid">
                          {prompts.map(({ icon: Icon, title, text }) => (
                            <button
                              className="starter-card"
                              key={title}
                              onClick={() => {
                                setDraft(text);
                                composer.current?.focus();
                              }}
                            >
                              <Icon size={20} />
                              <strong>{title}</strong>
                              <ArrowRight size={15} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="messages"
                        aria-label="Conversation messages"
                        aria-live="polite"
                      >
                        {messages.map((message) => (
                          <article
                            key={message.id}
                            className={`message ${message.role === "user" ? "from-user" : "from-assistant"}`}
                          >
                            <div className="message-avatar">
                              {message.role === "user" ? (
                                (user.name || "Y").slice(0, 1)
                              ) : (
                                <Sparkles size={16} />
                              )}
                            </div>
                            <div className="message-body">
                              <div className="message-meta">
                                <strong>
                                  {message.role === "user"
                                    ? "You"
                                    : tenant?.agentName || "Mayor"}
                                </strong>
                                <time>{safeDate(message.createdAt)}</time>
                              </div>
                              <p>{message.content}</p>
                              {message.role==="user"&&snapshot.membership.role==="owner"&&<button className="button secondary" disabled={!online} onClick={()=>{setConversationBriefDraft({tenantId,id:message.id,text:message.content});go("knowledge");}}>Use in business brief</button>}
                              {message.role==='assistant'&&snapshot.membership.role==='owner'&&Array.isArray(message.briefSuggestions)&&message.briefSuggestions.slice(0,3).filter(s=>s&&typeof s.field==='string'&&businessDetailLabel(s.field)&&typeof s.value==='string'&&s.value.length<=2000&&typeof s.sourceMessageId==='string').map(s=><div key={s.field}><p>Suggested {businessDetailLabel(s.field)?.toLowerCase()}: {s.value}</p><button className="button secondary" disabled={!online} onClick={()=>{setConversationBriefDraft({tenantId,id:s.sourceMessageId,text:s.value,field:s.field,industryPack:s.industryPack});go('knowledge');}}>Review suggested {businessDetailLabel(s.field)?.toLowerCase()}</button></div>)}
                            </div>
                          </article>
                        ))}
                        {busy === "message" && (
                          <div className="message-pending">
                            <Spinner label="Sending your message…" />
                          </div>
                        )}
                        <div ref={bottom} />
                      </div>
                    )}
                    <div className="composer-container">
                      <form
                        className="composer"
                        onSubmit={(event) => void sendMessage(event)}
                      >
                        <label className="sr-only" htmlFor="chat-message">
                          Message your assistant
                        </label>
                        <textarea
                          id="chat-message"
                          ref={composer}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder={`Ask ${tenant?.agentName || "Mayor"} anything about your business…`}
                          rows={2}
                          maxLength={12000}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.shiftKey &&
                              !e.nativeEvent.isComposing
                            ) {
                              e.preventDefault();
                              e.currentTarget.form?.requestSubmit();
                            }
                          }}
                        />
                        <div className="composer-bottom">
                          <span>
                            <ShieldCheck size={14} />
                            Your private workspace
                          </span>
                          <button
                            type="submit"
                            className="send-button"
                            aria-label="Send message"
                            disabled={!online || !draft.trim() || !!busy}
                          >
                            {busy === "message" ? (
                              <LoaderCircle size={18} className="spin" />
                            ) : (
                              <ArrowUp size={19} />
                            )}
                          </button>
                        </div>
                      </form>
                      <p className="composer-note">
                        Review important details. External actions follow your
                        saved permissions.
                      </p>
                    </div>
                  </section>
                  <aside className="business-context">
                    <div className="context-top">
                      <span className="eyebrow">BUSINESS CONTEXT</span>
                      <Globe size={17} />
                    </div>
                    <div className="context-business-mark">
                      {tenant?.name.slice(0, 1)}
                    </div>
                    <h2>{tenant?.name}</h2>
                    <p>
                      {tenant?.website
                        ? tenant.website
                            .replace(/^https?:\/\//, "")
                            .replace(/\/$/, "")
                        : "Add your website in your business knowledge"}
                    </p>
                    <div className="context-divider" />
                    <div className="context-stat">
                      <span>Approved knowledge</span>
                      <strong>{snapshot.memory?.length || 0} facts</strong>
                    </div>
                    <div className="context-stat">
                      <span>Account connections</span>
                      <strong>{snapshot.connections?.length || 0}</strong>
                    </div>
                    <button
                      className="context-link"
                      onClick={() => go("knowledge")}
                    >
                      Review business knowledge
                      <ArrowRight size={15} />
                    </button>
                    <div className="context-tip">
                      <div>
                        <Sparkles size={17} />
                        <strong>Make it yours</strong>
                      </div>
                      <p>
                        Your hours, services, and preferred tone help Mayor give
                        more useful answers.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => go("knowledge")}
                      >
                        Add business details
                        <Plus size={13} />
                      </button>
                    </div>
                    <p className="context-foot">
                      <ShieldCheck size={14} />
                      Knowledge stays in this workspace.
                    </p>
                  </aside>
                </div>
              )}
              {tab === "today" && (
                <div className="page">
                  <PageHeading
                    eyebrow="A LITTLE CLARITY FOR YOUR DAY"
                    title={`Good to see you, ${user.name?.split(" ")[0] || "there"}.`}
                    description="A clear view of your workspace, with room for what matters."
                  />
                  <div className="stats-grid">
                    <Stat
                      label="Business knowledge"
                      value={String(snapshot.memory?.length || 0)}
                      caption="Facts available to your assistant"
                      icon={BookOpen}
                    />
                    <Stat
                      label="Account connections"
                      value={String(snapshot.connections?.length || 0)}
                      caption="Manage access in Connections"
                      icon={Link2}
                    />
                    <Stat
                      label="Recorded activity"
                      value={String(snapshot.activity?.length || 0)}
                      caption="Events returned by your workspace"
                      icon={ActivityIcon}
                    />
                  </div>
                  <div className="two-column">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Your next step</h2>
                        <Sparkles size={19} />
                      </div>
                      <div className="next-step">
                        <h3>
                          {snapshot.memory?.length
                            ? "Put your business knowledge to work."
                            : "Teach Mayor the essentials."}
                        </h3>
                        <p>
                          {snapshot.memory?.length
                            ? "Start a conversation about a customer reply, appointment rules, or the work you want help with."
                            : "Add your services, hours, and important policies so your assistant has a trusted starting point."}
                        </p>
                        <button
                          className="button primary"
                          onClick={() =>
                            go(snapshot.memory?.length ? "chat" : "knowledge")
                          }
                        >
                          {snapshot.memory?.length
                            ? "Open conversation"
                            : "Add business knowledge"}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Recent activity</h2>
                        <button
                          className="text-button"
                          onClick={() => go("activity")}
                        >
                          View all
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <ActivityList snapshot={snapshot} limit={4} />
                    </section>
                  </div>
                </div>
              )}
              {tab === "activity" && (
                <div className="page">
                  <PageHeading
                    eyebrow="EVERY STEP, VISIBLE"
                    title="Your activity."
                    description="A record of what happened in this business workspace."
                  />
                  <section className="panel">
                    <ActivityList snapshot={snapshot} />
                  </section>
                </div>
              )}
              {tab === "approvals" && (
                <ApprovalsPanel key={`${tenantId}:${snapshot.membership.role}`} tenantId={tenantId}
                  role={snapshot.membership.role} grants={grants} online={online} paused={snapshot.usage?.paused === true} onUnauthorized={fail}/>
              )}
              {tab === "knowledge" && (
                <div className="page">
                  <PageHeading
                    eyebrow="GOOD ANSWERS START HERE"
                    title="Business knowledge."
                    description="Your source of truth. Add the details you want Mayor to remember."
                  />
                  <div className="knowledge-layout">
                    <section className="panel memory-list">
                      <div className="panel-heading">
                        <h2>Saved knowledge</h2>
                        <span className="count-badge">
                          {snapshot.memory?.length || 0}
                        </span>
                      </div>
                      {snapshot.memory?.length ? (
                        snapshot.memory.map((memory) => (
                          <article className="memory-item" key={memory.id}>
                            <div>
                              <strong>{memory.key}</strong>
                              <p>{displayValue(memory.value)}</p>
                              <span className="small muted">
                                {memory.source === "owner"
                                  ? "Added by your business"
                                  : memory.source === "owner_confirmed_website" ? "Website claim confirmed by owner" : memory.source || "Source not recorded"}
                                {memory.updatedAt
                                  ? ` · ${safeDate(memory.updatedAt)}`
                                  : ""}
                              </span>
                            </div>
                            {canManage && (
                              <button
                                className="icon-button"
                                aria-label={`Delete ${memory.key}`}
                                disabled={!online || !!busy}
                                onClick={() => setDeleteMemory(memory)}
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </article>
                        ))
                      ) : (
                        <Empty
                          icon={BookOpen}
                          title="A fresh start for your knowledge"
                        >
                          Add your opening hours, services, preferred tone, or
                          the policies customers ask about.
                        </Empty>
                      )}
                    </section>
                    <section className="panel knowledge-editor">
                      <div className="panel-heading">
                        <h2>Add a business detail</h2>
                        <Plus size={17} />
                      </div>
                      {canManage ? (
                        <form
                          className="stack"
                          onSubmit={(e) => void saveMemory(e)}
                        >
                          <label className="field">
                            What is this about?
                            <input
                              value={memoryKey}
                              onChange={(e) => setMemoryKey(e.target.value)}
                              placeholder="Opening hours"
                              required
                              maxLength={120}
                            />
                          </label>
                          <label className="field">
                            The detail to remember
                            <textarea
                              value={memoryValue}
                              onChange={(e) => setMemoryValue(e.target.value)}
                              placeholder="Monday–Friday, 9 AM–5 PM, Eastern time."
                              rows={5}
                              required
                              maxLength={12000}
                            />
                          </label>
                          <p className="small muted">
                            Use the same topic to update an existing fact. Save
                            business information here, never passwords or API
                            keys.
                          </p>
                          <button
                            type="submit"
                            className="button primary"
                            disabled={!online || !!busy}
                          >
                            {busy === "memory" ? (
                              <Spinner label="Saving…" />
                            ) : (
                              <>
                                Save knowledge
                                <Check size={16} />
                              </>
                            )}
                          </button>
                        </form>
                      ) : (
                        <p className="muted">
                          Your workspace owner or manager can update business
                          knowledge.
                        </p>
                      )}
                    </section>
                  </div>
                  {['owner','manager'].includes(snapshot.membership.role) && <BusinessBriefPanel key={`brief:${tenantId}:${snapshot.membership.role}`} tenantId={tenantId} online={online} canEdit={snapshot.membership.role==='owner'} onUnauthorized={fail} conversationDraft={conversationBriefDraft?.tenantId===tenantId?conversationBriefDraft:undefined} onDismissConversationDraft={()=>setConversationBriefDraft(null)}/>}
                  {['owner','manager'].includes(snapshot.membership.role) && <ResearchPanel key={`${tenantId}:${snapshot.membership.role}`} tenantId={tenantId} online={online} canConfirm={snapshot.membership.role==='owner'} onSaved={()=>refreshWorkspace(tenantId)} onUnauthorized={fail}/>}
                </div>
              )}
              {tab === "connections" && (
                <div className="page">
                  <PageHeading
                    eyebrow="BRING YOUR TOOLS TOGETHER"
                    title="Connections."
                    description="Choose which accounts Mayor can use. You stay in control of access."
                  />
                  {grants
                    .filter(
                      (grant) =>
                        !grant.tenantId &&
                        grant.status !== "revoked" &&
                        grant.grantedCapabilities.length > 0,
                    )
                    .map((grant) => (
                      <section
                        key={grant.id}
                        className="panel unassigned-grant"
                      >
                        <div>
                          <strong>
                            Assign your{" "}
                            {grant.provider === "google"
                              ? "Google"
                              : "Microsoft"}{" "}
                            authorization
                          </strong>
                          <p>{grant.accountEmail||'Account identity unavailable'}</p>
                          <p>
                            You approved access during sign-in. Confirm which
                            business can use it.
                          </p>
                          <span className="small muted">
                            {grant.grantedCapabilities
                              .map(labelStatus)
                              .join(" · ")}
                          </span>
                        </div>
                        <button
                          className="button secondary"
                          disabled={!online || !canManage || !!busy}
                          onClick={() => setAttachGrant(grant)}
                        >
                          Use for this business
                          <ArrowRight size={15} />
                        </button>
                      </section>
                    ))}
                  {grants.some((grant) => grant.tenantId === tenantId) && (
                    <section className="panel authorization-panel">
                      <div className="panel-heading">
                        <h2>Your account authorizations</h2>
                        <ShieldCheck size={18} />
                      </div>
                      {grants
                        .filter((grant) => grant.tenantId === tenantId)
                        .map((grant) => (
                          <div className="authorization-row" key={grant.id}>
                            <div>
                              <strong>
                                {grant.provider === "google"
                                  ? "Google"
                                  : "Microsoft"}
                              </strong>
                              <span className="subtle-pill">
                                {labelStatus(grant.status)}
                              </span>
                              <p>{grant.accountEmail||'Account identity unavailable'}</p>
                              <p>
                                {grant.grantedCapabilities
                                  .map(labelStatus)
                                  .join(" · ") ||
                                  "No tool capabilities granted"}
                              </p>
                              {canManage&&grant.provider==='google'&&grant.status!=='revoked'&&grant.grantedCapabilities.includes('gmail_read')&&
                                <MailboxPanel tenantId={tenantId} grantId={grant.id} online={online} onUnauthorized={fail}/>}
                            </div>
                            {grant.status !== "revoked" && (
                              <button
                                className="button secondary"
                                disabled={!online || !canManage || !!busy}
                                onClick={() => setRevokeGrant(grant)}
                              >
                                Disconnect
                              </button>
                            )}
                          </div>
                        ))}
                    </section>
                  )}
                  <div className="notice connection-notice">
                    <ShieldCheck size={17} />
                    <p>
                      An authorized account is permission to connect. Background
                      sync and individual automations become available only
                      after their setup is complete.
                    </p>
                  </div>
                  <div className="connection-grid">
                    {(["google", "microsoft"] as const).map((provider) => {
                      const accounts = (snapshot.connections || []).filter(
                        (connection) => connection.provider === provider,
                      );
                      return (
                        <section
                          className="panel connection-card"
                          key={provider}
                        >
                          <div className="connection-heading">
                            <ProviderSymbol provider={provider} />
                            <span className="subtle-pill">
                              {accounts.length
                                ? `${accounts.length} authorization${accounts.length === 1 ? "" : "s"}`
                                : "Not connected"}
                            </span>
                          </div>
                          <h2>
                            {provider === "google"
                              ? "Google Workspace"
                              : "Microsoft 365"}
                          </h2>
                          <p>
                            {provider === "google"
                              ? "Business email, calendar, and the Drive documents you choose."
                              : "Outlook email and calendars for your workday."}
                          </p>
                          {accounts.map((connection) => (
                            <div
                              className="connected-account"
                              key={connection.id}
                            >
                              <span>
                                {connection.accountEmail ||
                                  connection.email ||
                                  provider}
                              </span>
                              <strong>{labelStatus(connection.status)}</strong>
                            </div>
                          ))}
                          <button
                            className="button secondary"
                            disabled={
                              !online ||
                              !!busy ||
                              !canManage ||
                              !auth?.providers[provider]?.configured
                            }
                            onClick={() => {
                              setSelectedCapabilities([]);
                              setConnectProvider(provider);
                            }}
                          >
                            Connect{" "}
                            {provider === "google" ? "Google" : "Microsoft"}
                            <ArrowRight size={16} />
                          </button>
                          {!auth?.providers[provider]?.configured && (
                            <small className="muted">
                              Awaiting provider configuration
                            </small>
                          )}
                        </section>
                      );
                    })}
                    <section className="panel connection-card">
                      <div className="connection-heading">
                        <MessageSquare size={27} />
                        <span className="subtle-pill">Not available yet</span>
                      </div>
                      <h2>WhatsApp Business</h2>
                      <p>
                        Customer conversations using your business number and
                        approved messaging permissions.
                      </p>
                      <div className="connection-footnote">
                        Business onboarding and messaging approval are required
                        before activation.
                      </div>
                    </section>
                    <section className="panel connection-card">
                      <div className="connection-heading">
                        <CalendarDays size={27} />
                        <span className="subtle-pill">Not available yet</span>
                      </div>
                      <h2>Phone & appointments</h2>
                      <p>
                        Call handling and confirmed scheduling will appear here
                        when the service is ready.
                      </p>
                      <div className="connection-footnote">
                        No number has been provisioned by this app.
                      </div>
                    </section>
                  </div>
                </div>
              )}
              {tab === "team" && (
                <div className="page">
                  <PageHeading
                    eyebrow="A SHARED PLACE TO WORK"
                    title="Your team."
                    description="People and permissions for this business."
                  />
                  <InvitationInbox key={user.id} online={online} onAccepted={async id=>{await loadTenants();setTenantId(id);}}/>
                  {snapshot.membership.role==='owner'?<TeamPanel key={tenantId} tenantId={tenantId} online={online}/>:<>
                  <section className="panel">
                    <div className="team-member">
                      <div className="avatar">
                        {(user.name || user.email).slice(0, 1)}
                      </div>
                      <div>
                        <strong>{user.name || user.email}</strong>
                        <span>{user.email}</span>
                      </div>
                      <span className="subtle-pill">
                        {snapshot.membership.role}
                      </span>
                      <span className="small muted">You</span>
                    </div>
                    <div className="inline-empty">
                      <Users size={20} />
                      <p>
                        This is your verified membership. The business owner manages team invitations and access.
                      </p>
                    </div>
                  </section>
                  </>}
                </div>
              )}
              {tab === "billing" && (
                <BillingPanel
                  key={tenantId}
                  tenantId={tenantId}
                  role={snapshot.membership.role}
                  catalog={catalog}
                  online={online}
                  onUnauthorized={fail}
                />
              )}
              {tab === "settings" && (
                <div className="page">
                  <PageHeading
                    eyebrow="MAKE MAYOR YOURS"
                    title="Workspace settings."
                    description="Your business identity and execution controls."
                  />
                  <section className="panel settings-panel">
                    {snapshot.membership.role==='owner'&&<AgentNamePanel key={`agent-name:${tenantId}:${snapshot.membership.role}`} tenantId={tenantId} agentName={tenant?.agentName||'Mayor'} online={online} onSaved={()=>refreshWorkspace(tenantId)} onUnauthorized={fail}/>}
                    <dl className="details-list">
                      <div>
                        <dt>Business</dt>
                        <dd>{tenant?.name}</dd>
                      </div>
                      <div>
                        <dt>Assistant</dt>
                        <dd>{tenant?.agentName || "Mayor"}</dd>
                      </div>
                      <div>
                        <dt>Website</dt>
                        <dd>{tenant?.website || "Not added"}</dd>
                      </div>
                      <div>
                        <dt>Workspace status</dt>
                        <dd>{labelStatus(tenant?.status || "draft")}</dd>
                      </div>
                      <div>
                        <dt>Your role</dt>
                        <dd>{snapshot.membership.role}</dd>
                      </div>
                    </dl>
                    <div className="settings-pause">
                      <div>
                        <h3>
                          {paused
                            ? "Your assistant is paused"
                            : "Pause your assistant"}
                        </h3>
                        <p>
                          Stop new automated actions while retaining your
                          workspace and knowledge.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => void togglePause()}
                        disabled={!online || !canManage || !!busy}
                      >
                        {paused ? (
                          <CirclePlay size={17} />
                        ) : (
                          <CirclePause size={17} />
                        )}
                        {paused ? "Resume assistant" : "Pause assistant"}
                      </button>
                    </div>
                  </section>
                  <div className="notice">
                    <ShieldCheck size={18} />
                    <p>
                      Changes to business facts can be made in Knowledge.
                      Additional policy, export, and account-removal controls
                      need service support before they can be offered here.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {newWorkspace && (
        <Dialog
          title="Add a business workspace"
          onClose={() => setNewWorkspace(false)}
        >
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          <WorkspaceForm
            busy={busy === "create"}
            onSubmit={(value) => void createWorkspace(value)}
          />
        </Dialog>
      )}
      {connectProvider && (
        <Dialog
          title={`Connect ${connectProvider === "google" ? "Google" : "Microsoft"}`}
          onClose={() => setConnectProvider(null)}
        >
          <p className="muted">
            Choose access for {tenant?.name}. Your provider will confirm each
            permission.
          </p>
          <CapabilitySelection
            provider={auth?.providers[connectProvider]}
            selected={selectedCapabilities}
            onChange={setSelectedCapabilities}
          />
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={!online || !!busy || !selectedCapabilities.length}
            onClick={() =>
              void startAuth(connectProvider, selectedCapabilities, true)
            }
          >
            {busy === "auth" ? (
              <Spinner label="Opening authorization…" />
            ) : (
              <>
                Continue to{" "}
                {connectProvider === "google" ? "Google" : "Microsoft"}
                <ExternalLink size={16} />
              </>
            )}
          </button>
        </Dialog>
      )}
      {deleteMemory && (
        <Dialog
          title="Remove this business detail?"
          onClose={() => setDeleteMemory(null)}
        >
          <p>
            “{deleteMemory.key}” will be removed from the saved knowledge in
            this workspace.
          </p>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteMemory(null)}
            >
              Keep detail
            </button>
            <button
              className="button danger"
              disabled={!online || !!busy}
              onClick={() => void removeMemory()}
            >
              {busy === "delete" ? "Removing…" : "Remove detail"}
            </button>
          </div>
        </Dialog>
      )}
      {attachGrant && (
        <Dialog
          title="Confirm this business connection"
          onClose={() => setAttachGrant(null)}
        >
          <p>
            Allow <strong>{tenant?.name}</strong> to use your previously
            approved {attachGrant.provider} access?
          </p>
          <p>Account: {attachGrant.accountEmail||'Identity unavailable'}</p>
          <p className="small muted">
            {attachGrant.grantedCapabilities.map(labelStatus).join(" · ")}. This
            does not authorize new message sending or automatic actions.
          </p>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={!online || !!busy}
            onClick={() => void attachAuthorization()}
          >
            {busy === "attach" ? (
              <Spinner label="Assigning…" />
            ) : (
              "Confirm business connection"
            )}
          </button>
        </Dialog>
      )}
      {revokeGrant && (
        <Dialog
          title="Disconnect this authorization?"
          onClose={() => setRevokeGrant(null)}
        >
          <p>
            Remove this {revokeGrant.provider} tool authorization from{" "}
            <strong>{tenant?.name}</strong>. Work depending on it will need a
            new connection.
          </p>
          <p>Account: {revokeGrant.accountEmail||'Identity unavailable'}</p>
          <p className="small muted">
            This removes this workspace's saved access. It does not remove the
            app's consent from your provider account, disconnect another
            business, or sign you out.
          </p>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setRevokeGrant(null)}
            >
              Keep connection
            </button>
            <button
              className="button danger"
              disabled={!online || !!busy}
              onClick={() => void revokeAuthorization()}
            >
              {busy === "revoke"
                ? "Disconnecting…"
                : "Disconnect authorization"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: typeof BookOpen;
}) {
  return (
    <section className="stat panel">
      <div>
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <p>{caption}</p>
    </section>
  );
}
function ActivityList({
  snapshot,
  limit,
}: {
  snapshot: Snapshot;
  limit?: number;
}) {
  const items = limit ? snapshot.activity?.slice(0, limit) : snapshot.activity;
  return items?.length ? (
    <div className="activity-list">
      {items.map((entry) => (
        <article className="activity-item" key={entry.id}>
          <div className="activity-icon">
            <ActivityIcon size={16} />
          </div>
          <div>
            <strong>
              {entry.title ||
                labelStatus(entry.action || entry.type || "Workspace event")}
            </strong>
            {entry.description && <p>{entry.description}</p>}
            <time>{safeDate(entry.createdAt)}</time>
          </div>
          {entry.status && (
            <span className="subtle-pill">{labelStatus(entry.status)}</span>
          )}
        </article>
      ))}
    </div>
  ) : (
    <Empty icon={ActivityIcon} title="Your activity will appear here">
      Completed work and workspace events will be recorded as they happen.
    </Empty>
  );
}
