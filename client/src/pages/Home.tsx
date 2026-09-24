import { trpc } from "@/lib/trpc";
import {
  AfterInterviewPanel,
  OpportunityDeleteButton,
  OpportunityHistoryView,
  RoadmapProgressPanel,
  RoadmapStepResources,
} from "@/components/nextstep/NextStepDynamic";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  CircleAlert,
  Clock3,
  Compass,
  FileCheck2,
  FileText,
  Filter,
  FolderKanban,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  Link2,
  ListChecks,
  LockKeyhole,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Radar,
  Rocket,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
  Zap,
  History,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

type Section = "overview" | "profile" | "resume" | "opportunities" | "skills" | "roadmap" | "applications" | "feedback" | "progress" | "history" | "settings";
type Status = "Saved" | "Applied" | "Assessment" | "Interview" | "Rejected" | "Selected";

type Opportunity = {
  id: string;
  title: string;
  company: string;
  location: string;
  stipend: string;
  match: number;
  deadline: string;
  accent: string;
  description: string;
  tags: string[];
};

type AnalysisResult = {
  matchScore: number;
  matchedSkills: string[];
  partialSkills: string[];
  missingSkills: string[];
  eligibility: Array<{ label: string; status: "met" | "gap" | "unknown"; detail: string }>;
  skillRows: Array<{ skill: string; status: "Matched" | "Partial" | "Gap"; note: string }>;
  explanation?: string;
  engine?: string;
  factors: Array<{ label: string; value: string; score: number }>;
  verification: { status: string; indicators: Array<{ label: string; status: "good" | "watch" | "unknown"; detail: string }> };
};

type AppState = {
  profile: {
    name: string;
    email: string;
    phone: string;
    location: string;
    workLocation: string;
    objective: string;
    college: string;
    degree: string;
    branch: string;
    graduationYear: string;
    cgpa: string;
    skills: string[];
  };
  applications: Array<{ id: string; company: string; title: string; date: string; match: number; status: Status; next: string; tailoredResume?: string; tailoredChanges?: Array<{ area: string; change: string }>; opportunityId?: number | null; rejectionReason?: string }>;
  roadmapDone: string[];
  analyzedCount: number;
  resumeUploaded: boolean;
  improvedResume: boolean;
  feedbackCount: number;
};

const fallbackRoadmap = [
  { id: "react", title: "React Fundamentals", duration: "7 days", why: "Close your highest-frequency opportunity gap.", resource: "React Learn — official tutorial", task: "Build a small component library with props and state." },
  { id: "project", title: "Build a React Project", duration: "10 days", why: "Turn learning into credible resume evidence.", resource: "Frontend Mentor starter brief", task: "Ship a responsive dashboard with a public README." },
  { id: "api", title: "Learn REST API Integration", duration: "5 days", why: "Connect interfaces to real data and workflows.", resource: "MDN — Fetch API", task: "Integrate a public API with loading and error states." },
  { id: "fullstack", title: "Build Full-Stack Project", duration: "14 days", why: "Show end-to-end product thinking.", resource: "NextStep project brief", task: "Add persistence, validation, and a deployment note." },
  { id: "resume", title: "Update Resume", duration: "1 day", why: "Capture the proof you have earned.", resource: "NextStep Resume Review", task: "Rewrite two bullets with outcomes and links." },
];

const navGroups = [
  { label: "Workspace", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "profile", label: "My Profile", icon: UserRound }, { id: "resume", label: "Resume", icon: FileText }] },
  { label: "Career tools", items: [{ id: "opportunities", label: "Opportunities", icon: Compass }, { id: "skills", label: "Skill Analysis", icon: Radar }, { id: "roadmap", label: "Learning Roadmap", icon: BookOpen }, { id: "applications", label: "Applications", icon: FolderKanban }, { id: "history", label: "Saved Data", icon: History }] },
  { label: "Feedback loop", items: [{ id: "feedback", label: "Feedback", icon: MessageSquareIcon }, { id: "progress", label: "Career Progress", icon: TrendingUp }, { id: "settings", label: "Settings", icon: Settings2 }] },
];

function MessageSquareIcon(props: React.ComponentProps<typeof Send>) { return <Send {...props} />; }

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch { return initial; }
  });
  useEffect(() => { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* demo mode can continue without storage */ } }, [key, value]);
  return [value, setValue] as const;
}

