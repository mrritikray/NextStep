/**
 * NextStep — dynamic feature components.
 *
 * These are wired to the real tRPC/SQLite backend (no static data):
 *  - RoadmapProgressPanel   → live task counts for the current roadmap
 *  - RoadmapStepResources   → "Find Learning Resources" + language picker
 *  - OpportunityHistoryView → Saved Data / Opportunity History (switch, delete)
 *  - AfterInterviewPanel    → rejection (+ reason / skip) or selection outcome
 *  - OpportunityDeleteButton→ delete an opportunity with confirmation
 *
 * The visual language matches the existing workspace (ns-card / ns-* helpers and
 * the --ns-* design tokens), so nothing about the current UI design changes.
 */
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  GraduationCap,
  History,
  Languages,
  ListChecks,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Trophy,
  X,
  Youtube,
} from "lucide-react";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Small shared primitives                                             */
/* ------------------------------------------------------------------ */

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (message && message.length < 220 && !/^\s*\[/.test(message)) return message;
  }
  return fallback;
}

function ProgressBar({ value, color = "var(--ns-t-0f8b87)" }: { value: number; color?: string }) {
  return (
    <div className="ns-progress">
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}

function shortDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function NextStepModal({
  open,
  title,
  detail,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  detail?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#173144]/35 p-4">
      <div className="ns-card max-h-[88vh] w-full max-w-lg overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="ns-label">NextStep</p>
            <h2 className="mt-1 font-display text-xl font-bold">{title}</h2>
            {detail && <p className="mt-2 text-sm leading-6 text-[color:var(--ns-t-7a8b91)]">{detail}</p>}
          </div>
          <button className="ns-ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Roadmap progress (dynamic, from the current roadmap)             */
/* ------------------------------------------------------------------ */

export function RoadmapProgressPanel({ onViewRoadmap }: { onViewRoadmap?: () => void }) {
  const progressQuery = trpc.roadmap.progress.useQuery();
  const progress = progressQuery.data;
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const remaining = progress?.remaining ?? 0;
  const percent = progress?.percent ?? 0;

  const tiles = [
    { label: "Total tasks", value: total, tint: "bg-[color:var(--ns-s-e8eef8)] text-[color:var(--ns-t-5b7caf)]", icon: ListChecks },
    { label: "Completed", value: completed, tint: "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]", icon: CheckCircle2 },
    { label: "Remaining", value: remaining, tint: "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]", icon: Clock3 },
    { label: "Progress", value: `${percent}%`, tint: "bg-[color:var(--ns-s-eeeafa)] text-[color:var(--ns-t-795ea2)]", icon: Target },
  ];

  return (
    <div className="ns-card mt-5 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="ns-label">Roadmap progress</p>
          <h2 className="mt-1 font-display text-xl font-bold">
            {progress?.targetOpportunity || "Your current learning roadmap"}
          </h2>
          <p className="mt-2 text-xs text-[color:var(--ns-t-7d8e94)]">
            {total
              ? `${completed} of ${total} tasks complete · ${remaining} still to go. Counts update the moment a task is ticked.`
              : "Analyze an opportunity to generate a roadmap — the counts here will follow it automatically."}
          </p>
        </div>
        {onViewRoadmap && (
          <button className="ns-ghost" onClick={onViewRoadmap}>
            View roadmap <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {tiles.map(tile => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className="rounded-2xl bg-[color:var(--ns-s-f7faf8)] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">{tile.label}</p>
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${tile.tint}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
              </div>
              <p className="mt-3 font-display text-2xl font-extrabold tracking-[-0.04em]">{tile.value}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex justify-between text-xs font-semibold">
          <span className="text-[color:var(--ns-t-5a727a)]">Overall completion</span>
          <span className="text-[color:var(--ns-t-173144)]">{percent}%</span>
        </div>
        <ProgressBar value={percent} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Learning resources per roadmap task                              */
/* ------------------------------------------------------------------ */

const KIND_META: Record<string, { label: string; icon: React.ElementType; tint: string }> = {
  youtube_video: { label: "YouTube video", icon: Youtube, tint: "bg-[color:var(--ns-s-f9e8e5)] text-[color:var(--ns-t-c66b57)]" },
  youtube_playlist: { label: "YouTube playlist", icon: PlayCircle, tint: "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]" },
  course: { label: "Free course", icon: GraduationCap, tint: "bg-[color:var(--ns-s-e8eef8)] text-[color:var(--ns-t-5b7caf)]" },
  website: { label: "Learning website", icon: Globe, tint: "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]" },
};

export function RoadmapStepResources({ itemId, title }: { itemId: string; title: string }) {
  const numericId = Number(itemId);
  const utils = trpc.useUtils();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);

  const preferenceQuery = trpc.roadmap.resourcePreference.useQuery();
  const storedQuery = trpc.roadmap.itemResources.useQuery(undefined);
  const findResources = trpc.roadmap.findResources.useMutation();

  const languages = preferenceQuery.data?.languages ?? [{ id: "English", label: "English", native: "English", searchTerm: "english" }];
  const selectedLanguage = preferenceQuery.data?.selected ?? "English";
  const stored = (storedQuery.data?.resources ?? []).filter(resource => resource.roadmapItemId === numericId);
  const shownLanguage = stored[0]?.language ?? selectedLanguage;
  const grouped = (["youtube_video", "youtube_playlist", "course", "website"] as const)
    .map(kind => ({ kind, items: stored.filter(resource => resource.kind === kind) }))
    .filter(group => group.items.length > 0);

  const runSearch = async (language: string) => {
    // Guard: a second click while a search is in flight is dropped — no
    // duplicate Gemini request.
    if (findResources.isPending || pendingLanguage) return;
    setPendingLanguage(language);
    try {
      const result = await findResources.mutateAsync({ itemId: numericId, language });
      await Promise.all([
        utils.roadmap.itemResources.invalidate(),
        utils.roadmap.resourcePreference.invalidate(),
        utils.notification.list.invalidate(),
      ]);
      setPickerOpen(false);
      toast.success(`Resources ready in ${language}`, {
        description: `${result.resources.length} suggestion(s) for “${title}” · saved as your preferred language.`,
      });
    } catch (error) {
      toast.error("Could not find learning resources", { description: errorMessage(error, "Please try again.") });
    } finally {
      setPendingLanguage(null);
    }
  };

  const isNewSearch = stored.length === 0;

  return (
    <div className="mt-4 border-t border-[color:var(--ns-b-edf1ef)] pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-bold text-[color:var(--ns-t-71838a)]">Learning resources</span>
          <p className="mt-1 text-[11px] text-[color:var(--ns-t-8b9a9e)]">
            {stored.length
              ? `${stored.length} saved suggestion${stored.length === 1 ? "" : "s"} · ${shownLanguage}${stored.some(item => !item.verified) ? " · some links unverified" : " · links verified"}`
              : `Preferred language: ${selectedLanguage}`}
          </p>
        </div>
        <button
          className="ns-secondary px-3 py-2 text-xs"
          onClick={() => setPickerOpen(true)}
          disabled={findResources.isPending}
        >
          {findResources.isPending ? (
            <>
              <Clock3 className="h-3.5 w-3.5 animate-pulse" /> Searching…
            </>
          ) : isNewSearch ? (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Find Learning Resources
            </>
          ) : (
            <>
              <Languages className="h-3.5 w-3.5" /> Change language / refresh
            </>
          )}
        </button>
      </div>

      {grouped.length > 0 && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {grouped.map(group => {
            const meta = KIND_META[group.kind] ?? KIND_META.website;
            const Icon = meta.icon;
            return (
              <div key={group.kind} className="rounded-2xl bg-[color:var(--ns-s-f7faf8)] p-4">
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.tint}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">{meta.label}</p>
                </div>
                <div className="mt-3 space-y-2">
                  {group.items.map(resource => (
                    <a
                      key={`${resource.id ?? resource.url}`}
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-xl border border-[color:var(--ns-b-e5ece9)] bg-[color:var(--ns-s-ffffff)] p-3 transition-colors hover:border-[color:var(--ns-b-92c2c0)]"
                    >
                      <p className="text-xs font-bold text-[color:var(--ns-t-173144)]">{resource.title}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[10px] text-[color:var(--ns-t-849398)]">
                        {resource.source || new URL(resource.url).hostname} · {resource.language}
                        <ExternalLink className="h-3 w-3" />
                        {resource.verified ? (
                          <span className="ml-1 rounded-full bg-[color:var(--ns-s-e3f2ed)] px-1.5 py-0.5 font-bold text-[color:var(--ns-t-15807b)]">verified</span>
                        ) : (
                          <span className="ml-1 rounded-full bg-[color:var(--ns-s-f9efdf)] px-1.5 py-0.5 font-bold text-[color:var(--ns-t-b57e35)]">search link</span>
                        )}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NextStepModal
        open={pickerOpen}
        title="Choose your learning language"
        detail="Resources for this task will be suggested in the language you pick, and the choice is remembered for every future search."
        onClose={() => setPickerOpen(false)}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {languages.map(language => (
            <button
              key={language.id}
              className={`rounded-xl border px-3 py-3 text-left text-xs font-semibold transition-colors ${
                selectedLanguage === language.id
                  ? "border-[color:var(--ns-b-8bc6ba)] bg-[color:var(--ns-s-e8f4f0)] text-[color:var(--ns-t-0f7582)]"
                  : "border-[color:var(--ns-b-e2ebe8)] text-[color:var(--ns-t-72858b)] hover:bg-[color:var(--ns-s-f7faf8)]"
              }`}
              onClick={() => void runSearch(language.id)}
              disabled={Boolean(pendingLanguage)}
            >
              <span className="block">{language.label}</span>
              <span className="mt-0.5 block text-[10px] font-normal text-[color:var(--ns-t-8b9a9e)]">{language.native}</span>
              {pendingLanguage === language.id && (
                <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[color:var(--ns-t-0f7582)]">
                  <Clock3 className="h-3 w-3 animate-pulse" /> Searching…
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="mt-4 flex items-center gap-2 text-[11px] text-[color:var(--ns-t-84949a)]">
          <Check className="h-3.5 w-3.5 text-[color:var(--ns-t-63a48e)]" />
          Every link is checked before it is shown — NextStep never invents URLs. Links open in a new tab.
        </p>
      </NextStepModal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Saved Data / Opportunity History                                 */
/* ------------------------------------------------------------------ */

function HistoryCard({ snapshot, onChanged }: { snapshot: HistorySnapshot; onChanged: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const utils = trpc.useUtils();
  const switchMutation = trpc.opportunity.switch.useMutation();
  const deleteMutation = trpc.opportunity.delete.useMutation();

  const switchTo = async () => {
    try {
      const result = await switchMutation.mutateAsync({ id: snapshot.opportunityId });
      await utils.opportunity.history.invalidate();
      onChanged();
      toast.success("Opportunity restored", {
        description:
          result.restored
            ? `Switched to ${snapshot.jobTitle || "this role"} and restored its roadmap (${result.progress.completed}/${result.progress.total}).`
            : `Switched to ${snapshot.jobTitle || "this role"} — its roadmap and history are live again.`,
      });
    } catch (error) {
      toast.error("Could not switch opportunity", { description: errorMessage(error, "Please try again.") });
    }
  };

  const remove = async () => {
    try {
      await deleteMutation.mutateAsync({ id: snapshot.opportunityId });
      setConfirmOpen(false);
      onChanged();
      toast.success("Opportunity deleted", {
        description: "Its roadmap, analysis, application and saved history were removed. Your profile and skills were kept.",
      });
    } catch (error) {
      toast.error("Could not delete this opportunity", { description: errorMessage(error, "Please try again.") });
    }
  };

  const statusTone =
    snapshot.applicationStatus === "Selected"
      ? "bg-[color:var(--ns-s-e5f2ed)] text-[color:var(--ns-t-3e947d)]"
      : snapshot.applicationStatus === "Rejected"
        ? "bg-[color:var(--ns-s-fae8e3)] text-[color:var(--ns-t-bf6756)]"
        : "bg-[color:var(--ns-s-f1f5f3)] text-[color:var(--ns-t-76878c)]";

  return (
    <div className="ns-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--ns-s-eaf1ef)] text-sm font-extrabold text-[color:var(--ns-t-50757b)]">
            {(snapshot.company || "?").slice(0, 1)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold">{snapshot.jobTitle || "Untitled role"}</p>
              {snapshot.isCurrent && (
                <span className="rounded-full bg-[color:var(--ns-s-e5f2ed)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--ns-t-3e947d)]">
                  Current
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[color:var(--ns-t-7f8e93)]">
              {snapshot.company || "Company not stated"} · saved {shortDate(snapshot.savedAt)}
            </p>
          </div>
        </div>
        <button className="ns-ghost p-1" onClick={() => setMenuOpen(!menuOpen)} aria-label="More actions">
          <Trash2 className="h-4 w-4 text-[color:var(--ns-t-c66b57)]" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--ns-t-85959a)]">Match</p>
          <p className="mt-1 font-display text-lg font-extrabold">{snapshot.matchPercentage}%</p>
        </div>
        <div className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--ns-t-85959a)]">Tasks</p>
          <p className="mt-1 font-display text-lg font-extrabold">
            {snapshot.progress.completed}/{snapshot.progress.total}
          </p>
        </div>
        <div className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--ns-t-85959a)]">Progress</p>
          <p className="mt-1 font-display text-lg font-extrabold">{snapshot.progress.percent}%</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[color:var(--ns-t-7d8e94)]">Roadmap</span>
          <span className="font-semibold text-[color:var(--ns-t-46636c)]">
            {snapshot.hasRoadmap ? `${snapshot.progress.remaining} task(s) remaining` : "No roadmap saved"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[color:var(--ns-t-7d8e94)]">Application</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusTone}`}>
            {snapshot.applicationStatus || "Not tracked"}
          </span>
        </div>
        {snapshot.rejectionReason && (
          <div className="rounded-xl bg-[color:var(--ns-s-f9f1e4)] p-3 text-[11px] leading-5 text-[color:var(--ns-t-8a6a30)]">
            <span className="font-bold">Rejection note:</span> {snapshot.rejectionReason}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="ns-primary px-3 py-2 text-xs" onClick={() => void switchTo()} disabled={switchMutation.isPending || snapshot.isCurrent}>
          {switchMutation.isPending ? <Clock3 className="h-3.5 w-3.5 animate-pulse" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {snapshot.isCurrent ? "Currently active" : "Switch & restore"}
        </button>
        <button className="ns-secondary px-3 py-2 text-xs" onClick={() => setConfirmOpen(true)} disabled={deleteMutation.isPending}>
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>

      <NextStepModal
        open={confirmOpen}
        title="Delete this opportunity?"
        detail="This permanently removes the opportunity, its analysis, learning roadmap and progress, applications, rejection feedback and saved history. Your main profile and skills are NOT affected."
        onClose={() => setConfirmOpen(false)}
      >
        <div className="rounded-xl bg-[color:var(--ns-s-f9f1e4)] p-4 text-xs leading-5 text-[color:var(--ns-t-8a6a30)]">
          <span className="font-bold">{snapshot.jobTitle || "Untitled role"}</span> · {snapshot.company || "Company not stated"}
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button className="ns-primary flex-1 bg-[#b4553f]" onClick={() => void remove()} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <Trash2 className="h-4 w-4" />} Yes, delete it
          </button>
          <button className="ns-secondary flex-1" onClick={() => setConfirmOpen(false)}>
            Keep it
          </button>
        </div>
      </NextStepModal>
    </div>
  );
}

type HistorySnapshot = {
  id: number;
  opportunityId: number;
  company: string;
  jobTitle: string;
  matchPercentage: number;
  isCurrent: boolean;
  status: string;
  progress: { total: number; completed: number; remaining: number; percent: number };
  applicationStatus: string;
  rejectionReason: string;
  hasRoadmap: boolean;
  savedAt: string;
  updatedAt: string;
};

export function OpportunityHistoryView({ onChanged }: { onChanged: () => void }) {
  const historyQuery = trpc.opportunity.history.useQuery();
  const snapshots = (historyQuery.data?.snapshots ?? []) as HistorySnapshot[];
  const savedTotal = snapshots.reduce(
    (sum, snapshot) => ({
      completed: sum.completed + snapshot.progress.completed,
      total: sum.total + snapshot.progress.total,
    }),
    { completed: 0, total: 0 },
  );

  return (
    <>
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="ns-eyebrow">Saved data</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-0.055em] md:text-4xl">Opportunity history</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--ns-t-7b8b91)]">
            Every opportunity you analyze keeps its own job details, match score, skill gaps, learning roadmap, task progress, applications
            and rejection feedback. Switch back at any time — your main profile is shared and is never overwritten.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-[color:var(--ns-s-e8f2ee)] px-4 py-2.5 text-xs font-bold text-[color:var(--ns-t-3e8e79)]">
          <History className="h-4 w-4" />
          {snapshots.length} saved opportunit{snapshots.length === 1 ? "y" : "ies"} · {savedTotal.completed}/{savedTotal.total} tasks complete
        </div>
      </div>

      {historyQuery.isPending ? (
        <div className="ns-card flex items-center gap-3 px-6 py-5 text-sm font-semibold text-[color:var(--ns-t-5c727a)]">
          <Clock3 className="h-4 w-4 animate-pulse" /> Loading your saved opportunities…
        </div>
      ) : snapshots.length === 0 ? (
        <div className="ns-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ns-s-e9f3f0)] text-[color:var(--ns-t-0f7582)]">
            <BookOpen className="h-6 w-6" />
          </div>
          <h3 className="font-display text-lg font-bold text-[color:var(--ns-t-173144)]">No saved opportunities yet</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[color:var(--ns-t-74858d)]">
            Analyze a new opportunity and the previous one is archived here automatically with its full roadmap and progress.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {snapshots.map(snapshot => (
            <HistoryCard key={snapshot.id} snapshot={snapshot} onChanged={onChanged} />
          ))}
        </div>
      )}

      <div className="ns-card mt-5 flex flex-col gap-4 bg-[var(--ns-t-173144)] p-6 text-white md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--ns-t-9ed2c4)]">How this stays consistent</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--ns-t-c4d5d3)]">
            Profile → Opportunities → Skill gaps → Roadmap → Task progress → Applications → Feedback → Saved history → Overview all read from
            the same SQLite records, so a change in one place updates every dependent view.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm font-bold text-[color:var(--ns-t-83d0bc)]">
          <CheckCircle2 className="h-4 w-4" /> Single source of truth
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Application tracker — after interview                            */
/* ------------------------------------------------------------------ */

export function AfterInterviewPanel({
  applicationId,
  company,
  position,
  rejectionReason,
}: {
  applicationId: string;
  company: string;
  position: string;
  rejectionReason?: string;
}) {
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<null | "rejection" | "selection">(null);
  const [reason, setReason] = useState("");

  const resolveMutation = trpc.application.resolveAfterInterview.useMutation();
  const [outcomeMessage, setOutcomeMessage] = useState<null | { mode: string; message: string; nextStep: string }>(null);

  const submit = async (outcome: "rejected" | "selected", includeReason: boolean) => {
    try {
      const result = await resolveMutation.mutateAsync({
        id: Number(applicationId),
        outcome,
        reason: includeReason ? reason : undefined,
      });
      setOutcomeMessage({ mode: result.mode, message: result.message, nextStep: result.nextStep });
      setDialog(null);
      setReason("");
      await Promise.all([
        utils.application.list.invalidate(),
        utils.insights.get.invalidate(),
        utils.notification.list.invalidate(),
        utils.opportunity.history.invalidate(),
        utils.roadmap.progress.invalidate(),
      ]);
      toast[outcome === "selected" ? "success" : "message"](outcome === "selected" ? "🎉 Selected!" : "Application closed", {
        description: result.message,
      });
    } catch (error) {
      toast.error("Could not save this outcome", { description: errorMessage(error, "Please try again.") });
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-[color:var(--ns-b-d8e7e2)] bg-[color:var(--ns-s-f4faf7)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-3f8d78)]">After interview</p>
      <p className="mt-1 text-[11px] leading-4 text-[color:var(--ns-t-67807f)]">How did it go? Record the outcome to keep your history accurate.</p>

      {outcomeMessage ? (
        <div
          className={`mt-3 rounded-xl p-3 text-[11px] leading-5 ${
            outcomeMessage.mode === "selected"
              ? "bg-[color:var(--ns-s-e9f4ef)] text-[color:var(--ns-t-2f6d5c)]"
              : "bg-[color:var(--ns-s-f7f2e6)] text-[color:var(--ns-t-8a6a30)]"
          }`}
        >
          <p className="flex items-center gap-2 font-bold">
            {outcomeMessage.mode === "selected" ? <Trophy className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {outcomeMessage.message}
          </p>
          <p className="mt-1">{outcomeMessage.nextStep}</p>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button className="ns-secondary flex-1 px-2 py-2 text-[11px]" onClick={() => setDialog("rejection")}>
            Rejection
          </button>
          <button
            className="ns-primary flex-1 px-2 py-2 text-[11px]"
            onClick={() => setDialog("selection")}
          >
            <Trophy className="h-3.5 w-3.5" /> Selection
          </button>
        </div>
      )}

      {rejectionReason && (
        <p className="mt-2 text-[10px] leading-4 text-[color:var(--ns-t-8a6a30)]">
          <span className="font-bold">Reason recorded:</span> {rejectionReason}
        </p>
      )}

      <NextStepModal
        open={dialog === "rejection"}
        title="Add a rejection reason?"
        detail={`Recording what happened with ${position || "this role"}${company ? ` at ${company}` : ""} helps NextStep prioritise your roadmap. This is optional — you can skip it.`}
        onClose={() => setDialog(null)}
      >
        <label className="block">
          <span className="ns-label">Rejection reason (optional)</span>
          <textarea
            className="ns-input mt-2 min-h-[120px] resize-y"
            placeholder="Example: The panel said they wanted stronger SQL and data modelling experience."
            value={reason}
            onChange={event => setReason(event.target.value)}
          />
        </label>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            className="ns-primary flex-1"
            onClick={() => void submit("rejected", true)}
            disabled={resolveMutation.isPending || reason.trim().length === 0}
          >
            {resolveMutation.isPending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />} Add rejection reason
          </button>
          <button className="ns-secondary flex-1" onClick={() => void submit("rejected", false)} disabled={resolveMutation.isPending}>
            Skip
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-[color:var(--ns-t-84949a)]">
          Your main profile is never modified with unsupported information — the reason is stored only as feedback for this opportunity.
        </p>
      </NextStepModal>

      <NextStepModal
        open={dialog === "selection"}
        title="Congratulations — record your selection?"
        detail={`Mark ${position || "this role"}${company ? ` at ${company}` : ""} as Selected. A success notification will be added and the win is saved in your opportunity history.`}
        onClose={() => setDialog(null)}
      >
        <div className="mt-1 flex items-center gap-3 rounded-xl bg-[color:var(--ns-s-e9f4ef)] p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--ns-s-ffffff)] text-[color:var(--ns-t-2e917b)]">
            <Trophy className="h-5 w-5" />
          </div>
          <p className="text-xs leading-5 text-[color:var(--ns-t-2f6d5c)]">
            Nice work. This outcome is stored with the opportunity, not in your profile.
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button className="ns-primary flex-1" onClick={() => void submit("selected", false)} disabled={resolveMutation.isPending}>
            {resolveMutation.isPending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />} Yes, I was selected
          </button>
          <button className="ns-secondary flex-1" onClick={() => setDialog(null)}>
            Not yet
          </button>
        </div>
      </NextStepModal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 5. Delete opportunity (with confirmation)                           */
/* ------------------------------------------------------------------ */

export function OpportunityDeleteButton({
  opportunityId,
  jobTitle,
  company,
  onDeleted,
}: {
  opportunityId: string;
  jobTitle: string;
  company: string;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const deleteMutation = trpc.opportunity.delete.useMutation();

  const remove = async () => {
    try {
      await deleteMutation.mutateAsync({ id: Number(opportunityId) });
      setOpen(false);
      await Promise.all([
        utils.opportunity.list.invalidate(),
        utils.opportunity.current.invalidate(),
        utils.opportunity.latestAnalysis.invalidate(),
        utils.opportunity.history.invalidate(),
        utils.roadmap.get.invalidate(),
        utils.roadmap.progress.invalidate(),
        utils.roadmap.itemResources.invalidate(),
        utils.application.list.invalidate(),
        utils.insights.get.invalidate(),
        utils.notification.list.invalidate(),
      ]);
      onDeleted?.();
      toast.success("Opportunity deleted", {
        description: "Its roadmap, analysis, application and saved history were removed. Your profile and skills were kept.",
      });
    } catch (error) {
      toast.error("Could not delete this opportunity", { description: errorMessage(error, "Please try again.") });
    }
  };

  return (
    <>
      <button className="ns-ghost px-2 py-1 text-xs" onClick={() => setOpen(true)} aria-label={`Delete ${jobTitle}`}>
        <Trash2 className="h-3.5 w-3.5 text-[color:var(--ns-t-c66b57)]" />
      </button>
      <NextStepModal
        open={open}
        title="Delete this opportunity?"
        detail="This permanently removes its analysis, roadmap and progress, application, rejection feedback and saved history."
        onClose={() => setOpen(false)}
      >
        <div className="rounded-xl bg-[color:var(--ns-s-f9f1e4)] p-4 text-xs leading-5 text-[color:var(--ns-t-8a6a30)]">
          <p className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-4 w-4" /> {jobTitle || "Untitled role"}
          </p>
          <p className="mt-1">{company || "Company not stated"} — your main profile and skills are not affected.</p>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button className="ns-primary flex-1 bg-[#b4553f]" onClick={() => void remove()} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? <Clock3 className="h-4 w-4 animate-pulse" /> : <Trash2 className="h-4 w-4" />} Delete opportunity
          </button>
          <button className="ns-secondary flex-1" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </NextStepModal>
    </>
  );
}

/** `Target` is re-declared locally so the panel stays self-contained. */
function Target(props: React.ComponentProps<typeof Youtube>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
