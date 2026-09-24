/**
 * Learning-resource suggestions for roadmap tasks.
 *
 * Flow (mirrors the rest of the app):
 *   - Real mode (GEMINI_API_KEY set): Gemini proposes resources for the exact
 *     skill + the language the user picked. Every returned URL is then verified
 *     with a live HTTP request; unverifiable/dead links are dropped. If Gemini
 *     returns nothing usable we fall back to the curated catalog below.
 *   - Demo mode (no key): the curated catalog is used.
 *
 * Hard rule: no invented URLs. Every URL that reaches the UI is either a live
 * curated link that answered an HTTP request, or a search URL on a real
 * platform (which always resolves). This is why plain "search" links are used
 * instead of guessed video IDs.
 */
import { GeminiError, generateJson, getApiKey } from "./gemini";
import { RESOURCE_SCHEMA, buildLearningResourcePrompt } from "./prompts";
import type { AnalysisResultEngine, LearningResource, ResourceKind } from "./serviceTypes";

export type ResourceLanguage = {
  id: string;
  label: string;
  native: string;
  searchTerm: string;
};

/** Languages offered by the "Find Learning Resources" flow. */
export const RESOURCE_LANGUAGES: ResourceLanguage[] = [
  { id: "English", label: "English", native: "English", searchTerm: "english" },
  { id: "Hindi", label: "Hindi", native: "हिन्दी", searchTerm: "hindi" },
  { id: "Hinglish", label: "Hinglish", native: "Hinglish", searchTerm: "hindi" },
  { id: "Bengali", label: "Bengali", native: "বাংলা", searchTerm: "bengali" },
  { id: "Tamil", label: "Tamil", native: "தமிழ்", searchTerm: "tamil" },
  { id: "Telugu", label: "Telugu", native: "తెలుగు", searchTerm: "telugu" },
  { id: "Marathi", label: "Marathi", native: "मराठी", searchTerm: "marathi" },
  { id: "Kannada", label: "Kannada", native: "ಕನ್ನಡ", searchTerm: "kannada" },
  { id: "Malayalam", label: "Malayalam", native: "മലയാളം", searchTerm: "malayalam" },
  { id: "Gujarati", label: "Gujarati", native: "ગુજરાતી", searchTerm: "gujarati" },
  { id: "Punjabi", label: "Punjabi", native: "ਪੰਜਾਬੀ", searchTerm: "punjabi" },
  { id: "Urdu", label: "Urdu", native: "اردو", searchTerm: "urdu" },
];

export function defaultLanguage(): string {
  return RESOURCE_LANGUAGES[0].id;
}

export function normalizeLanguage(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return defaultLanguage();
  const match = RESOURCE_LANGUAGES.find(
    item => item.id.toLowerCase() === raw.toLowerCase() || item.label.toLowerCase() === raw.toLowerCase(),
  );
  return match?.id ?? defaultLanguage();
}

function languageSearchTerm(language: string): string {
  const match = RESOURCE_LANGUAGES.find(item => item.id === language);
  return match?.searchTerm ?? "english";
}

/* ------------------------------------------------------------------ */
/* Curated, real resources (demo mode + safety net for real mode)      */
/* ------------------------------------------------------------------ */

type CatalogEntry = { kind: ResourceKind; title: string; url: string; source: string };