function Logo({ dark = false }: { dark?: boolean }) {
  return <div className="flex items-center gap-2.5"><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${dark ? "bg-[color:var(--ns-s-d6efe7)] text-[color:var(--ns-t-103f4e)]" : "bg-[color:var(--ns-s-0f6680)] text-white"}`}><ArrowDownRight className="h-5 w-5" strokeWidth={2.6} /></div><span className={`font-display text-[18px] font-extrabold tracking-[-0.04em] ${dark ? "text-white" : "text-[color:var(--ns-t-173144)]"}`}>NextStep<span className="text-[color:var(--ns-t-6ec5b6)]">.</span></span></div>;
}

function ScoreRing({ value, size = "large" }: { value: number; size?: "small" | "large" }) {
  const diameter = size === "large" ? "h-36 w-36" : "h-16 w-16";
  return <div className={`${diameter} relative flex shrink-0 items-center justify-center rounded-full`} style={{ background: `conic-gradient(var(--ns-t-0f8b87) ${value * 3.6}deg, var(--ns-s-e6efec) 0deg)` }}><div className={`${size === "large" ? "h-[116px] w-[116px]" : "h-12 w-12"} flex flex-col items-center justify-center rounded-full bg-[color:var(--ns-s-ffffff)]`}><span className={`${size === "large" ? "text-3xl" : "text-base"} font-display font-extrabold text-[color:var(--ns-t-173144)]`}>{value}%</span>{size === "large" && <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[color:var(--ns-t-84949b)]">match</span>}</div></div>;
}

function ProgressBar({ value, color = "var(--ns-t-0f8b87)" }: { value: number; color?: string }) { return <div className="ns-progress"><span style={{ width: `${value}%`, background: color }} /></div>; }

function EmptyState({ icon: Icon, title, detail, action }: { icon: React.ElementType; title: string; detail: string; action?: () => void }) {
  return <div className="ns-card flex flex-col items-center justify-center px-6 py-16 text-center"><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ns-s-e9f3f0)] text-[color:var(--ns-t-0f7582)]"><Icon className="h-6 w-6" /></div><h3 className="font-display text-lg font-bold text-[color:var(--ns-t-173144)]">{title}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[color:var(--ns-t-74858d)]">{detail}</p>{action && <button className="ns-primary mt-5" onClick={action}>Analyze Opportunity <ArrowRight className="h-4 w-4" /></button>}</div>;
}

/** Small helpers that adapt backend rows to the existing (unchanged) view props. */
const STATUS_MAP: Record<string, Status> = {
  Saved: "Saved",
  Applied: "Applied",
  Assessment: "Assessment",
  Interview: "Interview",
  Rejected: "Rejected",
  Selected: "Selected",
};

function shortDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (message && message.length < 220 && !/^\s*\[/.test(message)) return message;
  }
  return fallback;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [location, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [selectedJob, setSelectedJob] = useState<Opportunity | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [profileSkillInput, setProfileSkillInput] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState("Skills");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackAnalysis, setFeedbackAnalysis] = useState<{ area: string; insight: string; action: string; confidence: string } | null>(null);
  const [settings, setSettings] = usePersistentState("nextstep-ui-settings", { weeklyDigest: true, deadlineAlerts: true, profileVisibility: false });
  const [relevantOnly, setRelevantOnly] = useState(false);
  const [loadingLabel, setLoadingLabelRaw] = useState("");
  const busyRef = useRef(false);
  /**
   * One-action-at-a-time guard for the AI/back-end flows below: an action
   * claims the workspace by setting a loading label and releases it when the
   * label is cleared (""). Every AI handler checks `busyRef.current` at entry,
   * so a double-click can never fire two Gemini (or two create) requests —
   * the buttons are disabled during runs too, this covers the render race.
   */
  const setLoadingLabel = (label: string): void => {
    setLoadingLabelRaw(label);
    if (!label) busyRef.current = false;
  };
  const [draft, setDraft] = useState<AppState["profile"] | null>(null);
  const [extracted, setExtracted] = useState<{
    name: string; email: string; phone: string; location: string; degree: string; branch: string;
    graduationYear: string; cgpa: string; careerObjective: string; skills: string[];
    projects: Array<{ title: string; description?: string; technologies?: string[]; link?: string }>;
    experience: Array<{ company?: string; role?: string; duration?: string; description?: string }>;
    certifications: Array<{ name: string; issuer?: string; year?: string }>;
    notFound: string[];
  } | null>(null);

  /* ---------------- backend state (SQLite is the source of truth) ---------------- */
  const modeQuery = trpc.service.mode.useQuery();
  const profileQuery = trpc.profile.get.useQuery();
  const resumeQuery = trpc.resume.latest.useQuery();
  const opportunitiesQuery = trpc.opportunity.list.useQuery();
  const roadmapQuery = trpc.roadmap.get.useQuery();
  const applicationsQuery = trpc.application.list.useQuery();
  const latestAnalysisQuery = trpc.opportunity.latestAnalysis.useQuery();
  const insightsQuery = trpc.insights.get.useQuery();
  const notificationsQuery = trpc.notification.list.useQuery();
  const markNotificationReadMutation = trpc.notification.markRead.useMutation({ onSuccess: () => { utils.notification.list.invalidate(); } });
  const markAllNotificationsReadMutation = trpc.notification.markAllRead.useMutation({ onSuccess: () => { utils.notification.list.invalidate(); } });
  const [deletingNotificationId, setDeletingNotificationId] = useState<number | null>(null);
  // Optimistic delete: the row — and, for unread rows, the bell badge —
  // updates the moment the trash icon is clicked; a failure rolls the change
  // back and shows a toast instead of failing silently.
  const deleteNotificationMutation = trpc.notification.delete.useMutation({
    onMutate: async variables => {
      const previous = utils.notification.list.getData();
      utils.notification.list.setData(undefined, current => {
        if (!current) return current;
        const removed = current.notifications.find(item => item.id === variables.id);
        return {
          notifications: current.notifications.filter(item => item.id !== variables.id),
          unreadCount: Math.max(0, current.unreadCount - (removed && !removed.read ? 1 : 0)),
        };
      });
      return { previous };
    },
    onSuccess: () => {
      utils.notification.list.invalidate();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.notification.list.setData(undefined, context.previous);
      toast.error("Could not delete the notification", { description: errorMessage(error, "Please try again.") });
    },
    onSettled: () => {
      setDeletingNotificationId(null);
    },
  });

  const deleteNotification = (n: NotificationItem) => {
    if (deleteNotificationMutation.isPending) return;
    setDeletingNotificationId(n.id);
    deleteNotificationMutation.mutate({ id: n.id });
  };

  const updateProfileMutation = trpc.profile.update.useMutation();
  const createProfileMutation = trpc.profile.create.useMutation();
  const resetProfileMutation = trpc.profile.reset.useMutation();
  const uploadResumeMutation = trpc.resume.upload.useMutation();
  const analyzeResumeMutation = trpc.resume.analyze.useMutation();
  const saveExtractedMutation = trpc.resume.saveExtractedProfile.useMutation();
  const improveResumeMutation = trpc.resume.improve.useMutation();
  const analyzeTextMutation = trpc.opportunity.analyzeText.useMutation();
  const analyzeImageMutation = trpc.opportunity.analyzeImage.useMutation();
  const generateRoadmapMutation = trpc.roadmap.generate.useMutation();
  const updateProgressMutation = trpc.roadmap.updateProgress.useMutation();
  const createApplicationMutation = trpc.application.create.useMutation();
  const updateStatusMutation = trpc.application.updateStatus.useMutation();
  const prepareApplicationMutation = trpc.application.prepare.useMutation();
  const createFeedbackMutation = trpc.feedback.create.useMutation();

  const profile = profileQuery.data ?? null;
  const resume = resumeQuery.data ?? null;
  const roadmap = roadmapQuery.data ?? null;
  const mode = modeQuery.data?.mode ?? "demo";
  const notifications = notificationsQuery.data?.notifications ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  useEffect(() => {
    if (profile && !draft) {
      setDraft({
        name: profile.name ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        location: profile.location ?? "",
        workLocation: profile.preferredWorkLocation ?? "Remote",
        objective: profile.careerObjective ?? "",
        college: profile.college ?? "",
        degree: profile.degree ?? "",
        branch: profile.branch ?? "",
        graduationYear: profile.graduationYear ?? "",
        cgpa: profile.cgpa ?? "",
        skills: profile.skills ?? [],
      });
    }
  }, [profile, draft]);

  if (profileQuery.isPending) {
    return <div className="flex min-h-screen items-center justify-center bg-[color:var(--ns-s-f7f8f6)]"><div className="ns-card flex items-center gap-3 px-6 py-5 text-sm font-semibold text-[color:var(--ns-t-5c727a)]"><Clock3 className="h-4 w-4 animate-pulse" /> Loading your workspace…</div></div>;
  }

  const state: AppState = {
    profile: draft ?? { name: "", email: "", phone: "", location: "", workLocation: "Remote", objective: "", college: "", degree: "", branch: "", graduationYear: "", cgpa: "", skills: [] },
    applications: (applicationsQuery.data ?? []).map(app => ({
      id: String(app.id),
      company: app.company,
      title: app.position,
      date: shortDate(app.dateApplied ?? app.createdAt),
      match: app.matchPercentage,
      status: STATUS_MAP[app.status] ?? "Saved",
      next: app.notes || (app.status === "Interview" ? "Prepare project walkthrough" : app.status === "Selected" ? "Celebrate and onboard" : "Keep your profile fresh"),
      tailoredResume: app.tailoredResume,
      tailoredChanges: app.tailoredChanges,
      opportunityId: app.opportunityId,
      rejectionReason: app.rejectionReason,
    })),
    roadmapDone: (roadmap?.items ?? []).filter(item => item.completed).map(item => String(item.id)),
    analyzedCount: insightsQuery.data?.stats.opportunitiesAnalyzed ?? 0,
    resumeUploaded: Boolean(resume),
    improvedResume: Boolean(resume?.improvedResume),
    feedbackCount: insightsQuery.data?.stats.feedbackNotes ?? 0,
  };

  const uiRoadmap = roadmap
    ? roadmap.items.map(item => ({ id: String(item.id), title: item.title, skill: item.skill, duration: item.duration, why: item.description, resource: (item.resources ?? []).join(" · ") || "NextStep roadmap guidance", task: item.practicalTask }))
    : fallbackRoadmap;

  const uiJobs: Opportunity[] = (opportunitiesQuery.data ?? []).map((job, index) => ({
    id: String(job.id),
    title: job.jobTitle || "Opportunity",
    company: job.company || "Company not stated",
    location: job.location || "Not specified",
    stipend: job.compensation || "Not stated",
    match: latestAnalysisQuery.data && latestAnalysisQuery.data.opportunityId === job.id ? latestAnalysisQuery.data.matchScore : 0,
    deadline: job.isSample ? "Sample" : "Analyzed",
    accent: ["var(--ns-s-e2f2ef)", "var(--ns-s-e8eff8)", "var(--ns-s-f9eee1)", "var(--ns-s-eeeafa)"][index % 4],
    description: job.description,
    tags: job.requiredSkills.slice(0, 3),
  }));

  const uiGaps = (latestAnalysisQuery.data?.skillGaps ?? []).map(gap => ({
    skill: gap.skill,
    level: gap.currentLevel,
    required: gap.requiredLevel,
    importance: gap.importance,
    gap: gap.gap,
  }));

  const profileCompletion = Math.min(100, Math.round(
    (state.profile.name ? 15 : 0) + (state.profile.email ? 10 : 0) + (state.profile.degree ? 15 : 0) +
    (state.profile.cgpa ? 10 : 0) + (state.profile.objective ? 15 : 0) + Math.min(35, state.profile.skills.length * 3),
  ));
  const currentUser = (state.profile.name || "there").split(" ")[0];

  const goTo = (next: Section | "landing") => {
    setMobileNavOpen(false);
    setLocation(next === "landing" ? "/" : `/app/${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const section = (location.startsWith("/app/") ? location.split("/")[2] : "landing") as Section | "landing";

  const updateProfile = (field: keyof AppState["profile"], value: string) =>
    setDraft(prev => ({ ...(prev ?? state.profile), [field]: value }));

  const saveProfile = async () => {
    const current = draft ?? state.profile;
    setLoadingLabel("Saving your profile...");
    try {
      const payload = {
        name: current.name, email: current.email, phone: current.phone, location: current.location,
        preferredWorkLocation: current.workLocation, college: current.college, degree: current.degree,
        branch: current.branch, graduationYear: current.graduationYear, cgpa: current.cgpa,
        careerObjective: current.objective, skills: current.skills,
      };
      if (profile) await updateProfileMutation.mutateAsync(payload);
      else await createProfileMutation.mutateAsync(payload);
      await Promise.all([utils.profile.get.invalidate(), utils.resume.latest.invalidate()]);
      toast.success("Profile saved", { description: "Your career data is stored locally in SQLite." });
    } catch (error) {
      toast.error("Could not save your profile", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  /* ------------------------------ resume flow ------------------------------ */
  const handleResumeUpload = async (file?: File) => {
    if (!file) return;
    if (busyRef.current) return;
    setNotice("");
    setLoadingLabel("Extracting profile...");
    setExtracted(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
      const record = await uploadResumeMutation.mutateAsync({
        fileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, base64,
      });
      setLoadingLabel("Analyzing resume...");
      const result = await analyzeResumeMutation.mutateAsync({ resumeId: record.id });
      setExtracted(result.extractedProfile);
      await Promise.all([utils.resume.latest.invalidate(), utils.service.mode.invalidate(), utils.notification.list.invalidate()]);
      toast.success("Resume processed", { description: "Review the extracted details before saving them to your profile." });
    } catch (error) {
      setNotice(errorMessage(error, "The uploaded file could not be processed. Please upload a PDF or DOCX file."));
      toast.error("The uploaded file could not be processed", { description: "Please upload a PDF, DOCX, JPG, JPEG, or PNG." });
    } finally {
      setLoadingLabel("");
    }
  };

  const handleSaveExtractedProfile = async () => {
    setLoadingLabel("Saving profile...");
    try {
      const updated = await saveExtractedMutation.mutateAsync({});
      setDraft(null);
      await utils.profile.get.invalidate();
      setExtracted(null);
      toast.success("Profile updated", { description: "Extracted details were saved to your profile." });
      if (updated) goTo("profile");
    } catch (error) {
      toast.error("Could not save the extracted profile", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  const handleImproveResume = async () => {
    if (busyRef.current) return;
    setLoadingLabel("Improving resume...");
    try {
      const result = await improveResumeMutation.mutateAsync({});
      await utils.resume.latest.invalidate();
      toast.success("Resume improvements ready", { description: "Only wording, structure and relevance were changed — no facts were added." });
      const improved = result.resume?.improvedResume;
      if (improved) {
        downloadTextFile("nextstep-improved-resume.txt", improved);
      }
    } catch (error) {
      toast.error("Unable to improve this resume right now", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  const handleDownloadResume = () => {
    const content = resume?.improvedResume || resume?.extractedText;
    if (!content) {
      toast.error("Nothing to download yet", { description: "Upload a resume first." });
      return;
    }
    downloadTextFile(resume?.improvedResume ? "nextstep-improved-resume.txt" : "nextstep-resume.txt", content);
  };

  /* --------------------------- opportunity analysis --------------------------- */
  const applyAnalysis = (result: { opportunity: { id: number; source: string; company: string; jobTitle: string; location: string; compensation: string; description: string; requiredSkills: string[] }; analysis: AnalysisResult }) => {
    setAnalysis(result.analysis);
    setSelectedJob({
      id: String(result.opportunity.id), title: result.opportunity.jobTitle, company: result.opportunity.company,
      location: result.opportunity.location, stipend: result.opportunity.compensation,
      match: result.analysis.matchScore, deadline: "Analyzed", accent: "var(--ns-s-e2f2ef)",
      description: result.opportunity.description, tags: result.opportunity.requiredSkills.slice(0, 3),
    });
  };

  const runOpportunityAnalysis = async (text: string) => {
    if (text.trim().length < 20) {
      setNotice("Add a little more context so we can compare the opportunity fairly.");
      return;
    }
    setNotice("");
    if (busyRef.current) return;
    setLoadingLabel("Analyzing opportunity...");
    try {
      const result = await analyzeTextMutation.mutateAsync({ description: text });
      applyAnalysis(result as unknown as Parameters<typeof applyAnalysis>[0]);
      setLoadingLabel("Calculating match...");
      await Promise.all([utils.opportunity.list.invalidate(), utils.opportunity.latestAnalysis.invalidate(), utils.opportunity.current.invalidate(), utils.opportunity.history.invalidate(), utils.roadmap.get.invalidate(), utils.roadmap.progress.invalidate(), utils.roadmap.itemResources.invalidate(), utils.insights.get.invalidate(), utils.notification.list.invalidate()]);
      toast.success("Opportunity analyzed", { description: "Your match score, gaps and a fresh roadmap for this role are ready. The previous opportunity was saved to your history." });
    } catch (error) {
      const message = errorMessage(error, "Unable to analyze this opportunity. Please try again.");
      setNotice(message);
      toast.error("Unable to analyze this opportunity", { description: message });
    } finally {
      setLoadingLabel("");
    }
  };

  const handleOpportunityUpload = async (file?: File) => {
    if (!file) return;
    setNotice("");
    if (busyRef.current) return;
    setLoadingLabel("Reading the screenshot...");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
      setLoadingLabel("Extracting job requirements...");
      const result = await analyzeImageMutation.mutateAsync({
        fileName: file.name, mimeType: file.type || "image/png", fileSize: file.size, base64,
      });
      applyAnalysis(result as unknown as Parameters<typeof applyAnalysis>[0]);
      await Promise.all([utils.opportunity.list.invalidate(), utils.opportunity.latestAnalysis.invalidate(), utils.opportunity.current.invalidate(), utils.opportunity.history.invalidate(), utils.roadmap.get.invalidate(), utils.roadmap.progress.invalidate(), utils.roadmap.itemResources.invalidate(), utils.insights.get.invalidate(), utils.notification.list.invalidate()]);
      toast.success("Screenshot analyzed", { description: "Requirements were read from your image and a fresh roadmap was built. The previous opportunity was saved." });
    } catch (error) {
      const message = errorMessage(error, "Unable to analyze this opportunity. Please try again.");
      setNotice(message);
      toast.error("Unable to analyze this screenshot", { description: message });
    } finally {
      setLoadingLabel("");
    }
  };

  const buildRoadmap = async () => {
    if (busyRef.current) return;
    setLoadingLabel("Building roadmap...");
    try {
      await generateRoadmapMutation.mutateAsync({ opportunityId: latestAnalysisQuery.data?.opportunityId ?? undefined });
      await Promise.all([utils.roadmap.get.invalidate(), utils.notification.list.invalidate(), utils.profile.get.invalidate()]);
      toast.success("Roadmap ready", { description: "Your gaps are now an ordered plan." });
      goTo("roadmap");
    } catch (error) {
      toast.error("We couldn't build that roadmap", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  /* ------------------------------- applications ------------------------------- */
  const applyForJob = async (job: Opportunity) => {
    if (busyRef.current) return;
    setLoadingLabel("Preparing application...");
    try {
      await createApplicationMutation.mutateAsync({ opportunityId: Number(job.id) });
      await Promise.all([utils.application.list.invalidate(), utils.insights.get.invalidate()]);
      toast.success("Application saved", { description: `${job.title} at ${job.company} was added to your tracker.` });
      goTo("applications");
    } catch (error) {
      toast.error("Could not save that application", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  const moveApplication = async (id: string, status: Status) => {
    try {
      await updateStatusMutation.mutateAsync({ id: Number(id), status });
      await utils.application.list.invalidate();
      toast.success(`Moved to ${status}`);
    } catch (error) {
      toast.error("Could not update the status", { description: errorMessage(error, "Please try again.") });
    }
  };

  const prepareApplication = async (job: Opportunity) => {
    if (busyRef.current) return;
    setLoadingLabel("Preparing application...");
    try {
      const result = await prepareApplicationMutation.mutateAsync({ opportunityId: Number(job.id) });
      await utils.application.list.invalidate();
      toast.success("Tailored resume ready", { description: "Reordered for relevance from your existing facts only." });
      setSelectedJob(job);
      goTo("applications");
      return result;
    } catch (error) {
      toast.error("Unable to prepare this application", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  /* --------------------------------- feedback --------------------------------- */
  const handleFeedback = async () => {
    if (busyRef.current) return;
    setLoadingLabel("Analyzing feedback...");
    try {
      const rejected = (applicationsQuery.data ?? []).find(app => app.status === "Rejected");
      const result = await createFeedbackMutation.mutateAsync({
        category: feedbackCategory as "Skills",
        note: feedbackNote,
        applicationId: rejected?.id,
      });
      setFeedbackAnalysis({ area: result.area, insight: result.insight, action: result.action, confidence: result.confidence });
      await utils.insights.get.invalidate();
      toast.success("Feedback analyzed", { description: "A focused next action has been added to your loop." });
    } catch (error) {
      toast.error("Unable to analyze feedback", { description: errorMessage(error, "Please try again.") });
    } finally {
      setLoadingLabel("");
    }
  };

  const resetWorkspace = async () => {
    try {
      await resetProfileMutation.mutateAsync();
      setDraft(null);
      await utils.profile.get.invalidate();
      toast.success("Career data cleared", { description: "Profile data was removed from the local database." });
    } catch (error) {
      toast.error("Could not clear the stored data", { description: errorMessage(error, "Please try again.") });
    }
  };

  if (section === "landing") return <LandingPage onStart={() => goTo("overview")} />;

  return <div className="min-h-screen bg-[color:var(--ns-s-f7f8f6)] text-[color:var(--ns-t-173144)]">
    <div className="flex min-h-screen">
      <aside className={`${mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r border-[color:var(--ns-b-e1ebe8)] bg-[color:var(--ns-s-fbfcfa)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:shrink-0`}>
        <div className="flex h-[78px] items-center justify-between px-6"><Logo /><button className="ns-ghost lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
        <div className="px-4 pb-6"><div className="rounded-2xl bg-[#173144] p-4 text-white"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--ns-t-a3d6ca)]">Your next move</p><p className="mt-2 font-display text-lg font-bold leading-tight">Build proof,<br />not pressure.</p></div><Sparkles className="h-5 w-5 text-[color:var(--ns-t-76cbb8)]" /></div><div className="mt-4 h-1.5 rounded-full bg-white/15"><div className="h-full rounded-full bg-[color:var(--ns-s-72c8b6)]" style={{ width: `${profileCompletion}%` }} /></div><p className="mt-2 text-xs text-[color:var(--ns-t-b9cfce)]">{profileCompletion}% of your profile is ready</p></div></div>
        <nav className="flex-1 overflow-y-auto px-4 pb-4">{navGroups.map(group => <div key={group.label} className="mb-6"><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--ns-t-9aa9ad)]">{group.label}</p>{group.items.map(item => { const Icon = item.icon; return <button key={item.id} className={`ns-nav mb-1 w-full ${section === item.id ? "ns-nav-active" : ""}`} onClick={() => goTo(item.id as Section)}><Icon className="h-[17px] w-[17px]" /><span>{item.label}</span>{item.id === "opportunities" && uiJobs.length > 0 && <span className="ml-auto rounded-full bg-[color:var(--ns-s-d7ede8)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--ns-t-0f7582)]">{uiJobs.length}</span>}</button>; })}</div>)}</nav>
        <div className="border-t border-[color:var(--ns-b-e1ebe8)] p-4"><button onClick={() => goTo("settings")} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-[color:var(--ns-s-eef4f2)]"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--ns-s-d6e9e5)] text-sm font-bold text-[color:var(--ns-t-0f6680)]">{(state.profile.name || "NS").slice(0, 1)}{(state.profile.name.split(" ")[1] ?? "").slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{state.profile.name || "Your profile"}</p><p className="truncate text-xs text-[color:var(--ns-t-85959a)]">{mode === "real" ? "Real AI mode" : "Demo mode"}</p></div><MoreHorizontal className="h-4 w-4 text-[color:var(--ns-t-9caab0)]" /></button></div>
      </aside>
      {mobileNavOpen && <button aria-label="Close sidebar" className="fixed inset-0 z-40 bg-[#173144]/25 lg:hidden" onClick={() => setMobileNavOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[78px] items-center justify-between border-b border-[var(--ns-s-e1ebe8)]/90 bg-[var(--ns-s-f7f8f6)]/95 px-5 backdrop-blur md:px-8"><div className="flex items-center gap-3"><button className="ns-ghost lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button><div className="lg:hidden"><Logo /></div><div className="hidden items-center gap-2 text-sm text-[color:var(--ns-t-8a999e)] lg:flex"><span>Workspace</span><ChevronDown className="h-3.5 w-3.5" /><span className="font-semibold capitalize text-[color:var(--ns-t-2e4b57)]">{section.replace("-", " ")}</span></div></div><div className="flex items-center gap-2 md:gap-5">{loadingLabel && <div className="hidden items-center gap-2 rounded-full bg-[color:var(--ns-s-e8f2ee)] px-3 py-1.5 text-xs font-bold text-[color:var(--ns-t-26796d)] sm:flex"><Clock3 className="h-3.5 w-3.5 animate-pulse" />{loadingLabel}</div>}<span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] md:inline-flex ${mode === "real" ? "bg-[color:var(--ns-s-e0f1ea)] text-[color:var(--ns-t-26836d)]" : "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]"}`}>{mode === "real" ? "Real AI" : "Demo"}</span><button className="ns-ghost" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => toggleTheme?.()}>{theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</button><Popover open={notifOpen} onOpenChange={setNotifOpen}><PopoverTrigger asChild><button className="ns-ghost relative" aria-label="Notifications"><Bell className="h-[19px] w-[19px]" />{unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--ns-s-e27d62)] px-1 text-[9px] font-bold text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}</button></PopoverTrigger><PopoverContent align="end" className="w-[380px] p-0"><NotificationsPanel notifications={notifications} unreadCount={unreadCount} onOpen={(n) => { if (!n.read) markNotificationReadMutation.mutate({ id: n.id }); if (n.link) { setNotifOpen(false); goTo(n.link.replace("/app/", "") as Section); } }} onMarkAllRead={() => markAllNotificationsReadMutation.mutate()} onDelete={deleteNotification} deletingId={deletingNotificationId} /></PopoverContent></Popover><div className="hidden h-6 w-px bg-[color:var(--ns-s-dbe5e2)] md:block" /><button className="flex cursor-pointer items-center gap-2.5" aria-label="Open your profile" onClick={() => goTo("profile")}><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--ns-s-d6e9e5)] text-xs font-bold text-[color:var(--ns-t-0f6680)]">{(state.profile.name || "NS").slice(0, 1)}{(state.profile.name.split(" ")[1] ?? "").slice(0, 1)}</div><span className="hidden text-sm font-semibold text-[color:var(--ns-t-45606a)] sm:block">{state.profile.name || "Your profile"}</span><ChevronDown className="hidden h-4 w-4 text-[color:var(--ns-t-92a0a5)] sm:block" /></button></div></header>
        <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-8 lg:px-10">
          {section === "overview" && <Overview state={state} currentUser={currentUser} profileCompletion={profileCompletion} onGo={goTo} insights={insightsQuery.data?.insights ?? []} stats={insightsQuery.data?.stats} />}
          {section === "profile" && <ProfileView state={state} updateProfile={updateProfile} profileSkillInput={profileSkillInput} setProfileSkillInput={setProfileSkillInput} onSave={saveProfile} isSaving={Boolean(loadingLabel)} mode={mode} addSkill={() => { if (profileSkillInput.trim()) { setDraft(prev => { const base = prev ?? state.profile; return { ...base, skills: [...base.skills, profileSkillInput.trim()] }; }); setProfileSkillInput(""); } }} removeSkill={(skill) => setDraft(prev => { const base = prev ?? state.profile; return { ...base, skills: base.skills.filter(item => item !== skill) }; })} />}
          {section === "resume" && <ResumeView state={state} review={resume?.analysis ? { score: resume.analysis.score, breakdown: resume.analysis.breakdown, suggestions: resume.analysis.improvements, improvedSummary: resume.analysis.improvedSummary } : undefined} onUpload={handleResumeUpload} onImprove={handleImproveResume} onDownload={handleDownloadResume} onSaveProfile={handleSaveExtractedProfile} extracted={extracted ?? resume?.extractedProfile ?? null} isBusy={Boolean(loadingLabel)} loadingLabel={loadingLabel} analysis={resume?.analysis ?? null} improvedResume={resume?.improvedResume ?? ""} changes={resume?.improvedChanges ?? []} />}
          {section === "opportunities" && <OpportunitiesView jobs={uiJobs} analysisEngine={latestAnalysisQuery.data?.engine} description={description} setDescription={setDescription} onAnalyze={() => runOpportunityAnalysis(description)} isAnalyzing={Boolean(loadingLabel)} notice={notice} analysis={analysis ?? (latestAnalysisQuery.data as unknown as AnalysisResult | null)} onSelectJob={(job) => { setSelectedJob(job); setDescription(job.description); }} onApply={applyForJob} onPrepare={prepareApplication} onRoadmap={buildRoadmap} selectedJob={selectedJob} relevantOnly={relevantOnly} setRelevantOnly={setRelevantOnly} onUpload={handleOpportunityUpload} />}
          {section === "skills" && <SkillsView gaps={uiGaps} onRoadmap={buildRoadmap} hasAnalysis={Boolean(latestAnalysisQuery.data)} />}
          {section === "roadmap" && <RoadmapView roadmap={uiRoadmap} done={state.roadmapDone} onToggle={(id) => { void updateProgressMutation.mutateAsync({ itemId: Number(id), completed: !state.roadmapDone.includes(id) }).then(() => { utils.roadmap.get.invalidate(); utils.notification.list.invalidate(); utils.profile.get.invalidate(); }); }} onGenerate={buildRoadmap} hasRoadmap={Boolean(roadmap)} />}
          {section === "applications" && <ApplicationsView applications={state.applications} onMove={moveApplication} onExplore={() => goTo("opportunities")} />}
          {section === "feedback" && <FeedbackView category={feedbackCategory} setCategory={setFeedbackCategory} note={feedbackNote} setNote={setFeedbackNote} analysis={feedbackAnalysis} onAnalyze={handleFeedback} isAnalyzing={Boolean(loadingLabel)} />}
          {section === "progress" && <ProgressView state={state} insights={insightsQuery.data?.insights ?? []} stats={insightsQuery.data?.stats} />}
          {section === "history" && <OpportunityHistoryView onChanged={() => { utils.opportunity.history.invalidate(); utils.opportunity.list.invalidate(); utils.opportunity.current.invalidate(); utils.opportunity.latestAnalysis.invalidate(); utils.roadmap.get.invalidate(); utils.roadmap.progress.invalidate(); utils.roadmap.itemResources.invalidate(); utils.insights.get.invalidate(); utils.application.list.invalidate(); utils.notification.list.invalidate(); }} />}
          {section === "settings" && <SettingsView settings={settings} setSettings={setSettings} onReset={resetWorkspace} mode={mode} model={modeQuery.data?.model ?? ""} theme={theme} onToggleTheme={() => toggleTheme?.()} />}
        </main>
      </div>
    </div>
  </div>;
}

function LandingPage({ onStart }: { onStart: () => void }) {
  return <div className="min-h-screen overflow-hidden bg-[color:var(--ns-s-f7f8f6)] text-[color:var(--ns-t-173144)]"><header className="mx-auto flex max-w-[1280px] items-center justify-between px-5 py-6 md:px-8"><Logo /><nav className="hidden items-center gap-8 text-sm font-semibold text-[color:var(--ns-t-60737c)] md:flex"><a href="#how-it-works" className="hover:text-[color:var(--ns-t-0f6680)]">How it works</a><a href="#for-students" className="hover:text-[color:var(--ns-t-0f6680)]">For students</a><a href="#trust" className="hover:text-[color:var(--ns-t-0f6680)]">Our approach</a></nav><div className="flex items-center gap-2"><button className="ns-ghost hidden sm:inline-flex">Log in</button><button className="ns-primary py-2.5" onClick={onStart}>Get started <ArrowRight className="h-4 w-4" /></button></div></header><main><section className="relative mx-auto grid max-w-[1280px] items-center gap-14 px-5 pb-20 pt-14 md:px-8 md:pb-28 md:pt-20 lg:grid-cols-[0.95fr_1.05fr] lg:gap-20"><div className="relative z-10"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[color:var(--ns-b-cde0db)] bg-[color:var(--ns-s-eef7f3)] px-3 py-1.5 text-xs font-bold text-[color:var(--ns-t-0f7582)]"><span className="h-1.5 w-1.5 rounded-full bg-[color:var(--ns-s-5aa995)]" />A more practical way forward</div><h1 className="max-w-[650px] font-display text-[clamp(3.2rem,7vw,6.5rem)] font-extrabold leading-[0.98] tracking-[-0.075em] text-[color:var(--ns-t-173144)]">Your next opportunity starts with the <span className="text-[color:var(--ns-t-0f7d86)]">right step.</span></h1><p className="mt-7 max-w-[530px] text-lg leading-8 text-[color:var(--ns-t-687d85)]">Discover opportunities that fit your skills, understand what you’re missing, and build the path to become job-ready.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><button className="ns-primary px-5 py-3.5" onClick={onStart}>Build Your Career Profile <ArrowRight className="h-4 w-4" /></button><a href="#how-it-works" className="ns-secondary px-5 py-3.5">Explore how it works <ArrowDownRight className="h-4 w-4" /></a></div><div className="mt-12 flex items-center gap-4"><div className="flex -space-x-2"><div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[color:var(--ns-b-f7f8f6)] bg-[color:var(--ns-s-f2c7a9)] text-[10px] font-bold text-[color:var(--ns-t-74462e)]">AS</div><div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[color:var(--ns-b-f7f8f6)] bg-[color:var(--ns-s-b6d8db)] text-[10px] font-bold text-[color:var(--ns-t-2d5961)]">MK</div><div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[color:var(--ns-b-f7f8f6)] bg-[color:var(--ns-s-d9c7e7)] text-[10px] font-bold text-[color:var(--ns-t-604c73)]">RJ</div></div><p className="text-xs leading-5 text-[color:var(--ns-t-829199)]"><span className="font-bold text-[color:var(--ns-t-4f6872)]">Built for the first step.</span><br />No experience required to get started.</p></div></div><div className="relative min-h-[460px] md:min-h-[540px]"><div className="absolute -right-10 top-1/2 h-[490px] w-[490px] -translate-y-1/2 rounded-full bg-[color:var(--ns-s-e3f0eb)] opacity-80" /><div className="absolute right-2 top-4 w-[88%] rotate-[3deg] rounded-[28px] border border-[color:var(--ns-b-d7e5e2)] bg-[color:var(--ns-s-edf3f0)] p-4 shadow-[0_35px_75px_rgba(26,66,74,0.12)] md:right-7 md:w-[88%]"><div className="rounded-[20px] bg-[color:var(--ns-s-ffffff)] p-5 shadow-sm md:p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--ns-t-809197)]">Career overview</p><h3 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.04em]">Good morning, Ritik</h3></div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--ns-s-d7ece6)] text-xs font-bold text-[color:var(--ns-t-0f6680)]">RR</div></div><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-[color:var(--ns-s-f4f8f6)] p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[color:var(--ns-t-73848a)]">Profile fit</span><Target className="h-4 w-4 text-[color:var(--ns-t-60a994)]" /></div><div className="mt-4 flex items-end gap-2"><span className="font-display text-3xl font-extrabold">82%</span><span className="mb-1 text-xs font-bold text-[color:var(--ns-t-5daa95)]">+8 this month</span></div><div className="mt-3"><ProgressBar value={82} color="var(--ns-t-60a994)" /></div></div><div className="rounded-2xl bg-[color:var(--ns-s-f5f7fb)] p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-[color:var(--ns-t-73848a)]">Resume strength</span><FileCheck2 className="h-4 w-4 text-[color:var(--ns-t-6b8cc4)]" /></div><div className="mt-4 flex items-end gap-2"><span className="font-display text-3xl font-extrabold">78</span><span className="mb-1 text-xs font-semibold text-[color:var(--ns-t-8b9aa3)]">/ 100</span></div><div className="mt-3"><ProgressBar value={78} color="var(--ns-t-6b8cc4)" /></div></div></div><div className="mt-5 rounded-2xl border border-[color:var(--ns-b-e6eeeb)] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-809197)]">Recommended next step</p><p className="mt-1 font-semibold">Complete React Fundamentals</p></div><span className="rounded-full bg-[color:var(--ns-s-e5f2ef)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--ns-t-0f7582)]">7 days</span></div><div className="mt-4 flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--ns-t-173144)] text-white"><ArrowRight className="h-4 w-4" /></div><div className="h-px flex-1 bg-[color:var(--ns-s-dbe6e2)]" /><div className="h-2 w-2 rounded-full bg-[color:var(--ns-s-aed2c8)]" /><div className="h-px w-8 bg-[color:var(--ns-s-dbe6e2)]" /><div className="h-2 w-2 rounded-full bg-[color:var(--ns-s-d9e4e2)]" /></div></div><div className="mt-5 flex items-center justify-between border-t border-[color:var(--ns-b-edf1ef)] pt-4 text-xs"><span className="text-[color:var(--ns-t-83939a)]">3 improvements available</span><span className="font-bold text-[color:var(--ns-t-0f7582)]">Review now <ArrowRight className="ml-1 inline h-3 w-3" /></span></div></div></div><div className="absolute bottom-9 left-0 rounded-2xl border border-[color:var(--ns-b-dce9e4)] bg-[color:var(--ns-s-ffffff)] p-4 shadow-[0_18px_40px_rgba(26,66,74,0.12)] md:left-[-18px]"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--ns-s-e4f2ed)] text-[color:var(--ns-t-168177)]"><ShieldCheck className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ns-t-89989e)]">Opportunity check</p><p className="mt-1 text-sm font-bold">Review recommended</p></div></div></div><div className="absolute right-0 top-[-9px] rounded-full border border-[color:var(--ns-b-d9e6e2)] bg-[color:var(--ns-s-ffffff)] px-4 py-2 text-xs font-bold text-[color:var(--ns-t-53747b)] shadow-sm">12 opportunities analyzed</div></div></section><section id="how-it-works" className="border-y border-[color:var(--ns-b-e3ebe8)] bg-[color:var(--ns-s-ffffff)]/55"><div className="mx-auto max-w-[1280px] px-5 py-20 md:px-8 md:py-24"><div className="max-w-2xl"><p className="ns-eyebrow">A simple loop that compounds</p><h2 className="mt-4 max-w-xl font-display text-4xl font-extrabold tracking-[-0.06em] md:text-5xl">Every step makes the next one clearer.</h2><p className="mt-5 text-base leading-7 text-[color:var(--ns-t-71818a)]">NextStep keeps the useful parts of career planning in one calm workspace — with evidence, context, and a next action you can actually take.</p></div><div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4"><FeatureStep number="01" icon={UserRound} title="Build your profile" body="Start with what you know. Add skills, projects, preferences, and a resume." color="teal" /><FeatureStep number="02" icon={Target} title="Find your fit" body="See why an opportunity matches — and where the important gaps are." color="blue" /><FeatureStep number="03" icon={BookOpen} title="Learn with intent" body="Turn your gaps into a visual roadmap with focused tasks and resources." color="amber" /><FeatureStep number="04" icon={TrendingUp} title="Improve over time" body="Capture applications and feedback so your strategy gets sharper." color="violet" /></div></div></section><section id="for-students" className="mx-auto max-w-[1280px] px-5 py-20 md:px-8 md:py-24"><div className="grid items-end gap-10 md:grid-cols-[0.9fr_1.1fr]"><div><p className="ns-eyebrow">Designed for the beginning</p><h2 className="mt-4 max-w-lg font-display text-4xl font-extrabold tracking-[-0.06em] md:text-5xl">Less guesswork.<br /><span className="text-[color:var(--ns-t-0f7d86)]">More forward motion.</span></h2></div><p className="max-w-xl text-base leading-7 text-[color:var(--ns-t-71818a)]">You do not need a perfect story to begin. You need a clear view of where you are, what matters next, and proof that you are moving.</p></div><div className="mt-14 grid gap-5 md:grid-cols-[1.2fr_0.8fr]"><div className="rounded-[28px] bg-[var(--ns-t-173144)] p-8 text-white md:p-10"><div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--ns-t-a9d8cc)]">The NextStep approach</p><h3 className="mt-4 max-w-md font-display text-3xl font-extrabold tracking-[-0.05em]">Intelligence should feel like a better product, not another chat window.</h3></div><div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--ns-s-ffffff)]/10 md:flex"><Compass className="h-7 w-7 text-[color:var(--ns-t-79ccb9)]" /></div></div><div className="mt-12 grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-3"><div><p className="font-display text-3xl font-extrabold text-[color:var(--ns-t-79ccb9)]">01</p><p className="mt-2 text-sm font-semibold">Evidence first</p><p className="mt-1 text-xs leading-5 text-[color:var(--ns-t-b6c9c9)]">No invented experience or empty promises.</p></div><div><p className="font-display text-3xl font-extrabold text-[color:var(--ns-t-79ccb9)]">02</p><p className="mt-2 text-sm font-semibold">Context always</p><p className="mt-1 text-xs leading-5 text-[color:var(--ns-t-b6c9c9)]">See the reasoning behind your match.</p></div><div><p className="font-display text-3xl font-extrabold text-[color:var(--ns-t-79ccb9)]">03</p><p className="mt-2 text-sm font-semibold">One next action</p><p className="mt-1 text-xs leading-5 text-[color:var(--ns-t-b6c9c9)]">Turn insight into something you can do.</p></div></div></div><div id="trust" className="rounded-[28px] border border-[color:var(--ns-b-dce8e4)] bg-[color:var(--ns-s-edf6f2)] p-8 md:p-10"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--ns-s-ffffff)] text-[color:var(--ns-t-0f7582)] shadow-sm"><ShieldCheck className="h-6 w-6" /></div><h3 className="mt-7 font-display text-2xl font-extrabold tracking-[-0.04em]">A thoughtful starting point.</h3><p className="mt-4 text-sm leading-6 text-[color:var(--ns-t-668087)]">Sample opportunities are clearly labeled. Demo applications never submit to external websites. Your story stays yours.</p><button className="ns-secondary mt-8 border-[color:var(--ns-b-c7ded8)] bg-[color:var(--ns-s-ffffff)]" onClick={onStart}>See the workspace <ArrowRight className="h-4 w-4" /></button></div></div></section></main><footer className="border-t border-[color:var(--ns-b-e1ebe8)] bg-[color:var(--ns-s-ffffff)]/50"><div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-5 py-8 text-sm text-[color:var(--ns-t-819198)] md:flex-row md:items-center md:justify-between md:px-8"><Logo /><p>Built for the next practical step.</p><p>© 2026 NextStep demo workspace</p></div></footer></div>;
}

function FeatureStep({ number, icon: Icon, title, body, color }: { number: string; icon: React.ElementType; title: string; body: string; color: string }) { const colors: Record<string, string> = { teal: "bg-[color:var(--ns-s-e4f2ed)] text-[color:var(--ns-t-0f7d86)]", blue: "bg-[color:var(--ns-s-eaf0f8)] text-[color:var(--ns-t-557bb2)]", amber: "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b37b31)]", violet: "bg-[color:var(--ns-s-eee9f7)] text-[color:var(--ns-t-795ca3)]" }; return <div className="ns-card p-6"><div className="flex items-center justify-between"><div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${colors[color]}`}><Icon className="h-5 w-5" /></div><span className="font-display text-sm font-extrabold text-[color:var(--ns-t-a9b6b8)]">{number}</span></div><h3 className="mt-7 font-display text-lg font-bold">{title}</h3><p className="mt-3 text-sm leading-6 text-[color:var(--ns-t-7b8a90)]">{body}</p></div>; }

function PageHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) { return <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between"><div><p className="ns-eyebrow">{eyebrow}</p><h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-0.055em] md:text-4xl">{title}</h1>{detail && <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--ns-t-7b8b91)]">{detail}</p>}</div>{action}</div>; }

type Insights = Array<{ title: string; body: string; tone: string }>;
type Stats = { opportunitiesAnalyzed: number; applications: number; feedbackNotes: number; roadmapItemsCompleted: number; roadmapItemsTotal: number; averageMatch: number; frequentlyMissingSkills: Array<{ skill: string; count: number }>; roadmapTotal: number; roadmapCompleted: number; roadmapRemaining: number; roadmapPercent: number; roadmapTargetOpportunity: string; currentOpportunityId: number | null; currentOpportunityTitle: string; currentOpportunityCompany: string; currentMatchPercentage: number; savedOpportunities: number; selectedApplications: number; rejectedApplications: number; rejectionSkills: Array<{ skill: string; count: number }> };

function Overview({ state, currentUser, profileCompletion, onGo, insights, stats }: { state: AppState; currentUser: string; profileCompletion: number; onGo: (section: Section) => void; insights: Insights; stats?: Stats }) { const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); const hour = new Date().getHours(); const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : hour < 21 ? "Good Evening" : "Good Night"; const completed = stats?.roadmapCompleted ?? state.roadmapDone.length; const totalItems = stats?.roadmapTotal ?? 0; const remainingItems = stats?.roadmapRemaining ?? Math.max(0, totalItems - completed); const progressPercent = stats?.roadmapPercent ?? (totalItems ? Math.round((completed / totalItems) * 100) : 0); const nextStep = insights[0]; return <><PageHeader eyebrow={today} title={`${greeting}, ${currentUser}`} detail="Here’s your career progress. One focused move at a time." action={<button className="ns-primary" onClick={() => onGo("opportunities")}>Analyze opportunity <ArrowRight className="h-4 w-4" /></button>} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="Profile completion" value={`${profileCompletion}%`} delta={profileCompletion >= 80 ? "Ready to match" : "Add evidence to improve"} icon={Gauge} tint="teal" /><MetricCard label="Skill match average" value={stats?.averageMatch ? `${stats.averageMatch}%` : "—"} delta={stats?.opportunitiesAnalyzed ? `${stats.opportunitiesAnalyzed} analyzed` : "Analyze your first role"} icon={Target} tint="blue" /><MetricCard label="Opportunities analyzed" value={`${stats?.opportunitiesAnalyzed ?? state.analyzedCount}`} delta={stats?.frequentlyMissingSkills?.[0] ? `Top gap: ${stats.frequentlyMissingSkills[0].skill}` : "No repeating gap yet"} icon={Compass} tint="amber" /><MetricCard label="Applications" value={`${stats?.applications ?? state.applications.length}`} delta={`${state.applications.filter(app => app.status === "Interview" || app.status === "Selected").length} in interview or better`} icon={FolderKanban} tint="violet" /><MetricCard label="Roadmap progress" value={totalItems ? `${completed}/${totalItems}` : "—"} delta={totalItems ? `${progressPercent}% complete · ${remainingItems} remaining` : "Build a roadmap"} icon={BookOpen} tint="coral" /></div><RoadmapProgressPanel onViewRoadmap={() => onGo("roadmap")} /><div className="mt-8 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]"><div className="ns-card overflow-hidden"><div className="flex items-center justify-between border-b border-[color:var(--ns-b-edf1ef)] px-6 py-5"><div><p className="ns-label">Recommended next steps</p><h2 className="mt-1 font-display text-xl font-bold">Keep the loop moving</h2></div><button className="ns-ghost" onClick={() => onGo("roadmap")}>View roadmap <ArrowRight className="h-4 w-4" /></button></div><div className="divide-y divide-[color:var(--ns-b-edf1ef)]"><NextStepRow icon={BookOpen} title={nextStep?.title ?? "Analyze an opportunity"} body={nextStep?.body ?? "Paste a job description or upload a screenshot to see your real match."} meta="Next" color="teal" onClick={() => onGo("opportunities")} /><NextStepRow icon={FileText} title="Review your resume" body={state.resumeUploaded ? "Your latest review and improvement suggestions are ready." : "Upload a resume to populate your profile automatically."} meta="Resume" color="blue" onClick={() => onGo("resume")} /><NextStepRow icon={Compass} title="Track your applications" body={`${state.applications.length} application(s) in your tracker. Statuses persist locally.`} meta="Track" color="amber" onClick={() => onGo("applications")} /></div></div><div className="ns-card p-6"><div className="flex items-center justify-between"><div><p className="ns-label">Momentum</p><h2 className="mt-1 font-display text-xl font-bold">Your workspace so far</h2></div><TrendingUp className="h-5 w-5 text-[color:var(--ns-t-62a996)]" /></div><div className="mt-7 flex items-end gap-3"><span className="font-display text-5xl font-extrabold tracking-[-0.06em]">{stats?.averageMatch ? `${stats.averageMatch}%` : "—"}</span><span className="mb-2 text-xs font-bold text-[color:var(--ns-t-5da58f)]">average match score</span></div><div className="mt-7 flex h-28 items-end gap-2">{(stats?.frequentlyMissingSkills?.length ? stats.frequentlyMissingSkills.slice(0, 12) : [{ skill: "No data yet", count: 0 }]).map((item, index) => <div key={index} className="flex flex-1 flex-col items-center gap-2"><div className={`w-full rounded-t-md ${index === 0 ? "bg-[color:var(--ns-s-0f8585)]" : "bg-[color:var(--ns-s-cce5de)]"}`} style={{ height: `${Math.max(12, Math.min(100, item.count * 25))}%` }} /><span className="truncate text-[9px] text-[color:var(--ns-t-9aa8aa)]">{item.skill.split(" ")[0]}</span></div>)}</div><p className="mt-5 border-t border-[color:var(--ns-b-edf1ef)] pt-4 text-xs leading-5 text-[color:var(--ns-t-788a90)]">{stats?.frequentlyMissingSkills?.length ? <>Your most frequent gap is <span className="font-bold text-[color:var(--ns-t-0f7582)]">{stats.frequentlyMissingSkills[0].skill}</span> ({stats.frequentlyMissingSkills[0].count} of {stats.opportunitiesAnalyzed} analyzed roles).</> : <>Analyze a few opportunities and this panel will show the skills that keep reappearing.</>}</p></div></div><div className="mt-5 grid gap-5 lg:grid-cols-3">{(insights.length ? insights.slice(0, 3) : [{ title: "Start the loop", body: "Analyze your first opportunity to unlock insights from your own data.", tone: "neutral" }]).map((insight, index) => <InsightCard key={index} icon={index === 0 ? Zap : index === 1 ? ListChecks : LockKeyhole} title={insight.title} body={insight.body} action={index === 0 ? "Build roadmap" : "Open feedback"} onClick={() => onGo(index === 0 ? "skills" : "feedback")} />)}</div></>; }

function MetricCard({ label, value, delta, icon: Icon, tint }: { label: string; value: string; delta: string; icon: React.ElementType; tint: string }) { const styles: Record<string, string> = { teal: "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]", blue: "bg-[color:var(--ns-s-e8eef8)] text-[color:var(--ns-t-5b7caf)]", amber: "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]", violet: "bg-[color:var(--ns-s-eeeafa)] text-[color:var(--ns-t-795ea2)]", coral: "bg-[color:var(--ns-s-f9e8e5)] text-[color:var(--ns-t-c66b57)]" }; return <div className="ns-card p-5"><div className="flex items-start justify-between"><p className="max-w-[120px] text-xs font-semibold leading-5 text-[color:var(--ns-t-71818a)]">{label}</p><div className={`flex h-9 w-9 items-center justify-center rounded-xl ${styles[tint]}`}><Icon className="h-[17px] w-[17px]" /></div></div><p className="mt-5 font-display text-3xl font-extrabold tracking-[-0.05em]">{value}</p><p className="mt-1 text-[11px] font-semibold text-[color:var(--ns-t-64a38f)]">{delta}</p></div>; }

function NextStepRow({ icon: Icon, title, body, meta, color, onClick }: { icon: React.ElementType; title: string; body: string; meta: string; color: string; onClick: () => void }) { const styles: Record<string, string> = { teal: "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]", blue: "bg-[color:var(--ns-s-e8eef8)] text-[color:var(--ns-t-5b7caf)]", amber: "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]" }; return <button className="flex w-full items-center gap-4 px-6 py-5 text-left hover:bg-[color:var(--ns-s-fafcfb)]" onClick={onClick}><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${styles[color]}`}><Icon className="h-[18px] w-[18px]" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{title}</p><p className="mt-1 truncate text-xs text-[color:var(--ns-t-829197)]">{body}</p></div><span className="hidden rounded-full bg-[color:var(--ns-s-f0f5f3)] px-3 py-1.5 text-[11px] font-bold text-[color:var(--ns-t-668087)] sm:inline-flex">{meta}</span><ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--ns-t-a1afb1)]" /></button>; }

function InsightCard({ icon: Icon, title, body, action, onClick }: { icon: React.ElementType; title: string; body: string; action: string; onClick: () => void }) { return <div className="ns-card p-5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--ns-s-eef5f2)] text-[color:var(--ns-t-0f7582)]"><Icon className="h-[17px] w-[17px]" /></div><h3 className="mt-5 text-sm font-bold">{title}</h3><p className="mt-2 text-xs leading-5 text-[color:var(--ns-t-7d8d93)]">{body}</p><button className="mt-4 text-xs font-bold text-[color:var(--ns-t-0f7582)]" onClick={onClick}>{action} <ArrowRight className="ml-1 inline h-3 w-3" /></button></div>; }

function ProfileView({ state, updateProfile, profileSkillInput, setProfileSkillInput, addSkill, removeSkill, onSave, isSaving, mode }: { state: AppState; updateProfile: (field: keyof AppState["profile"], value: string) => void; profileSkillInput: string; setProfileSkillInput: (value: string) => void; addSkill: () => void; removeSkill: (skill: string) => void; onSave: () => void; isSaving: boolean; mode: string }) { const health = Math.min(100, Math.round((state.profile.name ? 15 : 0) + (state.profile.email ? 10 : 0) + (state.profile.degree ? 15 : 0) + (state.profile.cgpa ? 10 : 0) + (state.profile.objective ? 15 : 0) + Math.min(35, state.profile.skills.length * 3))); return <><PageHeader eyebrow="Your foundation" title="Build your career profile" detail="Keep this current and every match, roadmap, and resume review gets more useful. This data is stored in your local SQLite database." action={<button className="ns-primary" onClick={onSave} disabled={isSaving}>{isSaving ? <><Clock3 className="h-4 w-4 animate-pulse" /> Saving…</> : <><Check className="h-4 w-4" /> Save changes</>}</button>} /><div className="grid gap-5 xl:grid-cols-[1fr_310px]"><div className="space-y-5"><section className="ns-card p-6"><SectionTitle icon={UserRound} eyebrow="01 / Personal information" title="Tell us about you" /><div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="Full name" value={state.profile.name} onChange={value => updateProfile("name", value)} /><Field label="Email" value={state.profile.email} onChange={value => updateProfile("email", value)} /><Field label="Phone" value={state.profile.phone} onChange={value => updateProfile("phone", value)} /><Field label="Location" value={state.profile.location} onChange={value => updateProfile("location", value)} /><Field label="Preferred work location" value={state.profile.workLocation} onChange={value => updateProfile("workLocation", value)} /><Field label="Career objective" value={state.profile.objective} onChange={value => updateProfile("objective", value)} wide /></div></section><section className="ns-card p-6"><SectionTitle icon={GraduationCap} eyebrow="02 / Education" title="Your learning context" /><div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="College" value={state.profile.college} onChange={value => updateProfile("college", value)} wide /><Field label="Degree" value={state.profile.degree} onChange={value => updateProfile("degree", value)} /><Field label="Branch" value={state.profile.branch} onChange={value => updateProfile("branch", value)} /><Field label="Graduation year" value={state.profile.graduationYear} onChange={value => updateProfile("graduationYear", value)} /><Field label="CGPA / percentage" value={state.profile.cgpa} onChange={value => updateProfile("cgpa", value)} /></div></section><section className="ns-card p-6"><SectionTitle icon={Zap} eyebrow="03 / Skills" title="What can you work with?" /><div className="mt-6 flex flex-wrap gap-2">{state.profile.skills.map(skill => <span key={skill} className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ns-b-cee2dc)] bg-[color:var(--ns-s-eef7f3)] px-3 py-2 text-xs font-semibold text-[color:var(--ns-t-226779)]">{skill}<button onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`}><X className="h-3 w-3" /></button></span>)}<div className="flex items-center gap-2"><input className="ns-input w-40 py-2 text-xs" placeholder="Add a skill" value={profileSkillInput} onChange={event => setProfileSkillInput(event.target.value)} onKeyDown={event => event.key === "Enter" && addSkill()} /><button className="ns-secondary px-3 py-2 text-xs" onClick={addSkill}><Plus className="h-3.5 w-3.5" /> Add</button></div></div><p className="mt-5 text-xs text-[color:var(--ns-t-849298)]">Tip: add the tools you can show through a project, not just the ones you have heard of. Press <span className="font-bold">Save changes</span> to store this in SQLite.</p></section></div><aside className="space-y-5"><div className="ns-card bg-[var(--ns-t-173144)] p-6 text-white"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--ns-t-9ed2c4)]">Profile health</p><p className="mt-2 font-display text-4xl font-extrabold">{health}%</p></div><Gauge className="h-6 w-6 text-[color:var(--ns-t-77c9b7)]" /></div><div className="mt-5 h-2 rounded-full bg-white/15"><div className="h-full rounded-full bg-[color:var(--ns-s-74c8b6)]" style={{ width: `${health}%` }} /></div><p className="mt-4 text-xs leading-5 text-[color:var(--ns-t-b3caca)]">{health >= 90 ? "Your profile is complete enough for confident matching." : "Add a project link, preferences and one more skill to strengthen your matches."}</p></div><div className="ns-card p-6"><p className="ns-label">Profile checklist</p><div className="mt-5 space-y-4"><Checklist label="Personal details" done={Boolean(state.profile.name && state.profile.email)} /><Checklist label="Education" done={Boolean(state.profile.degree)} /><Checklist label="Skills" done={state.profile.skills.length > 0} /><Checklist label="Career objective" done={Boolean(state.profile.objective)} /><Checklist label="Preferences" done={mode === "real"} /></div></div></aside></div></>; }

function Field({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) { return <label className={`block ${wide ? "md:col-span-2" : ""}`}><span className="ns-label">{label}</span>{label === "Career objective" ? <textarea className="ns-input mt-2 min-h-[105px] resize-y" value={value} onChange={event => onChange(event.target.value)} /> : <input className="ns-input mt-2" value={value} onChange={event => onChange(event.target.value)} />}</label>; }
function SectionTitle({ icon: Icon, eyebrow, title }: { icon: React.ElementType; eyebrow: string; title: string }) { return <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--ns-s-e7f2ee)] text-[color:var(--ns-t-0f7582)]"><Icon className="h-5 w-5" /></div><div><p className="ns-label">{eyebrow}</p><h2 className="mt-1 font-display text-lg font-bold">{title}</h2></div></div>; }
function Checklist({ label, done }: { label: string; done: boolean }) { return <div className="flex items-center gap-3 text-sm"><div className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-[color:var(--ns-s-d9eee7)] text-[color:var(--ns-t-21816f)]" : "border border-[color:var(--ns-b-cadbd7)] text-transparent"}`}>{done && <Check className="h-3 w-3" />}</div><span className={done ? "text-[color:var(--ns-t-486873)]" : "text-[color:var(--ns-t-829299)]"}>{label}</span>{done && <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-65a591)]">Ready</span>}</div>; }

type ExtractedView = { name: string; email: string; phone: string; location: string; degree: string; branch: string; graduationYear: string; cgpa: string; careerObjective: string; skills: string[]; projects: Array<{ title: string; description?: string; technologies?: string[]; link?: string }>; experience: Array<{ company?: string; role?: string; duration?: string; description?: string }>; certifications: Array<{ name: string; issuer?: string; year?: string }>; notFound: string[] };
type ResumeAnalysisView = { score: number; breakdown: Array<{ label: string; score: number; color: string }>; strengths: string[]; improvements: Array<{ category: string; detail: string }>; skillObservations: string[]; projectObservations: string[]; experienceObservations: string[]; educationObservations: string[]; formattingObservations: string[]; summaryObservation: string; jobRelevance: string; improvedSummary: string };

function ResumeView({ state, review, analysis, onUpload, onImprove, onDownload, onSaveProfile, extracted, isBusy, loadingLabel, improvedResume, changes }: { state: AppState; review?: { score: number; breakdown: Array<{ label: string; score: number; color: string }>; suggestions: Array<{ category: string; detail: string }>; improvedSummary: string }; analysis: ResumeAnalysisView | null; onUpload: (file?: File) => void; onImprove: () => void; onDownload: () => void; onSaveProfile: () => void; extracted: ExtractedView | null; isBusy: boolean; loadingLabel: string; improvedResume: string; changes: Array<{ area: string; change: string }> }) { const breakdown = review?.breakdown ?? [{ label: "Skills", score: 0, color: "var(--ns-t-59a894)" }, { label: "Projects", score: 0, color: "var(--ns-t-668dca)" }, { label: "Experience", score: 0, color: "var(--ns-t-d49b4f)" }, { label: "Education", score: 0, color: "var(--ns-t-8a6eb4)" }, { label: "Formatting", score: 0, color: "var(--ns-t-ca725f)" }, { label: "Job relevance", score: 0, color: "var(--ns-t-4e9a8e)" }]; const suggestions = review?.suggestions ?? analysis?.improvements ?? []; return <><PageHeader eyebrow="Resume intelligence" title="Resume review" detail="A factual review of clarity, proof, and relevance — without inventing anything." action={<div className="flex gap-2"><button className="ns-secondary" onClick={onDownload}><FileText className="h-4 w-4" /> View resume</button><button className="ns-primary" onClick={onDownload} disabled={!analysis}><ArrowDownRight className="h-4 w-4" /> Download</button></div>} /><div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]"><div className="space-y-5"><div className="ns-card p-6"><div className="flex items-center gap-6"><ScoreRing value={review?.score ?? 0} /><div><p className="ns-label">Profile strength</p><h2 className="mt-2 font-display text-2xl font-extrabold">{!analysis ? "Awaiting your resume" : (review?.score ?? 0) >= 75 ? "Good foundation" : (review?.score ?? 0) >= 55 ? "Solid start" : "Needs sharpening"}</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[color:var(--ns-t-7a8b91)]">{analysis?.jobRelevance ?? "Upload a PDF or DOCX resume and the review will render here using the real extracted content."}</p></div></div><div className="mt-7 space-y-4">{breakdown.map(item => <div key={item.label}><div className="mb-2 flex justify-between text-xs font-semibold"><span className="text-[color:var(--ns-t-5a727a)]">{item.label}</span><span className="text-[color:var(--ns-t-173144)]">{item.score}</span></div><ProgressBar value={item.score} color={item.color.startsWith("#") ? item.color : "var(--ns-t-59a894)"} /></div>)}</div></div><label className="ns-card flex cursor-pointer items-center gap-4 border-dashed p-5 hover:border-[color:var(--ns-b-8fc6bd)]"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--ns-s-e7f2ee)] text-[color:var(--ns-t-0f7582)]">{isBusy ? <Clock3 className="h-5 w-5 animate-pulse" /> : <Upload className="h-5 w-5" />}</div><div className="flex-1"><p className="text-sm font-bold">{isBusy ? loadingLabel || "Processing…" : state.resumeUploaded ? "Resume processed" : "Upload your resume"}</p><p className="mt-1 text-xs text-[color:var(--ns-t-839298)]">PDF or DOCX · reviewed before saving to your profile</p></div><input type="file" className="hidden" accept=".pdf,.docx" disabled={isBusy} onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} /><ArrowRight className="h-4 w-4 text-[color:var(--ns-t-99a8ab)]" /></label>{extracted && <div className="ns-card p-6"><div className="flex items-start justify-between gap-4"><div><p className="ns-label">Extracted profile</p><h2 className="mt-1 font-display text-xl font-bold">Review before saving</h2></div><span className="rounded-full bg-[color:var(--ns-s-e8f2ee)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-26796d)]">{extracted.notFound.length ? `${extracted.notFound.length} field(s) not found` : "All fields found"}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[["Name", extracted.name], ["Email", extracted.email], ["Phone", extracted.phone], ["Location", extracted.location], ["Degree", extracted.degree], ["Branch", extracted.branch], ["Graduation year", extracted.graduationYear], ["CGPA", extracted.cgpa]].map(([label, value]) => <div key={label as string} className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">{label}</p><p className={`mt-1 text-sm ${value === "Not found" ? "italic text-[color:var(--ns-t-a3b0b4)]" : "font-semibold text-[color:var(--ns-t-46636c)]"}`}>{value}</p></div>)}</div><div className="mt-4 flex flex-wrap gap-2">{extracted.skills.map(skill => <span key={skill} className="rounded-full border border-[color:var(--ns-b-cee2dc)] bg-[color:var(--ns-s-eef7f3)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ns-t-226779)]">{skill}</span>)}</div>{extracted.notFound.length > 0 && <p className="mt-4 text-xs text-[color:var(--ns-t-8a999e)]">Not found in the document: {extracted.notFound.join(", ")}. Nothing was invented to fill these gaps.</p>}<button className="ns-primary mt-5" onClick={onSaveProfile} disabled={isBusy}><Check className="h-4 w-4" /> Save to my profile</button></div>}</div><div className="space-y-5"><div className="ns-card p-6"><div className="flex items-start justify-between gap-4"><div><p className="ns-label">Suggested improvements</p><h2 className="mt-1 font-display text-xl font-bold">Make your proof easier to see</h2></div><Sparkles className="h-5 w-5 text-[color:var(--ns-t-c18b4a)]" /></div><div className="mt-6 space-y-3">{suggestions.length ? suggestions.map(item => <div key={`${item.category}-${item.detail.slice(0, 20)}`} className="rounded-2xl bg-[color:var(--ns-s-f7faf8)] p-4"><div className="flex items-center justify-between"><p className="text-sm font-bold">{item.category}</p><ArrowUpRight className="h-4 w-4 text-[color:var(--ns-t-94a4a6)]" /></div><p className="mt-2 text-sm leading-6 text-[color:var(--ns-t-71828a)]">{item.detail}</p></div>) : <p className="rounded-2xl bg-[color:var(--ns-s-f7faf8)] p-4 text-sm leading-6 text-[color:var(--ns-t-71828a)]">Upload a resume to receive specific, content-based suggestions.</p>}</div><button className="ns-primary mt-6" onClick={onImprove} disabled={isBusy || !analysis}>{isBusy ? <><Clock3 className="h-4 w-4 animate-pulse" /> {loadingLabel || "Working…"}</> : <><Sparkles className="h-4 w-4" /> {state.improvedResume ? "Improve again" : "Improve resume"}</>}</button><p className="mt-3 flex items-center gap-2 text-[11px] text-[color:var(--ns-t-84949a)]"><ShieldCheck className="h-3.5 w-3.5 text-[color:var(--ns-t-63a48e)]" /> Factual safeguard: wording only, no invented experience.</p></div>{analysis && <div className="ns-card p-6"><p className="ns-label">Analysis detail</p><div className="mt-5 space-y-4 text-sm leading-6 text-[color:var(--ns-t-5d747c)]">{analysis.strengths.length > 0 && <div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-65a591)]">Strengths</p><ul className="mt-2 space-y-1">{analysis.strengths.map(item => <li key={item}>• {item}</li>)}</ul></div>}<div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-8b9aa3)]">Skills</p><ul className="mt-2 space-y-1">{analysis.skillObservations.map(item => <li key={item}>• {item}</li>)}</ul></div><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-8b9aa3)]">Projects</p><ul className="mt-2 space-y-1">{analysis.projectObservations.map(item => <li key={item}>• {item}</li>)}</ul></div><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-8b9aa3)]">Experience &amp; education</p><ul className="mt-2 space-y-1">{[...analysis.experienceObservations, ...analysis.educationObservations].map(item => <li key={item}>• {item}</li>)}</ul></div><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-8b9aa3)]">Formatting &amp; summary</p><ul className="mt-2 space-y-1">{[analysis.summaryObservation, ...analysis.formattingObservations].map(item => <li key={item}>• {item}</li>)}</ul></div></div></div>}<div className="rounded-2xl border border-[color:var(--ns-b-e4ece9)] bg-[color:var(--ns-s-eef6f3)] p-5"><p className="ns-label">Improved summary preview</p><p className="mt-3 text-sm leading-6 text-[color:var(--ns-t-45656c)]">{review?.improvedSummary ?? "An improved summary will appear here once your resume has been analyzed."}</p></div>{improvedResume && <div className="ns-card p-6"><p className="ns-label">Improved resume</p><h2 className="mt-1 font-display text-xl font-bold">Wording and structure only</h2><div className="mt-5 space-y-3">{changes.map(item => <div key={item.change} className="rounded-2xl bg-[color:var(--ns-s-f7faf8)] p-4"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">{item.area}</p><p className="mt-1 text-sm leading-6 text-[color:var(--ns-t-71828a)]">{item.change}</p></div>)}</div><pre className="mt-5 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl bg-[color:var(--ns-s-f7faf8)] p-4 text-xs leading-5 text-[color:var(--ns-t-4c6872)]">{improvedResume}</pre><button className="ns-secondary mt-4 w-full" onClick={onDownload}><ArrowDownRight className="h-4 w-4" /> Download improved resume</button></div>}</div></div></>; }

function OpportunitiesView({ jobs, description, setDescription, onAnalyze, isAnalyzing, notice, analysis, onSelectJob, onApply, onPrepare, onRoadmap, selectedJob, relevantOnly, setRelevantOnly, onUpload, analysisEngine, loadingLabel }: { jobs: Opportunity[]; description: string; setDescription: (value: string) => void; onAnalyze: () => void; isAnalyzing: boolean; notice: string; analysis: AnalysisResult | null; onSelectJob: (job: Opportunity) => void; onApply: (job: Opportunity) => void; onPrepare: (job: Opportunity) => void; onRoadmap: () => void; selectedJob: Opportunity | null; relevantOnly: boolean; setRelevantOnly: (value: boolean) => void; onUpload: (file?: File) => void; analysisEngine?: string; loadingLabel?: string }) { const visible = relevantOnly ? jobs.filter(job => job.match >= 80) : jobs; return <><PageHeader eyebrow="Find your fit" title="Opportunities" detail="Paste a real job description or upload a screenshot, then see exactly why you match — and what is missing." action={<button className="ns-secondary"><Filter className="h-4 w-4" /> Filter view</button>} /><div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]"><div className="ns-card p-6"><div className="flex items-start justify-between"><div><p className="ns-label">Opportunity input</p><h2 className="mt-1 font-display text-xl font-bold">Analyze an opportunity</h2></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--ns-s-e7f2ee)] text-[color:var(--ns-t-0f7582)]"><Search className="h-5 w-5" /></div></div><p className="mt-3 text-sm leading-6 text-[color:var(--ns-t-7a8b91)]">Paste a job description, or upload a job screenshot (JPG, JPEG, PNG). Requirements are read from your input — never from a fixed list.</p><textarea className="ns-input mt-5 min-h-[190px] resize-y" placeholder="Paste the job description here..." value={description} onChange={event => setDescription(event.target.value)} />{notice && <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-[color:var(--ns-t-ba6254)]"><CircleAlert className="h-4 w-4" /> {notice}</p>}<div className="mt-4 flex flex-col gap-3 sm:flex-row"><button className="ns-primary flex-1" onClick={onAnalyze} disabled={isAnalyzing}>{isAnalyzing ? <><Clock3 className="h-4 w-4 animate-pulse" /> {loadingLabel || "Analyzing..."}</> : <><Radar className="h-4 w-4" /> Analyze opportunity</>}</button><label className="ns-secondary flex-1 cursor-pointer"><Upload className="h-4 w-4" /> Upload screenshot<input type="file" className="hidden" accept="image/png,image/jpeg,image/jpg,image/webp" disabled={isAnalyzing} onChange={event => { onUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label></div><div className="mt-5 flex items-center gap-2 border-t border-[color:var(--ns-b-edf1ef)] pt-4 text-xs text-[color:var(--ns-t-87969b)]"><ShieldCheck className="h-4 w-4 text-[color:var(--ns-t-63a48e)]" /> Opportunity checks are signals, not guarantees.</div></div><div className="ns-card overflow-hidden"><div className="border-b border-[color:var(--ns-b-edf1ef)] px-6 py-5"><div className="flex items-center justify-between"><div><p className="ns-label">Saved opportunities</p><h2 className="mt-1 font-display text-xl font-bold">{jobs.length ? "Your analyzed roles" : "Nothing analyzed yet"}</h2></div><button className={`rounded-full px-3 py-1.5 text-xs font-bold ${relevantOnly ? "bg-[color:var(--ns-s-dcefe9)] text-[color:var(--ns-t-0f7582)]" : "bg-[color:var(--ns-s-f1f5f3)] text-[color:var(--ns-t-76878c)]"}`} onClick={() => setRelevantOnly(!relevantOnly)}>80%+ match only</button></div><p className="mt-2 text-xs text-[color:var(--ns-t-8b999e)]">Stored locally in SQLite · sample rows are labelled</p></div><div className="divide-y divide-[color:var(--ns-b-edf1ef)]">{visible.length ? visible.map(job => <JobListItem key={job.id} job={job} active={selectedJob?.id === job.id} onSelect={() => onSelectJob(job)} onApply={() => onApply(job)} onPrepare={() => onPrepare(job)} />) : <div className="px-6 py-10 text-center text-sm text-[color:var(--ns-t-8b999e)]">No opportunities stored yet. Paste a job description above to create one.</div>}</div></div></div>{analysis && <OpportunityAnalysis result={analysis} onRoadmap={onRoadmap} engine={analysisEngine} />}</>; }

function JobListItem({ job, active, onSelect, onApply, onPrepare }: { job: Opportunity; active: boolean; onSelect: () => void; onApply: () => void; onPrepare: () => void }) { return <div className={`p-5 transition-colors ${active ? "bg-[color:var(--ns-s-f4faf7)]" : "hover:bg-[color:var(--ns-s-fafcfb)]"}`}><div className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold" style={{ background: job.accent, color: "var(--ns-t-36636a)" }}>{job.company.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{job.title}</p><p className="mt-1 text-xs text-[color:var(--ns-t-7f8e93)]">{job.company} · {job.location}</p></div><span className="rounded-full bg-[color:var(--ns-s-e3f2ed)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--ns-t-20796f)]">{job.match ? `${job.match}% match` : "Not scored"}</span></div><div className="mt-3 flex flex-wrap gap-1.5">{job.tags.map(tag => <span key={tag} className="rounded-md bg-[color:var(--ns-s-f1f5f3)] px-2 py-1 text-[10px] font-semibold text-[color:var(--ns-t-6f8187)]">{tag}</span>)}</div><div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-[color:var(--ns-t-8a999e)]">{job.stipend} · {job.deadline}</span><div className="flex gap-1"><button className="ns-ghost px-2 py-1 text-xs" onClick={onSelect}>Analyze match</button><button className="ns-primary px-3 py-1.5 text-xs" onClick={onApply}>Apply</button><OpportunityDeleteButton opportunityId={job.id} jobTitle={job.title} company={job.company} /></div></div><button onClick={onPrepare} className="mt-3 flex items-center gap-1 text-[11px] font-bold text-[color:var(--ns-t-0f7582)]">Prepare application <ArrowRight className="h-3 w-3" /></button></div></div></div>; }