/** Official / free-learning sites keyed by a lowercase skill (or skill part). */
const SKILL_SITES: Record<string, CatalogEntry[]> = {
  react: [
    { kind: "website", title: "React — official tutorial", url: "https://react.dev/learn", source: "react.dev" },
  ],
  javascript: [
    { kind: "website", title: "MDN — JavaScript guide", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide", source: "MDN" },
    { kind: "course", title: "javascript.info — the modern JS tutorial", url: "https://javascript.info/", source: "javascript.info" },
  ],
  typescript: [
    { kind: "website", title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs/handbook/intro.html", source: "typescriptlang.org" },
  ],
  node: [
    { kind: "website", title: "Node.js — official docs", url: "https://nodejs.org/en/docs", source: "nodejs.org" },
    { kind: "website", title: "Express — official guide", url: "https://expressjs.com/en/guide/routing.html", source: "expressjs.com" },
  ],
  express: [
    { kind: "website", title: "Express.js — official guide", url: "https://expressjs.com/en/starter/installing.html", source: "expressjs.com" },
  ],
  html: [
    { kind: "website", title: "MDN — HTML basics", url: "https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/HTML_basics", source: "MDN" },
  ],
  css: [
    { kind: "website", title: "MDN — CSS first steps", url: "https://developer.mozilla.org/en-US/docs/Learn/CSS/First_steps", source: "MDN" },
    { kind: "course", title: "web.dev — Learn CSS", url: "https://web.dev/learn/css", source: "web.dev" },
  ],
  tailwind: [
    { kind: "website", title: "Tailwind CSS — official docs", url: "https://tailwindcss.com/docs/installation", source: "tailwindcss.com" },
  ],
  next: [
    { kind: "course", title: "Next.js — official Learn course", url: "https://nextjs.org/learn", source: "nextjs.org" },
  ],
  vue: [
    { kind: "website", title: "Vue.js — official guide", url: "https://vuejs.org/guide/introduction.html", source: "vuejs.org" },
  ],
  angular: [
    { kind: "website", title: "Angular — official tutorial", url: "https://angular.dev/tutorials", source: "angular.dev" },
  ],
  sql: [
    { kind: "course", title: "SQLBolt — interactive SQL lessons", url: "https://sqlbolt.com/", source: "SQLBolt" },
    { kind: "website", title: "PostgreSQL — official tutorial", url: "https://www.postgresql.org/docs/current/tutorial.html", source: "postgresql.org" },
  ],
  mysql: [
    { kind: "website", title: "MySQL — official reference manual", url: "https://dev.mysql.com/doc/refman/8.4/en/tutorial.html", source: "dev.mysql.com" },
  ],
  sqlite: [
    { kind: "website", title: "SQLite — official documentation", url: "https://sqlite.org/docs.html", source: "sqlite.org" },
  ],
  mongo: [
    { kind: "website", title: "MongoDB — official manual", url: "https://www.mongodb.com/docs/manual/tutorial/getting-started/", source: "mongodb.com" },
  ],
  "rest api": [
    { kind: "website", title: "MDN — Fetch API", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch", source: "MDN" },
    { kind: "course", title: "Postman Learning Center", url: "https://learning.postman.com/docs/getting-started/introduction/", source: "Postman" },
  ],
  api: [
    { kind: "website", title: "MDN — HTTP overview", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview", source: "MDN" },
  ],
  git: [
    { kind: "website", title: "Pro Git — free official book", url: "https://git-scm.com/book/en/v2", source: "git-scm.com" },
    { kind: "course", title: "GitHub Skills — hands-on courses", url: "https://skills.github.com/", source: "GitHub" },
  ],
  python: [
    { kind: "website", title: "Python — official tutorial", url: "https://docs.python.org/3/tutorial/index.html", source: "python.org" },
    { kind: "course", title: "Kaggle Learn — Python", url: "https://www.kaggle.com/learn/python", source: "Kaggle" },
  ],
  java: [
    { kind: "website", title: "Dev.java — official Java tutorials", url: "https://dev.java/learn/", source: "dev.java" },
  ],
  "c++": [
    { kind: "website", title: "learncpp.com — free C++ tutorials", url: "https://www.learncpp.com/", source: "learncpp.com" },
  ],
  docker: [
    { kind: "course", title: "Docker — official getting-started workshop", url: "https://docs.docker.com/get-started/", source: "docker.com" },
  ],
  kubernetes: [
    { kind: "website", title: "Kubernetes — official tutorials", url: "https://kubernetes.io/docs/tutorials/", source: "kubernetes.io" },
  ],
  testing: [
    { kind: "website", title: "Jest — getting started", url: "https://jestjs.io/docs/getting-started", source: "jestjs.io" },
    { kind: "website", title: "Testing Library — documentation", url: "https://testing-library.com/docs/", source: "testing-library.com" },
  ],
  "data analys": [
    { kind: "course", title: "Kaggle Learn — Pandas", url: "https://www.kaggle.com/learn/pandas", source: "Kaggle" },
    { kind: "website", title: "pandas — official getting-started guide", url: "https://pandas.pydata.org/docs/getting_started/index.html", source: "pandas.pydata.org" },
  ],
  excel: [
    { kind: "course", title: "Microsoft — Excel training", url: "https://support.microsoft.com/en-us/office/excel-video-training-9bc05390-e94c-46af-a5b3-d7c22f6990bb", source: "Microsoft" },
  ],
  powerbi: [
    { kind: "course", title: "Microsoft Learn — Power BI", url: "https://learn.microsoft.com/en-us/training/powerplatform/power-bi", source: "Microsoft Learn" },
  ],
  tableau: [
    { kind: "course", title: "Tableau — free training videos", url: "https://www.tableau.com/learn/training/20241", source: "Tableau" },
  ],
  machine: [
    { kind: "course", title: "Kaggle Learn — Intro to Machine Learning", url: "https://www.kaggle.com/learn/intro-to-machine-learning", source: "Kaggle" },
    { kind: "website", title: "scikit-learn — official user guide", url: "https://scikit-learn.org/stable/user_guide.html", source: "scikit-learn.org" },
  ],
  tensorflow: [
    { kind: "website", title: "TensorFlow — official tutorials", url: "https://www.tensorflow.org/tutorials", source: "tensorflow.org" },
  ],
  pytorch: [
    { kind: "website", title: "PyTorch — official tutorials", url: "https://pytorch.org/tutorials/", source: "pytorch.org" },
  ],
  numpy: [
    { kind: "website", title: "NumPy — official quickstart", url: "https://numpy.org/doc/stable/user/quickstart.html", source: "numpy.org" },
  ],
  communication: [
    { kind: "course", title: "Coursera — Improving Communication Skills", url: "https://www.coursera.org/learn/wharton-communication-skills", source: "Coursera" },
  ],
  leadership: [
    { kind: "course", title: "Coursera — Leading People and Teams", url: "https://www.coursera.org/specializations/leading-teams", source: "Coursera" },
  ],
  aptitude: [
    { kind: "course", title: "IndiaBIX — aptitude practice", url: "https://www.indiabix.com/aptitude/questions-and-answers/", source: "IndiaBIX" },
  ],
  os: [
    { kind: "website", title: "OSTEP — free operating systems book", url: "https://pages.cs.wisc.edu/~remzi/OSTEP/", source: "OSTEP" },
  ],
  dbms: [
    { kind: "website", title: "GeeksforGeeks — DBMS tutorial", url: "https://www.geeksforgeeks.org/dbms/", source: "GeeksforGeeks" },
  ],
  "computer network": [
    { kind: "website", title: "GeeksforGeeks — Computer Network tutorial", url: "https://www.geeksforgeeks.org/computer-network-tutorials/", source: "GeeksforGeeks" },
  ],
};

/** Free platforms that cover almost any software skill. */
const GENERIC_ENTRIES: CatalogEntry[] = [
  { kind: "course", title: "freeCodeCamp — free certifications and courses", url: "https://www.freecodecamp.org/learn", source: "freeCodeCamp" },
  { kind: "course", title: "The Odin Project — free full-stack curriculum", url: "https://www.theodinproject.com/paths", source: "The Odin Project" },
  { kind: "course", title: "NPTEL — free engineering courses (IIT/IISc)", url: "https://nptel.ac.in/course.html", source: "NPTEL" },
  { kind: "course", title: "SWAYAM — free Indian government courses", url: "https://swayam.gov.in/", source: "SWAYAM" },
  { kind: "course", title: "Great Learning Academy — free courses", url: "https://www.mygreatlearning.com/academy", source: "Great Learning" },
  { kind: "course", title: "Microsoft Learn — free hands-on training", url: "https://learn.microsoft.com/en-us/training/", source: "Microsoft Learn" },
  { kind: "website", title: "MDN Web Docs — web platform reference", url: "https://developer.mozilla.org/en-US/", source: "MDN" },
  { kind: "website", title: "GeeksforGeeks — programming tutorials", url: "https://www.geeksforgeeks.org/", source: "GeeksforGeeks" },
  { kind: "website", title: "CodewithHarry — free courses and notes", url: "https://www.codewithharry.com/", source: "CodeWithHarry" },
  { kind: "course", title: "Harvard CS50 — free computer science course", url: "https://cs50.harvard.edu/x/", source: "Harvard" },
  { kind: "website", title: "W3Schools — tutorials and references", url: "https://www.w3schools.com/", source: "W3Schools" },
];

/** Real YouTube channels / search entry points (never guessed video IDs). */
const YOUTUBE_CHANNELS: Array<{ language: string; title: string; url: string }> = [
  { language: "English", title: "freeCodeCamp.org — full courses on YouTube", url: "https://www.youtube.com/@freecodecamp" },
  { language: "English", title: "Traversy Media — practical web development", url: "https://www.youtube.com/@TraversyMedia" },
  { language: "English", title: "Telusko — Java, Python and DSA", url: "https://www.youtube.com/@Telusko" },
  { language: "English", title: "NPTEL — IIT lectures on YouTube", url: "https://www.youtube.com/@nptelhrd" },
  { language: "Hindi", title: "CodeWithHarry — Hindi programming courses", url: "https://www.youtube.com/@CodeWithHarry" },
  { language: "Hindi", title: "Apna College — Hindi DSA and development", url: "https://www.youtube.com/@ApnaCollegeOfficial" },
  { language: "Hindi", title: "Thapa Technical — Hindi web development", url: "https://www.youtube.com/@ThapaTechnical" },
  { language: "Hindi", title: "WsCube Tech — Hindi tech tutorials", url: "https://www.youtube.com/@wscubetech" },
  { language: "Hinglish", title: "CodeWithHarry — Hindi/Hinglish programming courses", url: "https://www.youtube.com/@CodeWithHarry" },
  { language: "Hinglish", title: "Apna College — Hindi/Hinglish DSA and development", url: "https://www.youtube.com/@ApnaCollegeOfficial" },
];

function youtubeSearch(skill: string, language: string, playlist: boolean): string {
  const term = languageSearchTerm(language);
  const query = playlist
    ? `${skill} full course ${term} playlist`
    : `${skill} tutorial ${term}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function platformSearch(skill: string, language: string): CatalogEntry {
  return {
    kind: "course",
    title: `freeCodeCamp — search “${skill}” courses (${language})`,
    url: `https://www.freecodecamp.org/news/search?query=${encodeURIComponent(skill)}`,
    source: "freeCodeCamp",
  };
}

/** Build the curated candidate list for a skill + language (not yet verified). */
export function catalogFor(skill: string, language: string): CatalogEntry[] {
  const rawSkill = (skill || "").trim();
  const key = rawSkill.toLowerCase();
  const entries: CatalogEntry[] = [];

  const skillMatches = Object.entries(SKILL_SITES).filter(([name]) => key.includes(name));
  for (const [, list] of skillMatches.slice(0, 3)) entries.push(...list);

  // Language-specific YouTube entries come first so the language preference
  // visibly shapes the recommendations.
  const channels = YOUTUBE_CHANNELS.filter(channel => channel.language === language);
  const isEnglish = language === "English";
  for (const channel of channels) {
    entries.push({
      kind: "youtube_playlist",
      title: `${channel.title} — playlists for ${rawSkill || "your skill"}`,
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${rawSkill || "programming"} ${languageSearchTerm(language)} full course`)}`,
      source: "YouTube",
    });
    entries.push({
      kind: "youtube_video",
      title: `${channel.title} — ${rawSkill || "topic"} videos`,
      url: channel.url,
      source: channel.title,
    });
  }
  if (!channels.length && !isEnglish) {
    entries.push({
      kind: "youtube_playlist",
      title: `YouTube — free ${rawSkill} full courses in ${language}`,
      url: youtubeSearch(rawSkill, language, true),
      source: "YouTube",
    });
    entries.push({
      kind: "youtube_video",
      title: `YouTube — ${rawSkill} tutorials in ${language}`,
      url: youtubeSearch(rawSkill, language, false),
      source: "YouTube",
    });
  }
  if (isEnglish) {
    entries.push({
      kind: "youtube_playlist",
      title: `YouTube — free ${rawSkill} full-course playlists`,
      url: youtubeSearch(rawSkill, "English", true),
      source: "YouTube",
    });
  }

  entries.push(platformSearch(rawSkill, language));
  entries.push(...GENERIC_ENTRIES);

  // De-duplicate by URL, cap the candidate set.
  const seen = new Set<string>();
  const unique: CatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.url?.startsWith("http") || seen.has(entry.url)) continue;
    seen.add(entry.url);
    unique.push(entry);
  }
  return unique.slice(0, 24);
}

/* ------------------------------------------------------------------ */
/* URL verification                                                    */
/* ------------------------------------------------------------------ */

async function urlAlive(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(7000),
    });
    // 403/429 mean the link exists but blocks bots — still a real URL.
    return response.status < 400 || response.status === 403 || response.status === 429;
  } catch {
    return false;
  }
}