function OpportunityAnalysis({ result, onRoadmap, engine }: { result: AnalysisResult; onRoadmap: () => void; engine?: string }) { const label = result.matchScore >= 80 ? "Strong fit" : result.matchScore >= 60 ? "Strong starting fit" : result.matchScore >= 40 ? "Partial fit" : "Early fit"; return <div className="ns-card mt-5 overflow-hidden"><div className="flex flex-col gap-6 border-b border-[color:var(--ns-b-edf1ef)] bg-[color:var(--ns-s-fbfdfc)] p-6 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-5"><ScoreRing value={result.matchScore} /><div><p className="ns-label">Opportunity match</p><h2 className="mt-1 font-display text-2xl font-extrabold">{label}</h2><p className="mt-2 text-sm text-[color:var(--ns-t-7a8b91)]">{result.explanation || "Based on the requirements stated in this posting and your stored profile."}</p>{engine && <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${engine === "gemini" ? "bg-[color:var(--ns-s-e0f1ea)] text-[color:var(--ns-t-26836d)]" : "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]"}`}>{engine === "gemini" ? "Gemini analysis" : "Local analysis (demo mode)"}</span>}</div></div><button className="ns-secondary" onClick={onRoadmap}><BookOpen className="h-4 w-4" /> Build roadmap from gaps</button></div><div className="grid gap-6 p-6 xl:grid-cols-[1.1fr_0.9fr]"><div><p className="ns-label">Eligibility</p><div className="mt-4 space-y-3">{result.eligibility.map(item => <div key={item.label} className="flex items-start gap-3"><div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${item.status === "met" ? "bg-[color:var(--ns-s-e0f1ea)] text-[color:var(--ns-t-26836d)]" : item.status === "unknown" ? "bg-[color:var(--ns-s-f1f5f3)] text-[color:var(--ns-t-7d8e94)]" : "bg-[color:var(--ns-s-fae9e4)] text-[color:var(--ns-t-c86a58)]"}`}>{item.status === "met" ? <Check className="h-3 w-3" /> : item.status === "unknown" ? <CircleAlert className="h-3 w-3" /> : <X className="h-3 w-3" />}</div><div><p className="text-sm font-semibold">{item.label} {item.status === "gap" && <span className="font-normal text-[color:var(--ns-t-c86a58)]">needs evidence</span>}</p><p className="mt-1 text-xs text-[color:var(--ns-t-829197)]">{item.detail}</p></div></div>)}</div><div className="mt-6"><p className="ns-label">Score factors</p><div className="mt-4 space-y-3">{result.factors.map(factor => <div key={factor.label}><div className="mb-1.5 flex justify-between text-xs font-semibold"><span className="text-[color:var(--ns-t-5a727a)]">{factor.label}</span><span className="text-[color:var(--ns-t-173144)]">{factor.value}</span></div><ProgressBar value={factor.score} /></div>)}</div></div></div><div><p className="ns-label">Skill match</p><div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--ns-b-e4ece9)]"><div className="grid grid-cols-2 bg-[color:var(--ns-s-f7faf8)] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-849398)]"><span>Required skill</span><span>Your status</span></div>{result.skillRows.map(row => <div key={row.skill} className="grid grid-cols-2 items-center border-t border-[color:var(--ns-b-edf1ef)] px-4 py-3"><span className="text-sm font-semibold">{row.skill}</span><span className={`text-xs font-bold ${row.status === "Matched" ? "text-[color:var(--ns-t-3f967e)]" : row.status === "Partial" ? "text-[color:var(--ns-t-b07b38)]" : "text-[color:var(--ns-t-c56756)]"}`}>{row.status}<span className="ml-1 hidden font-normal text-[color:var(--ns-t-88969a)] sm:inline">· {row.note}</span></span></div>)}</div><div className="mt-4 grid grid-cols-3 gap-3 text-center">{[["Matched", result.matchedSkills.length], ["Partial", result.partialSkills.length], ["Missing", result.missingSkills.length]].map(([label, count]) => <div key={label as string} className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">{label}</p><p className="mt-1 font-display text-xl font-extrabold">{count as number}</p></div>)}</div></div></div><div className="border-t border-[color:var(--ns-b-edf1ef)] px-6 py-5"><div className="flex items-center justify-between"><div><p className="ns-label">Opportunity check</p><p className="mt-1 text-sm font-bold">{result.verification.status}</p></div><ShieldCheck className={`h-5 w-5 ${result.verification.status === "Review recommended" ? "text-[color:var(--ns-t-c18b4a)]" : "text-[color:var(--ns-t-4e9a85)]"}`} /></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{result.verification.indicators.slice(0, 4).map(indicator => <div key={indicator.label} className="rounded-xl bg-[color:var(--ns-s-f7faf8)] p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${indicator.status === "good" ? "bg-[color:var(--ns-s-62aa91)]" : indicator.status === "watch" ? "bg-[color:var(--ns-s-d19a4d)]" : "bg-[color:var(--ns-s-aab8b9)]"}`} /><p className="text-[11px] font-bold">{indicator.label}</p></div><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[color:var(--ns-t-849398)]">{indicator.detail}</p></div>)}</div></div></div>; }

function SkillsView({ gaps, onRoadmap, hasAnalysis }: { gaps: Array<{ skill: string; level: string; required: string; importance: string; gap: string }>; onRoadmap: () => void; hasAnalysis: boolean }) { const totalDays = gaps.length * 5; return <><PageHeader eyebrow="Close the distance" title="Skills to develop" detail="Derived from the requirements of the opportunity you most recently analyzed." action={<button className="ns-primary" onClick={onRoadmap}><BookOpen className="h-4 w-4" /> Build my roadmap</button>} />{gaps.length === 0 ? <EmptyState icon={Radar} title={hasAnalysis ? "No open gaps on your last analysis" : "Analyze an opportunity first"} detail={hasAnalysis ? "Your last analyzed role had no missing or partially matched requirements. Analyze another role to find new gaps." : "Paste a job description or upload a screenshot — your specific skill gaps will be listed here with current vs required levels."} action={onRoadmap} /> : <><div className="grid gap-5 lg:grid-cols-3">{gaps.map((gap, index) => <div key={gap.skill} className="ns-card p-6"><div className="flex items-start justify-between"><div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${index === 0 ? "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]" : index === 1 ? "bg-[color:var(--ns-s-e8eef8)] text-[color:var(--ns-t-5b7caf)]" : "bg-[color:var(--ns-s-f9efdf)] text-[color:var(--ns-t-b57e35)]"}`}><Zap className="h-5 w-5" /></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${gap.importance === "High" ? "bg-[color:var(--ns-s-fae8e3)] text-[color:var(--ns-t-bf6756)]" : gap.importance === "Medium" ? "bg-[color:var(--ns-s-f5f1e5)] text-[color:var(--ns-t-ae7c39)]" : "bg-[color:var(--ns-s-eef1f0)] text-[color:var(--ns-t-6f8388)]"}`}>{gap.importance} priority</span></div><h2 className="mt-6 font-display text-xl font-extrabold">{gap.skill}</h2><div className="mt-5 space-y-3"><div className="flex items-center justify-between text-xs"><span className="text-[color:var(--ns-t-7d8e94)]">Current level</span><span className="font-bold text-[color:var(--ns-t-173144)]">{gap.level}</span></div><div className="flex items-center justify-between text-xs"><span className="text-[color:var(--ns-t-7d8e94)]">Required level</span><span className="font-bold text-[color:var(--ns-t-173144)]">{gap.required}</span></div></div><div className="mt-5 rounded-xl bg-[color:var(--ns-s-f7faf8)] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-85959a)]">Gap</p><p className="mt-1 text-sm font-semibold text-[color:var(--ns-t-46636c)]">{gap.gap}</p></div><button className="ns-secondary mt-5 w-full py-2.5 text-xs" onClick={onRoadmap}>Add to roadmap <Plus className="h-3.5 w-3.5" /></button></div>)}</div><div className="ns-card mt-5 flex flex-col gap-4 bg-[var(--ns-t-173144)] p-6 text-white md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--ns-t-9ed2c4)]">What this means</p><p className="mt-2 max-w-xl text-sm leading-6 text-[color:var(--ns-t-c4d5d3)]">You do not need to close every gap before applying. Focus on the skills that recur most often, then show progress through a small project.</p></div><div className="flex shrink-0 items-center gap-2 text-sm font-bold text-[color:var(--ns-t-83d0bc)]"><span>≈{totalDays} days to close these gaps</span><ArrowRight className="h-4 w-4" /></div></div></>}</>; }