/** Verify candidate URLs in parallel and keep only the ones that resolve. */
export async function verifyResources(
  resources: Array<Omit<LearningResource, "id" | "verified">>,
): Promise<LearningResource[]> {
  const checks = await Promise.all(
    resources.map(async resource => ({ resource, alive: await urlAlive(resource.url) })),
  );
  const alive = checks.filter(item => item.alive).map(item => ({ ...item.resource, verified: true }));

  // Never return an empty list: if live verification failed everywhere (offline
  // sandbox, blocked network), keep the curated rows but mark them unverified so
  // the UI can say so honestly instead of hiding the feature.
  if (alive.length) return alive;
  return resources.map(resource => ({ ...resource, verified: false }));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type SuggestInput = {
  skill: string;
  itemTitle?: string;
  taskDescription?: string;
  targetOpportunity?: string;
  language: string;
  /** Skills recurring in accumulated rejection feedback (context only). */
  rejectionSkills?: string[];
};

function kindOrder(kind: ResourceKind): number {
  return ["youtube_video", "youtube_playlist", "course", "website"].indexOf(kind);
}

function ensureKindCoverage(resources: LearningResource[]): LearningResource[] {
  const sorted = [...resources].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
  const seen = new Set<string>();
  const result: LearningResource[] = [];
  for (const item of sorted) {
    const key = `${item.kind}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Suggest learning resources for one roadmap task in the user's language.
 * Real Gemini first (URLs verified), curated catalog as the guaranteed floor.
 */
export async function suggestLearningResources(
  input: SuggestInput,
): Promise<{ resources: LearningResource[]; engine: AnalysisResultEngine }> {
  const language = normalizeLanguage(input.language);
  const skill = (input.skill || input.itemTitle || "your next skill").trim();

  if (getApiKey()) {
    try {
      const parsed = await generateJson<{
        resources?: Array<{ kind?: string; title?: string; url?: string; source?: string; language?: string }>;
      }>({
        prompt: buildLearningResourcePrompt({
          skill,
          itemTitle: input.itemTitle ?? "",
          taskDescription: input.taskDescription ?? "",
          targetOpportunity: input.targetOpportunity ?? "",
          language,
          rejectionSkills: input.rejectionSkills ?? [],
        }),
        schema: RESOURCE_SCHEMA as unknown as Record<string, unknown>,
        operation: "suggestLearningResources",
      });

      const candidates = (parsed.resources ?? [])
        .filter(item => item && typeof item.url === "string" && /^https?:\/\//i.test(item.url))
        .filter(item => typeof item.title === "string" && item.title.trim())
        .slice(0, 12)
        .map(item => ({
          roadmapItemId: 0,
          opportunityId: null,
          skill,
          language,
          kind: (["youtube_video", "youtube_playlist", "course", "website"] as ResourceKind[]).includes(
            String(item.kind) as ResourceKind,
          )
            ? (String(item.kind) as ResourceKind)
            : ("website" as ResourceKind),
          title: String(item.title).trim().slice(0, 200),
          url: String(item.url).trim(),
          source: typeof item.source === "string" && item.source.trim() ? item.source.trim().slice(0, 120) : new URL(String(item.url)).hostname,
          engine: "gemini" as AnalysisResultEngine,
        }));

      const verified = await verifyResources(candidates);
      if (verified.length >= 3) {
        return { resources: ensureKindCoverage(verified).slice(0, 10), engine: "gemini" };
      }
      console.warn(
        `[Resources] Gemini returned ${verified.length} verifiable link(s) for "${skill}" — using the curated catalog instead.`,
      );
    } catch (error) {
      // A real Gemini failure is reported, but resource discovery still has a
      // deterministic, verifiable floor — the UI stays usable.
      console.error(
        `[Resources] Gemini suggestion failed · ${error instanceof GeminiError ? `${error.kind}/${error.status}` : "unknown"}`,
      );
    }
  }

  const curated = await verifyResources(
    catalogFor(skill, language).map(entry => ({
      roadmapItemId: 0,
      opportunityId: null,
      skill,
      language,
      kind: entry.kind,
      title: entry.title,
      url: entry.url,
      source: entry.source,
      engine: "demo" as AnalysisResultEngine,
    })),
  );

  const picked = ensureKindCoverage(curated);
  const perKind = new Map<ResourceKind, number>();
  const balanced: LearningResource[] = [];
  for (const item of picked) {
    const count = perKind.get(item.kind) ?? 0;
    if (count >= 3) continue;
    perKind.set(item.kind, count + 1);
    balanced.push(item);
  }

  return { resources: balanced.slice(0, 8), engine: "demo" };
}