function durationToDays(duration: string): number { const text = (duration ?? "").toLowerCase(); const match = text.match(/(\d+(?:\.\d+)?)/); if (!match) return 0; const value = Number.parseFloat(match[1]); if (!Number.isFinite(value) || value <= 0) return 0; if (/week/.test(text)) return Math.round(value * 7); if (/month/.test(text)) return Math.round(value * 30); return Math.round(value); }

function RoadmapView({ roadmap, done, onToggle, onGenerate, hasRoadmap }: { roadmap: Array<{ id: string; title: string; skill?: string; duration: string; why: string; resource: string; task: string }>; done: string[]; onToggle: (id: string) => void; onGenerate: () => void; hasRoadmap: boolean }) { const pending = roadmap.filter(step => !done.includes(step.id)); const completedItems = roadmap.filter(step => done.includes(step.id)); const remainingDays = pending.reduce((sum, step) => sum + durationToDays(step.duration), 0); return <><PageHeader eyebrow="Your path forward" title="Learning roadmap" detail="A visual sequence built from the real gaps in your most recent analysis. Completing a step removes its days from the plan automatically." action={<div className="flex items-center gap-2"><button className="ns-secondary" onClick={onGenerate}><Sparkles className="h-4 w-4" /> {hasRoadmap ? "Regenerate" : "Build roadmap"}</button><div className="rounded-xl bg-[color:var(--ns-s-e8f2ee)] px-4 py-2.5 text-sm font-bold text-[color:var(--ns-t-26796d)]">{completedItems.length} of {roadmap.length} complete</div></div>} />{!hasRoadmap ? <EmptyState icon={BookOpen} title="No roadmap yet" detail="Analyze an opportunity first — your missing skills become the ordered steps here, and completion is saved in SQLite." action={onGenerate} /> : <div className="ns-card overflow-hidden"><div className="border-b border-[color:var(--ns-b-edf1ef)] bg-[color:var(--ns-s-fbfdfc)] px-6 py-5"><div className="flex items-center justify-between"><div><p className="ns-label">Remaining time to close these gaps</p><p className="mt-1 font-display text-2xl font-extrabold">{pending.length ? `${remainingDays} days` : "All steps complete"}</p><p className="mt-1 text-xs text-[color:var(--ns-t-7d8e94)]">{pending.length ? `${pending.length} step${pending.length === 1 ? "" : "s"} still pending · completed steps no longer count.` : "Every skill in this roadmap is completed."}</p></div><div className="hidden items-end gap-1 sm:flex">{roadmap.map(step => <div key={step.id} className={`h-2 w-10 rounded-full ${done.includes(step.id) ? "bg-[color:var(--ns-s-62a996)]" : "bg-[color:var(--ns-s-dce9e4)]"}`} />)}</div></div></div><div className="p-6"><div className="space-y-0">{pending.map((step, index) => <div key={step.id} className="relative flex gap-5 pb-8 last:pb-0"><div className="relative z-10 flex shrink-0 flex-col items-center"><button onClick={() => onToggle(step.id)} aria-label={`Mark ${step.title} complete`} className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-[color:var(--ns-s-ffffff)] bg-[color:var(--ns-s-e7f1ee)] text-[color:var(--ns-t-6a9d92)]"><span className="text-xs font-extrabold">{index + 1}</span></button>{index < pending.length - 1 && <div className="h-full w-px bg-[color:var(--ns-s-d9e8e2)]" />}</div><div className="min-w-0 flex-1 rounded-2xl border border-[color:var(--ns-b-e5ece9)] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-display text-lg font-bold">{step.title}</p><p className="mt-2 text-sm text-[color:var(--ns-t-778990)]">{step.why}</p></div><span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[color:var(--ns-s-f2f6f4)] px-3 py-1.5 text-xs font-bold text-[color:var(--ns-t-667d84)]"><Clock3 className="h-3.5 w-3.5" />{step.duration}</span></div><div className="mt-4 grid gap-3 border-t border-[color:var(--ns-b-edf1ef)] pt-4 text-xs sm:grid-cols-2"><div><span className="font-bold text-[color:var(--ns-t-71838a)]">Suggested resource</span><p className="mt-1 text-[color:var(--ns-t-4c6872)]">{step.resource}</p></div><div><span className="font-bold text-[color:var(--ns-t-71838a)]">Mini project / task</span><p className="mt-1 text-[color:var(--ns-t-4c6872)]">{step.task}</p></div></div><RoadmapStepResources itemId={step.id} title={step.title} /></div></div>)}</div>{completedItems.length > 0 && <div className="mt-4 border-t border-[color:var(--ns-b-edf1ef)] pt-6"><div className="mb-4 flex items-center gap-3"><p className="ns-label">Completed</p><span className="rounded-full bg-[color:var(--ns-s-e5f2ed)] px-2.5 py-1 text-[10px] font-bold text-[color:var(--ns-t-3e947d)]">{completedItems.length}</span></div><div className="space-y-3">{completedItems.map(step => <div key={step.id} className="flex items-center gap-4 rounded-2xl border border-[color:var(--ns-b-e5ece9)] bg-[color:var(--ns-s-f4faf7)] p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--ns-s-62a996)] text-white"><Check className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{step.title}</p><p className="mt-0.5 text-xs text-[color:var(--ns-t-778990)]">{step.skill ? `${step.skill} · ` : ""}was {step.duration}</p></div><button className="ns-ghost px-2 py-1 text-xs" onClick={() => onToggle(step.id)}>Undo</button></div>)}</div></div>}</div></div>}</>; }

function ApplicationsView({ applications, onMove, onExplore }: { applications: AppState["applications"]; onMove: (id: string, status: Status) => void; onExplore: () => void }) { const columns: Status[] = ["Saved", "Applied", "Assessment", "Interview", "Rejected", "Selected"]; return <><PageHeader eyebrow="Keep your momentum visible" title="My applications" detail="A simple view of what is moving, what needs attention, and what to learn from. Every change is saved in SQLite." action={<button className="ns-primary" onClick={onExplore}><Plus className="h-4 w-4" /> Add opportunity</button>} /><div className="flex gap-4 overflow-x-auto pb-3">{columns.map(status => <div key={status} className="min-w-[260px] flex-1"><div className="mb-3 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${status === "Selected" ? "bg-[color:var(--ns-s-4f9c81)]" : status === "Rejected" ? "bg-[color:var(--ns-s-cd6c5d)]" : status === "Interview" ? "bg-[color:var(--ns-s-668dca)]" : "bg-[color:var(--ns-s-aebdc0)]"}`} /><p className="text-xs font-bold text-[color:var(--ns-t-60777f)]">{status}</p></div><span className="rounded-full bg-[color:var(--ns-s-e9f0ed)] px-2 py-0.5 text-[10px] font-bold text-[color:var(--ns-t-799097)]">{applications.filter(app => app.status === status).length}</span></div><div className="space-y-3">{applications.filter(app => app.status === status).map(app => <ApplicationCard key={app.id} app={app} onMove={onMove} />)}{applications.filter(app => app.status === status).length === 0 && <div className="rounded-2xl border border-dashed border-[color:var(--ns-b-d8e5e1)] px-4 py-8 text-center text-xs text-[color:var(--ns-t-9aa8aa)]">Move an application here</div>}</div></div>)}</div>{applications.length === 0 && <div className="mt-5"><EmptyState icon={FolderKanban} title="Your application journey starts here." detail="Analyze an opportunity to add your first application." action={onExplore} /></div>}</>; }

function ApplicationCard({ app, onMove }: { app: AppState["applications"][number]; onMove: (id: string, status: Status) => void }) { const next: Status = app.status === "Saved" ? "Applied" : app.status === "Applied" ? "Assessment" : app.status === "Assessment" ? "Interview" : app.status; return <div className="ns-card p-4"><div className="flex items-start justify-between gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--ns-s-eaf1ef)] text-xs font-extrabold text-[color:var(--ns-t-50757b)]">{app.company.slice(0, 1)}</div><button className="ns-ghost p-1"><MoreHorizontal className="h-4 w-4" /></button></div><p className="mt-4 text-sm font-bold leading-5">{app.title}</p><p className="mt-1 text-xs text-[color:var(--ns-t-849398)]">{app.company}</p><div className="mt-4 flex items-center justify-between text-[11px]"><span className="text-[color:var(--ns-t-8b9a9e)]">{app.date}</span><span className="font-bold text-[color:var(--ns-t-3f937d)]">{app.match}% fit</span></div><div className="mt-4 flex items-start gap-2 rounded-xl bg-[color:var(--ns-s-f6f9f7)] p-2.5 text-[11px] leading-4 text-[color:var(--ns-t-71838a)]"><Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--ns-t-7da89d)]" />{app.next}</div>{app.status === "Interview" && <AfterInterviewPanel applicationId={app.id} company={app.company} position={app.title} rejectionReason={app.rejectionReason} />}{app.tailoredResume && <div className="mt-3 rounded-xl border border-[color:var(--ns-b-d8e7e2)] bg-[color:var(--ns-s-f7fbf9)] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--ns-t-3f8d78)]">Tailored resume ready</p>{(app.tailoredChanges ?? []).slice(0, 3).map(item => <p key={item.change} className="mt-1.5 text-[11px] leading-4 text-[color:var(--ns-t-67807f)]">{item.area}: {item.change}</p>)}</div>}{next !== app.status && <button className="mt-4 w-full rounded-lg border border-[color:var(--ns-b-d8e7e2)] py-2 text-[11px] font-bold text-[color:var(--ns-t-0f7582)] hover:bg-[color:var(--ns-s-eef6f3)]" onClick={() => onMove(app.id, next)}>Move to {next}</button>}</div>; }

function FeedbackView({ category, setCategory, note, setNote, analysis, onAnalyze, isAnalyzing }: { category: string; setCategory: (value: string) => void; note: string; setNote: (value: string) => void; analysis: { area: string; insight: string; action: string; confidence: string } | null; onAnalyze: () => void; isAnalyzing: boolean }) { const categories = ["Skills", "Resume", "Experience", "Interview", "Assessment", "Eligibility", "Unknown"]; return <><PageHeader eyebrow="Learn from every signal" title="Rejection feedback" detail="Capture what happened without blaming yourself or making unsupported assumptions." action={<div className="flex items-center gap-2 text-xs text-[color:var(--ns-t-829197)]"><CircleAlert className="h-4 w-4 text-[color:var(--ns-t-d39b4e)]" /> Private to your workspace</div>} /><div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]"><div className="ns-card p-6"><p className="ns-label">What happened?</p><h2 className="mt-1 font-display text-xl font-bold">Choose the clearest signal</h2><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{categories.map(item => <button key={item} className={`rounded-xl border px-3 py-3 text-xs font-semibold ${category === item ? "border-[color:var(--ns-b-8bc6ba)] bg-[color:var(--ns-s-e8f4f0)] text-[color:var(--ns-t-0f7582)]" : "border-[color:var(--ns-b-e2ebe8)] text-[color:var(--ns-t-72858b)] hover:bg-[color:var(--ns-s-f7faf8)]"}`} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="mt-6 block"><span className="ns-label">Tell us what happened <span className="font-normal normal-case tracking-normal text-[color:var(--ns-t-a2afb1)]">(optional)</span></span><textarea className="ns-input mt-2 min-h-[150px] resize-y" placeholder="I was rejected because they wanted React experience..." value={note} onChange={event => setNote(event.target.value)} /></label><button className="ns-primary mt-5 w-full" onClick={onAnalyze} disabled={isAnalyzing}>{isAnalyzing ? <><Clock3 className="h-4 w-4 animate-pulse" /> Analyzing feedback...</> : <><Radar className="h-4 w-4" /> Analyze feedback</>}</button></div><div>{analysis ? <div className="ns-card h-full bg-[color:var(--ns-s-fbfdfc)] p-6"><div className="flex items-start justify-between"><div><p className="ns-label">Feedback analysis</p><h2 className="mt-1 font-display text-xl font-bold">A focused next action</h2></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--ns-s-e7f2ee)] text-[color:var(--ns-t-0f7582)]"><TrendingUp className="h-5 w-5" /></div></div><div className="mt-7 rounded-2xl border border-[color:var(--ns-b-e2ebe8)] bg-[color:var(--ns-s-ffffff)] p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold">Possible improvement area</p><span className="rounded-full bg-[color:var(--ns-s-f4f7f5)] px-2.5 py-1 text-[10px] font-bold text-[color:var(--ns-t-7e8f93)]">{analysis.confidence} confidence</span></div><p className="mt-3 text-sm leading-6 text-[color:var(--ns-t-667f86)]">{analysis.insight}</p></div><div className="mt-4 rounded-2xl bg-[color:var(--ns-s-e9f4ef)] p-5"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ns-t-3f8d78)]">Recommended action</p><p className="mt-2 text-sm font-semibold leading-6 text-[color:var(--ns-t-315f62)]">{analysis.action}</p></div><div className="mt-7 border-t border-[color:var(--ns-b-e8efec)] pt-5"><p className="flex items-center gap-2 text-xs text-[color:var(--ns-t-829298)]"><CheckCircle2 className="h-4 w-4 text-[color:var(--ns-t-5aa58e)]" /> Feedback saved under {analysis.area}</p></div></div> : <EmptyState icon={MessageSquareIcon} title="Your reflection will appear here." detail="Select a signal and add any context you have. The goal is a useful next step, not a perfect explanation." />}</div></div></>; }

function ProgressView({ state, insights, stats }: { state: AppState; insights: Insights; stats?: Stats }) { const skills = (stats?.frequentlyMissingSkills ?? []).slice(0, 3).map((item, index) => ({ name: item.skill, value: Math.max(20, 100 - item.count * 20), color: ["var(--ns-t-59a894)", "var(--ns-t-668dca)", "var(--ns-t-d29a4e)"][index % 3] })); return <><PageHeader eyebrow="Continuous improvement" title="Career progress" detail="See how your profile changes over time, using the work you have actually done." action={<div className="flex items-center gap-2 rounded-xl bg-[color:var(--ns-s-e8f2ee)] px-4 py-2.5 text-xs font-bold text-[color:var(--ns-t-3e8e79)]"><TrendingUp className="h-4 w-4" /> {stats?.opportunitiesAnalyzed ? `${stats.opportunitiesAnalyzed} opportunities analyzed` : "Start analyzing roles"}</div>} /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Skills in profile" value={`${state.profile.skills.length}`} delta="Stored in SQLite" icon={Zap} tint="teal" /><MetricCard label="Roadmap items closed" value={stats ? `${stats.roadmapItemsCompleted}/${stats.roadmapItemsTotal}` : "0/0"} delta="Progress is persisted" icon={CheckCircle2} tint="blue" /><MetricCard label="Average match" value={stats?.averageMatch ? `${stats.averageMatch}%` : "—"} delta="Across analyzed roles" icon={Target} tint="amber" /><MetricCard label="Feedback captured" value={`${stats?.feedbackNotes ?? state.feedbackCount}`} delta="Feeds your next action" icon={TrendingUp} tint="violet" /></div><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.85fr]"><div className="ns-card p-6"><p className="ns-label">Skills you keep missing</p><h2 className="mt-1 font-display text-xl font-bold">{skills.length ? "Your evidence is growing" : "No pattern yet"}</h2><div className="mt-8 space-y-6">{skills.length ? skills.map(skill => <div key={skill.name}><div className="mb-2 flex justify-between text-sm"><span className="font-semibold">{skill.name}</span><span className="font-bold" style={{ color: skill.color }}>{skill.value}%</span></div><ProgressBar value={skill.value} color={skill.color} /><p className="mt-2 text-xs text-[color:var(--ns-t-839298)]">Appeared as a missing requirement {(100 - skill.value) / 20} time(s) in your analyzed roles.</p></div>) : <p className="text-sm leading-6 text-[color:var(--ns-t-839298)]">Analyze a few opportunities and the skills that keep recurring will be ranked here.</p>}</div></div><div className="ns-card p-6"><p className="ns-label">Insights from your workspace</p><h2 className="mt-1 font-display text-xl font-bold">What stands out</h2><div className="mt-6 space-y-4">{insights.length ? insights.map((insight, index) => <div key={index} className={`rounded-2xl p-4 ${insight.tone === "positive" ? "bg-[color:var(--ns-s-eef6f3)]" : insight.tone === "watch" ? "bg-[color:var(--ns-s-f9f1e4)]" : "bg-[color:var(--ns-s-eef0f8)]"}`}><div className="flex gap-3">{insight.tone === "watch" ? <CircleAlert className="mt-1 h-4 w-4 text-[color:var(--ns-t-c08c4d)]" /> : <ArrowDownRight className="mt-1 h-4 w-4 text-[color:var(--ns-t-3d9a83)]" />}<div><p className="text-xs font-bold">{insight.title}</p><p className="mt-1 text-sm leading-6 text-[color:var(--ns-t-456a70)]">{insight.body}</p></div></div></div>) : <p className="text-sm leading-6 text-[color:var(--ns-t-839298)]">Insights appear once you have analyzed opportunities and tracked applications. Everything here is derived from your stored data only.</p>}</div></div></div><div className="ns-card mt-5 p-6"><div className="flex items-center justify-between"><div><p className="ns-label">Activity summary</p><h2 className="mt-1 font-display text-xl font-bold">Small steps, visible over time</h2></div><CalendarDays className="h-5 w-5 text-[color:var(--ns-t-7ea099)]" /></div><div className="mt-6 grid gap-3 md:grid-cols-4"><Activity label="Opportunities analyzed" date={`${stats?.opportunitiesAnalyzed ?? 0}`} /><Activity label="Applications tracked" date={`${stats?.applications ?? 0}`} /><Activity label="Roadmap items complete" date={`${stats?.roadmapItemsCompleted ?? 0}`} /><Activity label="Feedback notes" date={`${stats?.feedbackNotes ?? 0}`} /></div></div></>; }
function Activity({ label, date }: { label: string; date: string }) { return <div className="flex items-center gap-3 rounded-xl bg-[color:var(--ns-s-f7faf8)] p-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--ns-s-e1f1eb)] text-[color:var(--ns-t-2e917b)]"><Check className="h-4 w-4" /></div><div><p className="text-xs font-bold">{label}</p><p className="mt-1 text-[10px] text-[color:var(--ns-t-89989d)]">{date}</p></div></div>; }

function SettingsView({ settings, setSettings, onReset, mode, model, theme, onToggleTheme }: { settings: { weeklyDigest: boolean; deadlineAlerts: boolean; profileVisibility: boolean }; setSettings: React.Dispatch<React.SetStateAction<{ weeklyDigest: boolean; deadlineAlerts: boolean; profileVisibility: boolean }>>; onReset: () => void; mode: string; model: string; theme: string; onToggleTheme: () => void }) { return <><PageHeader eyebrow="Your workspace" title="Settings" detail="Choose what helps you stay consistent. Career data is stored in your local SQLite database." /><div className="grid gap-5 lg:grid-cols-[1fr_0.7fr]"><div className="ns-card divide-y divide-[color:var(--ns-b-edf1ef)]"><SettingRow icon={theme === "dark" ? Sun : Moon} title="Dark mode" body="Applies the dark theme across the entire workspace. Your choice is remembered on this device." checked={theme === "dark"} onChange={onToggleTheme} /><SettingRow icon={Bell} title="Weekly progress digest" body="A short summary of your progress and next best move." checked={settings.weeklyDigest} onChange={() => setSettings(prev => ({ ...prev, weeklyDigest: !prev.weeklyDigest }))} /><SettingRow icon={CalendarDays} title="Deadline reminders" body="Get a gentle reminder when a saved opportunity is approaching." checked={settings.deadlineAlerts} onChange={() => setSettings(prev => ({ ...prev, deadlineAlerts: !prev.deadlineAlerts }))} /><SettingRow icon={UsersRound} title="Profile visibility" body="Keeps your profile private to this workspace." checked={settings.profileVisibility} onChange={() => setSettings(prev => ({ ...prev, profileVisibility: !prev.profileVisibility }))} /></div><div className="ns-card p-6"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--ns-s-eaf1ef)] text-[color:var(--ns-t-4b7880)]"><LockKeyhole className="h-5 w-5" /></div><h2 className="mt-5 font-display text-xl font-bold">{mode === "real" ? "Real AI mode" : "Demo mode"}</h2><p className="mt-3 text-sm leading-6 text-[color:var(--ns-t-7c8b91)]">{mode === "real" ? <>A valid Gemini API key is configured, so every analysis calls Gemini. The model in use is <span className="font-bold text-[color:var(--ns-t-45606a)]">{model}</span>. An API failure is reported as an error — never replaced with a fake result.</> : <>No <span className="font-semibold">GEMINI_API_KEY</span> is configured, so NextStep is using deterministic local analysis derived from your uploaded text. Add the key to <span className="font-semibold">.env</span> and restart to switch to real AI.</>}</p><div className="mt-6 rounded-xl bg-[color:var(--ns-s-f7faf8)] p-4 text-xs leading-5 text-[color:var(--ns-t-71838a)]">Profile, resume, opportunities, analyses, roadmaps, applications and feedback are all persisted locally. Restarting the server keeps your data.</div><button className="ns-secondary mt-6 w-full" onClick={onReset}>Clear stored profile data</button></div></div></>; }
function SettingRow({ icon: Icon, title, body, checked, onChange }: { icon: React.ElementType; title: string; body: string; checked: boolean; onChange: () => void }) { return <div className="flex items-center gap-4 p-6"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--ns-s-eef5f2)] text-[color:var(--ns-t-0f7582)]"><Icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-[color:var(--ns-t-85949a)]">{body}</p></div><button aria-label={title} onClick={onChange} className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-[color:var(--ns-s-0f8585)]" : "bg-[color:var(--ns-s-d5e1de)]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} /></button></div>; }

function ArrowUpRight(props: React.ComponentProps<typeof ArrowRight>) { return <ArrowRight {...props} className={`${props.className ?? ""} rotate-[-45deg]`} />; }


type NotificationItem = { id: number; type: string; title: string; body: string; link: string; read: boolean; createdAt: string };

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

const NOTIF_ICON: Record<string, React.ElementType> = { analysis: Radar, skill_completed: GraduationCap, resume: FileText, roadmap: BookOpen, system: Bell };

function NotificationsPanel({ notifications, unreadCount, onOpen, onMarkAllRead, onDelete, deletingId }: { notifications: NotificationItem[]; unreadCount: number; onOpen: (n: NotificationItem) => void; onMarkAllRead: () => void; onDelete: (n: NotificationItem) => void; deletingId: number | null }) {
  return <div className="flex max-h-[460px] w-full flex-col"><div className="flex items-center justify-between border-b border-[color:var(--ns-b-edf1ef)] px-5 py-4"><div><p className="ns-label">Notifications</p><p className="mt-0.5 text-xs text-[color:var(--ns-t-7d8e94)]">{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</p></div>{unreadCount > 0 && <button className="ns-ghost px-2 py-1 text-xs" onClick={onMarkAllRead}>Mark all read</button>}</div><div className="flex-1 overflow-y-auto">{notifications.length === 0 && <div className="px-5 py-10 text-center"><Bell className="mx-auto h-6 w-6 text-[color:var(--ns-t-a1afb1)]" /><p className="mt-3 text-sm font-semibold">No notifications yet</p><p className="mt-1 text-xs text-[color:var(--ns-t-7d8e94)]">Analyze an opportunity or complete a roadmap skill and it will show up here.</p></div>}{notifications.map(n => { const Icon = NOTIF_ICON[n.type] ?? Bell; return <div key={n.id} role="button" tabIndex={0} className={`flex w-full cursor-pointer items-start gap-3 border-b border-[color:var(--ns-b-edf1ef)] px-5 py-4 text-left last:border-b-0 ${n.read ? "" : "bg-[color:var(--ns-s-f4faf7)]"}`} onClick={() => onOpen(n)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(n); } }}><div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${n.read ? "bg-[color:var(--ns-s-eef5f2)] text-[color:var(--ns-t-0f7582)]" : "bg-[color:var(--ns-s-e3f2ed)] text-[color:var(--ns-t-15807b)]"}`}><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className={`truncate text-sm ${n.read ? "font-semibold" : "font-bold"}`}>{n.title}</p>{!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--ns-s-e27d62)]" />}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--ns-t-7d8e94)]">{n.body}</p><p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--ns-t-a1afb1)]">{timeAgo(n.createdAt)}</p></div><button className="ns-ghost mt-0.5 shrink-0 p-1.5" aria-label={`Delete notification: ${n.title}`} title="Delete notification" disabled={deletingId === n.id} onClick={event => { event.stopPropagation(); onDelete(n); }}>{deletingId === n.id ? <Clock3 className="h-3.5 w-3.5 animate-pulse" /> : <Trash2 className="h-3.5 w-3.5 text-[color:var(--ns-t-c66b57)]" />}</button></div>; })}</div></div>;
}
