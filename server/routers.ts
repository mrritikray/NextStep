import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import * as repo from "./db/repositories";
import {
  AiUnavailableError,
  analyzeOpportunity,
  analyzeRejection,
  analyzeResume,
  analyzeResume as analyzeResumeText_,
  analyzeResumeFull,
  applyGapNotes,
  extractJobRequirements,
  extractProfileFromResume,
  generateInsights,
  generateRoadmap,
  generateRoadmapWithGapNotes,
  generateTailoredResume,
  getModeInfo,
  improveResume,
} from "./services/aiService";
import type { RoadmapComputation } from "./services/aiService";
import { recentAiActions } from "./services/aiUsage";
import { decodeBase64Payload, extractResumeText, validateUpload } from "./services/fileProcessing";
import {
  RESOURCE_LANGUAGES,
  defaultLanguage,
  normalizeLanguage,
  suggestLearningResources,
} from "./services/learningResources";
import { normalizeSkill } from "./services/matching";
import { APPLICATION_STATUSES } from "./services/types";
import type { ApplicationStatus, LearningResource, Roadmap, SkillGap } from "./services/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function toTrpcError(error: unknown, fallback: string): TRPCError {
  if (error instanceof AiUnavailableError) {
    return new TRPCError({ code: "BAD_GATEWAY", message: error.message });
  }
  if (error instanceof TRPCError) return error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[API] ${fallback} · ${message}`);
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallback });
}

function requireProfile() {
  const profile = repo.getProfile();
  if (!profile) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Create your profile first, then try again.",
    });
  }
  return profile;
}

const profileInput = z.object({
  name: z.string().max(160).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  location: z.string().max(160).optional(),
  preferredWorkLocation: z.string().max(120).optional(),
  college: z.string().max(200).optional(),
  degree: z.string().max(160).optional(),
  branch: z.string().max(160).optional(),
  graduationYear: z.string().max(20).optional(),
  cgpa: z.string().max(40).optional(),
  careerObjective: z.string().max(1200).optional(),
  skills: z.array(z.string().max(60)).max(80).optional(),
  projects: z
    .array(
      z.object({
        title: z.string().max(200),
        description: z.string().max(2000).optional().default(""),
        technologies: z.array(z.string().max(60)).max(30).optional().default([]),
        link: z.string().max(300).optional().default(""),
      }),
    )
    .max(30)
    .optional(),
  experience: z
    .array(
      z.object({
        company: z.string().max(200).optional().default(""),
        role: z.string().max(200).optional().default(""),
        duration: z.string().max(80).optional().default(""),
        description: z.string().max(2000).optional().default(""),
      }),
    )
    .max(30)
    .optional(),
  certifications: z
    .array(
      z.object({
        name: z.string().max(200),
        issuer: z.string().max(200).optional().default(""),
        year: z.string().max(20).optional().default(""),
      }),
    )
    .max(30)
    .optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

const uploadInput = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(160),
  fileSize: z.number().int().nonnegative(),
  /** base64 payload without the data: prefix (or with it — both are handled). */
  base64: z.string().min(4),
});

/** Frequency of a skill across all stored analyses — drives gap importance. */
function skillFrequencyMap(): Record<string, number> {
  const frequency: Record<string, number> = {};
  for (const analysis of repo.listAnalyses(200)) {
    for (const skill of analysis.missingSkills) {
      const key = normalizeSkill(skill);
      if (key) frequency[key] = (frequency[key] ?? 0) + 1;
    }
  }
  return frequency;
}

function resolveOpportunityTarget(opportunityId?: number) {
  if (opportunityId) {
    const opportunity = repo.getOpportunity(opportunityId);
    if (!opportunity) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That opportunity could not be found." });
    }
    const analysis = repo.getLatestAnalysisForOpportunity(opportunityId);
    return { opportunity, analysis };
  }

  const latest = repo.listAnalyses(1)[0];
  if (!latest?.opportunityId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Analyze an opportunity first, then build a roadmap from its gaps.",
    });
  }
  const opportunity = repo.getOpportunity(latest.opportunityId);
  if (!opportunity) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That opportunity could not be found." });
  }
  return { opportunity, analysis: latest };
}

/**
 * Resolve the roadmap targets for ONE opportunity: the deterministic gap list
 * (optionally fresh from a just-computed match, before it is saved) plus
 * accumulated rejection feedback moved to the front. Used by BOTH the combined
 * plan request and the persisted roadmap so the plan closes exactly the gaps
 * that were saved.
 */
function resolveRoadmapTargets(
  opportunity: NonNullable<ReturnType<typeof repo.getOpportunity>>,
  analysis: { skillGaps: SkillGap[]; missingSkills: string[] } | null,
  freshGaps?: SkillGap[],
): { gaps: SkillGap[]; targetSkills: string[] } {
  const gaps = freshGaps ?? analysis?.skillGaps ?? [];
  const baseTargets = gaps.length
    ? gaps.map(gap => gap.skill)
    : analysis?.missingSkills ?? opportunity.requiredSkills;

  const rejectionSkills = repo.accumulateRejectionSkillCounts().map(item => item.skill);
  const prioritised = rejectionSkills.filter(skill =>
    baseTargets.some(target => normalizeSkill(target) === normalizeSkill(skill)),
  );
  return { gaps, targetSkills: Array.from(new Set([...prioritised, ...baseTargets])) };
}

/**
 * Build (and persist) the learning roadmap for ONE opportunity.
 *
 * Ordering is explicit and stable: createRoadmap stores each item with its own
 * `position` index, and completion only ever flips a status flag — items are
 * never renamed or re-indexed, so "Task 2" stays "Task 2".
 *
 * `precomputed` carries the items of the combined roadmap+gap-notes request
 * made by the job-analysis flow, so no second Gemini request is spent here.
 *
 * Skills that keep appearing in accumulated rejection feedback are moved to the
 * front of the plan when they are also gaps for this role.
 */
async function buildRoadmapForOpportunity(
  opportunityId: number,
  precomputed?: RoadmapComputation,
): Promise<Roadmap | null> {
  const opportunity = repo.getOpportunity(opportunityId);
  if (!opportunity) return null;

  const profile = repo.getProfile();
  const analysis = repo.getLatestAnalysisForOpportunity(opportunityId);
  const { gaps, targetSkills } = resolveRoadmapTargets(opportunity, analysis);

  const targetOpportunity = `${opportunity.jobTitle} at ${opportunity.company}`;
  const { estimatedDuration, items, engine } = precomputed
    ? {
        estimatedDuration: precomputed.estimatedDuration,
        items: precomputed.items,
        engine: precomputed.engine,
      }
    : await generateRoadmap({
        targetOpportunity,
        targetSkills,
        gaps,
        profile,
      });

  return repo.createRoadmap({
    profileId: profile?.id ?? null,
    opportunityId: opportunity.id,
    targetOpportunity,
    targetSkills,
    estimatedDuration,
    engine: engine === "gemini" ? "gemini" : "rules",
    items,
  });
}

/**
 * Persist an analysis result, archive the previously active opportunity, make
 * the new opportunity current and immediately build its roadmap so Overview,
 * Skill Analysis and Learning Roadmap all reflect it at once.
 */
async function activateAnalyzedOpportunity(opportunityId: number, precomputed?: RoadmapComputation) {
  const archived = repo.archiveCurrentOpportunity();

  let roadmap: Roadmap | null = null;
  let roadmapError: string | null = null;
  try {
    roadmap = await buildRoadmapForOpportunity(opportunityId, precomputed);
  } catch (error) {
    roadmap = null;
    roadmapError = error instanceof Error ? error.message : "Roadmap generation failed.";
    console.error(`[API] auto roadmap generation failed · ${roadmapError}`);
  }

  repo.setCurrentOpportunityId(opportunityId);
  repo.refreshCurrentSnapshot();

  return { archived, roadmap, roadmapError };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  /** Server-side AI mode so the client never sees the API key. */
  service: router({
    mode: publicProcedure.query(() => getModeInfo()),

    /**
     * Recent AI actions with their Gemini call counts, input-token estimates and
     * response sizes — the same tally written to the server log by the usage
     * middleware (one entry per user action).
     */
    usage: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(25).optional() }).optional())
      .query(({ input }) => ({ actions: recentAiActions(input?.limit ?? 10) })),
  }),

  /** Persisted in-app notifications (SQLite-backed). */
  notification: router({
    list: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => {
      const notifications = repo.listNotifications(input?.limit ?? 40);
      return { notifications, unreadCount: repo.countUnreadNotifications() };
    }),

    unreadCount: publicProcedure.query(() => ({ count: repo.countUnreadNotifications() })),

    markRead: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => {
        const updated = repo.markNotificationRead(input.id);
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
        }
        return { success: true, unreadCount: repo.countUnreadNotifications() } as const;
      }),

    markAllRead: publicProcedure.mutation(() => {
      const changed = repo.markAllNotificationsRead();
      return { success: true, changed } as const;
    }),

    /**
     * Delete ONE notification (hard delete — the notifications table is small
     * and already has no soft-delete concept, so a second mechanism is not
     * introduced). The store is this authenticated workspace's own SQLite
     * database — notifications carry no other-user surface — and an id that
     * does not exist (or was already deleted) is a 404, never a fake success.
     * The fresh unread count is returned so the bell badge stays exact.
     */
    delete: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => {
        const deleted = repo.deleteNotification(input.id);
        if (!deleted) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
        }
        return { success: true, unreadCount: repo.countUnreadNotifications() } as const;
      }),
  }),

  profile: router({
    get: publicProcedure.query(() => repo.getProfile()),

    create: publicProcedure.input(profileInput).mutation(({ input }) => repo.createProfile(input)),

    update: publicProcedure
      .input(profileInput.extend({ id: z.number().int().positive().optional() }))
      .mutation(({ input }) => {
        const { id, ...patch } = input;
        const target = id ?? repo.getProfile()?.id;
        if (!target) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No profile exists yet. Create one first.",
          });
        }
        const updated = repo.updateProfile(target, patch);
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
        }
        return updated;
      }),

    reset: publicProcedure.mutation(() => {
      repo.resetProfile();
      return { success: true } as const;
    }),
  }),

  resume: router({
    latest: publicProcedure.query(() => repo.getLatestResume()),
    list: publicProcedure.query(() => repo.listResumes(20)),

    /** Upload → validate → extract text → save. */
    upload: publicProcedure.input(uploadInput).mutation(async ({ input }) => {
      try {
        const validation = validateUpload("resume", input.fileName, input.mimeType, input.fileSize);
        if (validation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validation.message });
        }

        const buffer = decodeBase64Payload(input.base64);
        let text: string;
        try {
          const extracted = await extractResumeText(input.fileName, buffer);
          text = extracted.text;
        } catch (error) {
          console.error(
            `[API] resume.upload extraction failed · ${error instanceof Error ? error.message : "unknown"}`,
          );
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The uploaded file could not be processed. Please upload a PDF or DOCX file.",
          });
        }

        if (!text || text.length < 40) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "No readable text was found in that file. If it is a scanned PDF, the text must be selectable.",
          });
        }

        const record = repo.createResume({
          profileId: repo.getProfile()?.id ?? null,
          originalFilename: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          extractedText: text,
        });

        return record;
      } catch (error) {
        throw toTrpcError(error, "The uploaded file could not be processed.");
      }
    }),

    /** Gemini/rule analysis + structured profile extraction for a stored resume. */
    analyze: publicProcedure
      .input(z.object({ resumeId: z.number().int().positive().optional(), targetRole: z.string().max(200).optional() }))
      .mutation(async ({ input }) => {
        try {
          const resume = input.resumeId ? repo.getResume(input.resumeId) : repo.getLatestResume();
          if (!resume) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Upload a resume first.",
            });
          }

          // ONE Gemini request for the whole resume pass: quality analysis +
          // profile extraction in a single response. The resume text is sent
          // exactly once (previously it was posted twice — once per operation),
          // and both results are persisted from this one response.
          const { analysis, profile: extractedProfile, engine } = await analyzeResumeFull(
            resume.extractedText,
            input.targetRole,
          );

          const updated = repo.updateResume(resume.id, {
            analysis,
            improvementSuggestions: analysis.improvements,
            extractedProfile,
          });

          // Notify: the resume analysis just completed.
          repo.createNotification({
            type: "resume",
            title: "Resume analyzed",
            body: "Your resume was reviewed and the extracted details are ready to save to your profile.",
            link: "/app/resume",
          });

          return {
            resume: updated,
            analysis,
            extractedProfile,
            engine,
          };
        } catch (error) {
          throw toTrpcError(error, "Unable to analyze this resume. Please try again.");
        }
      }),

    /** Apply the reviewed extraction onto the persisted profile. */
    saveExtractedProfile: publicProcedure
      .input(
        z.object({
          resumeId: z.number().int().positive().optional(),
          profile: profileInput.optional(),
        }),
      )
      .mutation(({ input }) => {
        const resume = input.resumeId ? repo.getResume(input.resumeId) : repo.getLatestResume();
        if (!resume) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Upload a resume first." });
        }
        if (input.profile) {
          const existing = repo.getProfile();
          return existing
            ? repo.updateProfile(existing.id, input.profile)
            : repo.createProfile(input.profile);
        }
        const applied = repo.applyExtractionToProfile(resume.id);
        if (!applied) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Analyze the resume before saving the extracted profile.",
          });
        }
        return applied;
      }),

    /** Factual-only resume improvement. */
    improve: publicProcedure
      .input(z.object({ resumeId: z.number().int().positive().optional() }))
      .mutation(async ({ input }) => {
        try {
          const resume = input.resumeId ? repo.getResume(input.resumeId) : repo.getLatestResume();
          if (!resume) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Upload a resume first." });
          }

          const { improvedResume: text, changes, engine } = await improveResume(
            resume.extractedText,
            repo.getProfile(),
            // Skills verified through completed roadmap steps — the improved
            // resume may include these (they were earned after the resume was
            // written), never anything else.
            repo.listCompletedRoadmapSkills(),
          );

          const updated = repo.updateResume(resume.id, {
            improvedResume: text,
            improvedChanges: changes,
            improvementKind: "general",
          });

          return { resume: updated, changes, engine };
        } catch (error) {
          throw toTrpcError(error, "Unable to improve this resume right now. Please try again.");
        }
      }),
  }),

  opportunity: router({
    list: publicProcedure.query(() => repo.listOpportunities(50)),

    get: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ input }) => {
        const opportunity = repo.getOpportunity(input.id);
        if (!opportunity) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found." });
        }
        return {
          opportunity,
          analysis: repo.getLatestAnalysisForOpportunity(input.id),
        };
      }),

    create: publicProcedure
      .input(
        z.object({
          company: z.string().max(200).optional(),
          jobTitle: z.string().max(200).optional(),
          description: z.string().max(40000).optional(),
          location: z.string().max(200).optional(),
          employmentType: z.string().max(80).optional(),
          compensation: z.string().max(120).optional(),
          requiredSkills: z.array(z.string().max(60)).max(40).optional(),
          preferredSkills: z.array(z.string().max(60)).max(40).optional(),
        }),
      )
      .mutation(({ input }) => repo.createOpportunity({ ...input, source: "manual" })),

    /** Paste a job description → structured requirements → real match analysis. */
    analyzeText: publicProcedure
      .input(z.object({ description: z.string().min(20).max(40000), opportunityId: z.number().int().positive().optional() }))
      .mutation(async ({ input }) => {
        try {
          const profile = requireProfile();
          // ONE request per posting: the structured requirements AND the trust
          // indicators come back together, so the job description is sent to
          // Gemini only once here.
          const { job, trust, engine } = await extractJobRequirements({ description: input.description });

          if (job.insufficientInformation && job.requiredSkills.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Insufficient information: this does not look like a job description. Paste the full posting including the role title and requirements.",
            });
          }

          const opportunity =
            (input.opportunityId ? repo.getOpportunity(input.opportunityId) : null) ??
            repo.createOpportunity({
              ...job,
              description: input.description,
              source: "text",
            });

          const { match, skillGaps, verification } = await analyzeOpportunity({
            job: { ...job, description: input.description },
            profile,
            skillFrequency: skillFrequencyMap(),
            // Reuse the trust review from the extraction request above — the
            // posting text is never sent to Gemini a second time.
            verification: trust,
          });

          // Targets are resolved ONCE so the combined plan request and the
          // persisted roadmap close exactly the same gaps.
          const { targetSkills } = resolveRoadmapTargets(opportunity, null, skillGaps);

          // ONE combined request: roadmap + per-gap guidance. This replaces the
          // previous TWO calls (gap-note enrichment + roadmap), so a full job
          // analysis costs TWO Gemini requests (extraction + plan).
          let plan: RoadmapComputation;
          try {
            plan = await generateRoadmapWithGapNotes({
              targetOpportunity: `${opportunity.jobTitle} at ${opportunity.company}`,
              targetSkills,
              gaps: skillGaps,
              profile,
            });
          } catch (error) {
            // A Gemini failure must not lose the analysis: gaps keep their
            // rule-derived guidance and the roadmap path below retries once
            // (its failure is surfaced as roadmapError, as before).
            plan = { estimatedDuration: "", items: [], gapNotes: [], engine: "rules" };
            console.error(
              `[API] combined roadmap+gap-notes generation failed · ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
          const enrichedGaps = applyGapNotes(skillGaps, plan.gapNotes);

          const saved = repo.saveAnalysis(opportunity.id, profile.id, {
            matchScore: match.matchScore,
            matchedSkills: match.matchedSkills,
            partialSkills: match.partialSkills,
            missingSkills: match.missingSkills,
            notApplicableSkills: match.notApplicableSkills,
            skillRows: match.skillRows,
            eligibility: match.eligibility,
            factors: match.factors,
            explanation: match.explanation,
            skillGaps: enrichedGaps,
            verification,
            engine: plan.engine === "gemini" ? "gemini" : engine,
          });

          // Notify: an opportunity analysis just completed.
          repo.createNotification({
            type: "analysis",
            title: `Opportunity analyzed: ${opportunity.jobTitle || "Untitled role"}`,
            body: `${match.matchScore}% match · ${match.missingSkills.length} skill gap${match.missingSkills.length === 1 ? "" : "s"} to close for ${opportunity.company || "this role"}.`,
            link: "/app/opportunities",
          });

          // New opportunity → archive the previous one, switch to this one and
          // rebuild the roadmap from ITS gaps (reusing the combined plan items).
          const activation = await activateAnalyzedOpportunity(
            opportunity.id,
            plan.items.length ? plan : undefined,
          );

          return {
            opportunity,
            analysis: saved,
            engine,
            roadmap: activation.roadmap,
            archivedOpportunity: activation.archived
              ? {
                  id: activation.archived.opportunityId,
                  jobTitle: activation.archived.jobTitle,
                  company: activation.archived.company,
                  progress: activation.archived.progress,
                }
              : null,
            roadmapError: activation.roadmapError,
          };
        } catch (error) {
          throw toTrpcError(error, "Unable to analyze this opportunity. Please try again.");
        }
      }),

    /** Upload a job screenshot → Gemini vision extraction → real match analysis. */
    analyzeImage: publicProcedure
      .input(
        uploadInput.extend({
          description: z.string().max(40000).optional(),
          opportunityId: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const profile = requireProfile();

          const validation = validateUpload("image", input.fileName, input.mimeType, input.fileSize);
          if (validation) {
            throw new TRPCError({ code: "BAD_REQUEST", message: validation.message });
          }

          const buffer = decodeBase64Payload(input.base64);
          // ONE vision request: screenshot requirements + trust indicators.
          const { job, trust, engine } = await extractJobRequirements({
            description: input.description,
            image: { mimeType: input.mimeType, base64: buffer.toString("base64") },
          });

          if (job.insufficientInformation || (job.requiredSkills.length === 0 && job.jobTitle === "Not found")) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Insufficient information: the image does not contain enough readable job details. Upload a clearer screenshot.",
            });
          }

          const opportunity = repo.createOpportunity({
            ...job,
            description: input.description ?? `${job.jobTitle} at ${job.company}`,
            source: "image",
            sourceFilename: input.fileName,
          });

          const { match, skillGaps, verification } = await analyzeOpportunity({
            job,
            profile,
            skillFrequency: skillFrequencyMap(),
            // Trust indicators already came back with the vision extraction.
            verification: trust,
          });

          // Targets are resolved ONCE so the combined plan request and the
          // persisted roadmap close exactly the same gaps.
          const { targetSkills } = resolveRoadmapTargets(opportunity, null, skillGaps);

          // ONE combined request: roadmap + per-gap guidance (see analyzeText).
          let plan: RoadmapComputation;
          try {
            plan = await generateRoadmapWithGapNotes({
              targetOpportunity: `${job.jobTitle} at ${job.company}`,
              targetSkills,
              gaps: skillGaps,
              profile,
            });
          } catch (error) {
            plan = { estimatedDuration: "", items: [], gapNotes: [], engine: "rules" };
            console.error(
              `[API] combined roadmap+gap-notes generation failed · ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
          const enrichedGaps = applyGapNotes(skillGaps, plan.gapNotes);

          const saved = repo.saveAnalysis(opportunity.id, profile.id, {
            matchScore: match.matchScore,
            matchedSkills: match.matchedSkills,
            partialSkills: match.partialSkills,
            missingSkills: match.missingSkills,
            notApplicableSkills: match.notApplicableSkills,
            skillRows: match.skillRows,
            eligibility: match.eligibility,
            factors: match.factors,
            explanation: match.explanation,
            skillGaps: enrichedGaps,
            verification,
            engine: plan.engine === "gemini" ? "gemini" : engine,
          });

          // Notify: a screenshot-based opportunity analysis just completed.
          repo.createNotification({
            type: "analysis",
            title: `Opportunity analyzed: ${job.jobTitle || "Untitled role"}`,
            body: `${match.matchScore}% match · ${match.missingSkills.length} skill gap${match.missingSkills.length === 1 ? "" : "s"} to close for ${job.company || "this role"}.`,
            link: "/app/opportunities",
          });

          // New opportunity → archive the previous one, switch to this one and
          // rebuild the roadmap from ITS gaps (reusing the combined plan items).
          const activation = await activateAnalyzedOpportunity(
            opportunity.id,
            plan.items.length ? plan : undefined,
          );

          return {
            opportunity,
            analysis: saved,
            engine,
            roadmap: activation.roadmap,
            archivedOpportunity: activation.archived
              ? {
                  id: activation.archived.opportunityId,
                  jobTitle: activation.archived.jobTitle,
                  company: activation.archived.company,
                  progress: activation.archived.progress,
                }
              : null,
            roadmapError: activation.roadmapError,
          };
        } catch (error) {
          throw toTrpcError(error, "Unable to analyze this opportunity. Please try again.");
        }
      }),

    /** The opportunity the workspace is currently focused on + its live state. */
    current: publicProcedure.query(() => {
      const opportunity = repo.getCurrentOpportunity();
      const roadmap = repo.getCurrentRoadmap();
      return {
        opportunity,
        analysis: repo.getCurrentAnalysis(),
        roadmap,
        progress: repo.roadmapProgress(roadmap),
        applications: opportunity ? repo.listApplicationsForOpportunity(opportunity.id) : [],
        resources: roadmap ? repo.listLearningResourcesForRoadmap(roadmap.id) : [],
      };
    }),

    /** Saved Data / Opportunity History — every previously analyzed role. */
    history: publicProcedure.query(() => {
      const currentId = repo.getCurrentOpportunityId();
      return {
        snapshots: repo.listOpportunitySnapshots().map(snapshot => ({
          ...snapshot,
          isCurrent: snapshot.opportunityId === currentId,
        })),
        currentOpportunityId: currentId,
      };
    }),

    /** Switch back to a saved opportunity and restore its roadmap + progress. */
    switch: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => {
        const archived = repo.archiveCurrentOpportunity();
        const restored = repo.activateOpportunity(input.id);
        if (!restored) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That saved opportunity could not be found." });
        }
        repo.createNotification({
          type: "opportunity",
          title: `Switched to ${restored.opportunity.jobTitle || "saved opportunity"}`,
          body: `Restored its roadmap (${restored.progress.completed}/${restored.progress.total} complete) and application history. Your profile was not changed.`,
          link: "/app/history",
        });
        return {
          ...restored,
          archivedOpportunityId: archived?.opportunityId ?? null,
          resources: restored.roadmap
            ? repo.listLearningResourcesForRoadmap(restored.roadmap.id)
            : [],
        };
      }),

    /** Delete an opportunity and everything attached to it (profile untouched). */
    delete: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => {
        const opportunity = repo.getOpportunity(input.id);
        if (!opportunity) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found." });
        }
        const result = repo.deleteOpportunityCascade(input.id);
        repo.createNotification({
          type: "system",
          title: `Removed: ${opportunity.jobTitle || "opportunity"}`,
          body: "Its roadmap, analysis, application and saved history were deleted. Your profile and skills were kept.",
          link: "/app/history",
        });
        return {
          success: result.deleted,
          deletedOpportunityId: input.id,
          nextCurrentOpportunityId: result.nextCurrentOpportunityId,
          profileUntouched: true as const,
        };
      }),

    latestAnalysis: publicProcedure.query(() => repo.getCurrentAnalysis()),
  }),

  roadmap: router({
    /** The roadmap of the CURRENT opportunity (never a stale one). */
    get: publicProcedure.query(() => repo.getCurrentRoadmap()),

    /** Live task counts for the current roadmap — the Overview reads this. */
    progress: publicProcedure.query(() => {
      const roadmap = repo.getCurrentRoadmap();
      const progress = repo.roadmapProgress(roadmap);
      return {
        roadmapId: roadmap?.id ?? null,
        targetOpportunity: roadmap?.targetOpportunity ?? "",
        estimatedDuration: roadmap?.estimatedDuration ?? "",
        ...progress,
      };
    }),

    /** Stored learning resources for every task of the current roadmap. */
    itemResources: publicProcedure
      .input(z.object({ language: z.string().max(40).optional() }).optional())
      .query(({ input }) => {
        const roadmap = repo.getCurrentRoadmap();
        const language = input?.language ? normalizeLanguage(input.language) : null;
        return {
          roadmapId: roadmap?.id ?? null,
          resources: roadmap
            ? repo.listLearningResourcesForRoadmap(roadmap.id, language ?? undefined)
            : [],
        };
      }),

    /** Language preference for resource searches (shared, persisted). */
    resourcePreference: publicProcedure.query(() => ({
      languages: RESOURCE_LANGUAGES,
      selected: repo.getResourceLanguage(defaultLanguage()),
    })),

    setResourcePreference: publicProcedure
      .input(z.object({ language: z.string().min(2).max(40) }))
      .mutation(({ input }) => ({
        success: true,
        selected: repo.setResourceLanguage(normalizeLanguage(input.language)),
      })),

    /**
     * "Find Learning Resources" for one roadmap task.
     * Gemini (when a key is configured) proposes resources in the chosen
     * language; every URL is verified server-side and the result is persisted.
     */
    findResources: publicProcedure
      .input(
        z.object({
          itemId: z.number().int().positive(),
          language: z.string().min(2).max(40).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const item = repo.findRoadmapItemById(input.itemId);
          if (!item) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Roadmap task not found." });
          }
          const roadmap = repo.getRoadmap(item.roadmapId);
          const language = repo.setResourceLanguage(normalizeLanguage(input.language));
          const skill = item.skill || item.title;

          // CACHE FIRST: resources already generated for this exact skill +
          // selected language are reused verbatim, so a repeat search costs
          // ZERO Gemini calls (previously every click generated a fresh batch).
          const cached = repo.findReusableLearningResources(skill, language);

          let resources: LearningResource[];
          let engine: "gemini" | "rules" | "demo";
          let fromCache = false;

          if (cached.length >= 3) {
            fromCache = true;
            engine = cached[0].engine === "gemini" ? "gemini" : cached[0].engine;
            resources = cached;
            console.log(
              `[AI-Usage] resources cache hit · skill="${skill}" · language=${language} · ${cached.length} stored resource(s) reused · geminiCalls=0`,
            );
          } else {
            const rejectionSkills = repo.accumulateRejectionSkillCounts().map(entry => entry.skill);
            const suggestion = await suggestLearningResources({
              skill,
              itemTitle: item.title,
              taskDescription: item.practicalTask || item.learningObjective,
              targetOpportunity: roadmap?.targetOpportunity ?? "",
              language,
              rejectionSkills,
            });
            resources = suggestion.resources;
            engine = suggestion.engine;
          }

          const saved = repo.replaceLearningResources({
            roadmapItemId: item.id,
            opportunityId: roadmap?.opportunityId ?? null,
            skill: item.skill || item.title,
            language,
            resources: resources.map(resource => ({
              ...resource,
              roadmapItemId: item.id,
              opportunityId: roadmap?.opportunityId ?? null,
              skill: item.skill || item.title,
              language,
            })),
          });

          const verifiedCount = saved.filter(resource => resource.verified).length;
          repo.createNotification({
            type: "system",
            title: `Learning resources ready: ${item.skill || item.title}`,
            body: `${saved.length} ${language} resource${saved.length === 1 ? "" : "s"} found for "${item.title}"${
              verifiedCount ? ` · ${verifiedCount} link${verifiedCount === 1 ? "" : "s"} verified` : ""
            }.`,
            link: "/app/roadmap",
          });

          return {
            itemId: item.id,
            skill: item.skill || item.title,
            language,
            engine,
            resources: saved,
            verifiedCount,
            /** True when the stored resources were reused (no Gemini call). */
            fromCache,
            generatedAt: new Date().toISOString(),
          };
        } catch (error) {
          throw toTrpcError(error, "Unable to find learning resources right now. Please try again.");
        }
      }),

    generate: publicProcedure
      .input(z.object({ opportunityId: z.number().int().positive().optional() }).optional())
      .mutation(async ({ input }) => {
        try {
          const { opportunity, analysis } = resolveOpportunityTarget(input?.opportunityId);

          const gaps: SkillGap[] = analysis?.skillGaps ?? [];
          const targetSkills = gaps.length
            ? gaps.map(gap => gap.skill)
            : analysis?.missingSkills ?? opportunity.requiredSkills;

          const profile = repo.getProfile();
          const targetOpportunity = `${opportunity.jobTitle} at ${opportunity.company}`;

          // Accumulated rejection feedback (if it overlaps this role's gaps)
          // moves to the front of the plan.
          const rejectionSkills = repo.accumulateRejectionSkillCounts().map(item => item.skill);
          const prioritised = rejectionSkills.filter(skill =>
            targetSkills.some(target => normalizeSkill(target) === normalizeSkill(skill)),
          );
          const orderedTargets = Array.from(new Set([...prioritised, ...targetSkills]));

          const { estimatedDuration, items, engine } = await generateRoadmap({
            targetOpportunity,
            targetSkills: orderedTargets,
            gaps,
            profile,
          });

          // Carry completion forward for identical steps so re-generating a plan
          // never silently un-completes work, and positions stay stable.
          const previous = repo.getRoadmapForOpportunity(opportunity.id);
          const previousCompleted = new Set(
            (previous?.items ?? [])
              .filter(item => item.completed)
              .map(item => `${normalizeSkill(item.skill)}|${item.title.toLowerCase()}`),
          );
          const orderedItems = items.map(item => ({
            ...item,
            completed: previousCompleted.has(`${normalizeSkill(item.skill)}|${item.title.toLowerCase()}`),
          }));

          const roadmap = repo.createRoadmap({
            profileId: profile?.id ?? null,
            opportunityId: opportunity.id,
            targetOpportunity,
            targetSkills: orderedTargets,
            estimatedDuration,
            engine: engine === "gemini" ? "gemini" : "rules",
            items: orderedItems,
          });

          // Keep the roadmap's stored duration honest when completed steps were
          // carried over, then re-point the workspace at this roadmap.
          const pendingDays = roadmap.items
            .filter(item => !item.completed)
            .reduce((sum, item) => sum + repo.parseDurationDays(item.duration), 0);
          repo.recomputeRoadmapRemainingDays(roadmap.id);
          repo.setCurrentOpportunityId(opportunity.id);
          repo.refreshCurrentSnapshot();

          const fresh = repo.getRoadmap(roadmap.id) ?? roadmap;

          // Notify: a new learning roadmap is ready.
          repo.createNotification({
            type: "roadmap",
            title: "Learning roadmap ready",
            body: `${items.length} step${items.length === 1 ? "" : "s"} · about ${pendingDays} day${pendingDays === 1 ? "" : "s"} to close your gaps for ${opportunity.jobTitle || "your target role"}.`,
            link: "/app/roadmap",
          });

          return fresh;
        } catch (error) {
          throw toTrpcError(error, "We couldn't build that roadmap right now. Please try again.");
        }
      }),

    updateProgress: publicProcedure
      .input(z.object({ itemId: z.number().int().positive(), completed: z.boolean() }))
      .mutation(({ input }) => {
        const result = repo.setRoadmapItemCompletion(input.itemId, input.completed);
        if (!result) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Roadmap item not found." });
        }

        // Completing a roadmap skill is a real achievement: record it on the
        // profile (verified skill) and fire a success notification. This runs
        // only on the pending → completed transition, so re-toggles never
        // duplicate skills or notifications.
        if (input.completed && !result.previousCompleted) {
          const profile = repo.addProfileSkill(result.item.skill);
          const itemDays = repo.parseDurationDays(result.item.duration);
          repo.createNotification({
            type: "skill_completed",
            title: `Skill completed: ${result.item.skill || result.item.title}`,
            body: [
              `“${result.item.title}” is done.`,
              itemDays > 0 ? `${itemDays} day${itemDays === 1 ? "" : "s"} removed from your roadmap —` : "Removed from your roadmap —",
              `${result.remainingDays} day${result.remainingDays === 1 ? "" : "s"} of learning remain.`,
              profile ? "The skill was added to your profile." : "Create a profile to keep it on record.",
            ].join(" "),
            link: "/app/roadmap",
          });
        }

        // Keep the saved snapshot of the active opportunity in step with the
        // live progress so Saved Data never shows stale numbers.
        repo.refreshCurrentSnapshot();

        return repo.getRoadmap(result.roadmapId);
      }),
  }),
  application: router({
    list: publicProcedure.query(() => repo.listApplications()),

    create: publicProcedure
      .input(
        z.object({
          opportunityId: z.number().int().positive().optional(),
          company: z.string().max(200).optional(),
          position: z.string().max(200).optional(),
          matchPercentage: z.number().int().min(0).max(100).optional(),
          status: z.enum(APPLICATION_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]).optional(),
          notes: z.string().max(4000).optional(),
        }),
      )
      .mutation(({ input }) => {
        let company = input.company ?? "";
        let position = input.position ?? "";
        let matchPercentage = input.matchPercentage ?? 0;

        if (input.opportunityId) {
          const opportunity = repo.getOpportunity(input.opportunityId);
          if (!opportunity) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found." });
          }
          const analysis = repo.getLatestAnalysisForOpportunity(input.opportunityId);
          company = company || opportunity.company;
          position = position || opportunity.jobTitle;
          matchPercentage = matchPercentage || analysis?.matchScore || 0;

          const existing = repo.findApplicationByOpportunity(input.opportunityId);
          if (existing) return existing;
        }

        return repo.createApplication({
          opportunityId: input.opportunityId ?? null,
          company,
          position,
          matchPercentage,
          status: input.status ?? "Saved",
          notes: input.notes ?? "",
          dateApplied: (input.status ?? "Saved") === "Saved" ? null : new Date().toISOString(),
        });
      }),

    updateStatus: publicProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          status: z.enum(APPLICATION_STATUSES as [ApplicationStatus, ...ApplicationStatus[]]),
          notes: z.string().max(4000).optional(),
        }),
      )
      .mutation(({ input }) => {
        const existing = repo.getApplication(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
        }
        const dateApplied =
          input.status === "Saved" ? existing.dateApplied : existing.dateApplied ?? new Date().toISOString();

        const updated = repo.updateApplication(input.id, {
          status: input.status,
          notes: input.notes ?? existing.notes,
          dateApplied,
        });
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
        }
        repo.refreshCurrentSnapshot();
        return updated;
      }),

    /**
     * After Interview outcome.
     *  - rejection: saves the optional rejection reason (and analyses it with
     *    Gemini when available) so accumulated feedback improves later
     *    recommendations. Skipping is allowed and simply stores "Rejected".
     *  - selection: congratulates the user, marks the application "Selected",
     *    raises a success notification and records it in opportunity history.
     */
    resolveAfterInterview: publicProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          outcome: z.enum(["rejected", "selected"]),
          reason: z.string().max(4000).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = repo.getApplication(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
        }

        if (input.outcome === "selected") {
          const updated = repo.updateApplication(input.id, {
            status: "Selected",
            outcome: "selected",
            dateApplied: existing.dateApplied ?? new Date().toISOString(),
          });
          repo.refreshCurrentSnapshot();
          if (existing.opportunityId) {
            repo.saveOpportunitySnapshot(existing.opportunityId, {
              current: repo.getCurrentOpportunityId() === existing.opportunityId,
            });
          }
          repo.createNotification({
            type: "selection",
            title: `🎉 Selected: ${existing.position || "Role"} at ${existing.company || "the company"}`,
            body: "Congratulations — this outcome was saved to your opportunity history and your tracker.",
            link: "/app/applications",
          });
          return {
            mode: "selected" as const,
            application: updated,
            feedback: null,
            message: `Congratulations! You were selected for ${existing.position || "the role"} at ${existing.company || "the company"}. This win is saved in your opportunity history.`,
            nextStep: "Keep the momentum: add your next opportunity when you are ready.",
          };
        }

        const reason = (input.reason ?? "").trim();
        const updated = repo.updateApplication(input.id, {
          status: "Rejected",
          outcome: "rejected",
          rejectionReason: reason,
        });

        // Analyse the reason (when given) and store it for future
        // recommendations. A Gemini failure must not lose the user's record.
        let feedback = null as ReturnType<typeof repo.createFeedback> | null;
        let analysisEngine = "rules";
        if (reason) {
          try {
            const analysis = existing.opportunityId
              ? repo.getLatestAnalysisForOpportunity(existing.opportunityId)
              : repo.listAnalyses(1)[0];
            const { analysis: result, engine } = await analyzeRejection({
              category: "Interview",
              explanation: reason,
              profile: repo.getProfile(),
              missingSkills: analysis?.missingSkills ?? [],
              company: existing.company,
              position: existing.position,
            });
            analysisEngine = engine;
            feedback = repo.createFeedback({
              applicationId: existing.id,
              category: "Interview",
              explanation: reason,
              analysis: { ...result, engine },
            });
          } catch (error) {
            console.error(
              `[API] rejection reason analysis failed · ${error instanceof Error ? error.message : "unknown"}`,
            );
          }
        }

        repo.refreshCurrentSnapshot();
        if (existing.opportunityId) {
          repo.saveOpportunitySnapshot(existing.opportunityId, {
            current: repo.getCurrentOpportunityId() === existing.opportunityId,
          });
        }
        repo.createNotification(
          reason
            ? {
                type: "rejection",
                title: `Rejection reason saved: ${existing.position || "Role"}`,
                body: "Your feedback is now part of your history and will shape future recommendations.",
                link: "/app/feedback",
              }
            : {
                type: "rejection",
                title: `Application closed: ${existing.position || "Role"}`,
                body: "Saved as rejected without a reason. Add new opportunities to continue your journey.",
                link: "/app/opportunities",
              },
        );

        return {
          mode: "rejected" as const,
          application: updated,
          feedback,
          engine: analysisEngine,
          message: reason
            ? "Rejection reason saved with this opportunity and added to your improvement history."
            : "Add new opportunities to continue your journey.",
          nextStep: reason
            ? "Your accumulated feedback now feeds future skill and opportunity recommendations."
            : "No reason recorded — that is completely fine. Keep going.",
        };
      }),

    /** Prepare Application — tailored resume from existing facts only. */
    prepare: publicProcedure
      .input(z.object({ opportunityId: z.number().int().positive(), applicationId: z.number().int().positive().optional() }))
      .mutation(async ({ input }) => {
        try {
          const opportunity = repo.getOpportunity(input.opportunityId);
          if (!opportunity) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found." });
          }

          const resume = repo.getLatestResume();
          if (!resume) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Upload your resume first so we can tailor it for this role.",
            });
          }

          const analysis = repo.getLatestAnalysisForOpportunity(input.opportunityId);

          const { tailoredResume: tailored, changes, engine } = await generateTailoredResume({
            resumeText: resume.extractedText,
            jobTitle: opportunity.jobTitle,
            company: opportunity.company,
            requiredSkills: opportunity.requiredSkills,
            preferredSkills: opportunity.preferredSkills,
            matchedSkills: analysis?.matchedSkills ?? [],
            missingSkills: analysis?.missingSkills ?? [],
            responsibilitiesRaw: opportunity.responsibilitiesRaw,
            verifiedSkills: repo.listCompletedRoadmapSkills(),
          });

          const existing =
            (input.applicationId ? repo.getApplication(input.applicationId) : null) ??
            repo.findApplicationByOpportunity(opportunity.id) ??
            repo.createApplication({
              opportunityId: opportunity.id,
              company: opportunity.company,
              position: opportunity.jobTitle,
              matchPercentage: analysis?.matchScore ?? 0,
              status: "Saved",
            });

          const updated = repo.updateApplication(existing.id, {
            tailoredResume: tailored,
            tailoredChanges: changes,
          });

          return { application: updated ?? existing, changes, engine };
        } catch (error) {
          throw toTrpcError(error, "Unable to prepare this application right now. Please try again.");
        }
      }),

    remove: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => {
        repo.deleteApplication(input.id);
        return { success: true } as const;
      }),
  }),

  feedback: router({
    list: publicProcedure.query(() => repo.listFeedback(50)),

    create: publicProcedure
      .input(
        z.object({
          applicationId: z.number().int().positive().optional(),
          category: z.enum([
            "Skills",
            "Resume",
            "Experience",
            "Interview",
            "Assessment",
            "Eligibility",
            "Unknown",
          ]),
          note: z.string().max(4000).default(""),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const profile = repo.getProfile();
          const application = input.applicationId ? repo.getApplication(input.applicationId) : null;

          const analysis =
            application?.opportunityId !== null && application?.opportunityId !== undefined
              ? repo.getLatestAnalysisForOpportunity(application.opportunityId)
              : repo.listAnalyses(1)[0];

          const { analysis: result, engine } = await analyzeRejection({
            category: input.category,
            explanation: input.note,
            profile,
            missingSkills: analysis?.missingSkills ?? [],
            company: application?.company,
            position: application?.position,
          });

          const saved = repo.createFeedback({
            applicationId: input.applicationId ?? null,
            category: input.category,
            explanation: input.note,
            analysis: { ...result, engine },
          });

          return saved;
        } catch (error) {
          throw toTrpcError(error, "Unable to analyze feedback right now. Please try again.");
        }
      }),

    /** Re-run the analysis for an already-stored feedback entry. */
    analyze: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        try {
          const stored = repo.getFeedback(input.id);
          if (!stored) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Feedback entry not found." });
          }
          const analysis = repo.listAnalyses(1)[0];
          const { analysis: result, engine } = await analyzeRejection({
            category: stored.category,
            explanation: stored.userExplanation,
            profile: repo.getProfile(),
            missingSkills: analysis?.missingSkills ?? [],
          });
          return { ...result, engine };
        } catch (error) {
          throw toTrpcError(error, "Unable to analyze feedback right now. Please try again.");
        }
      }),
  }),

  /** Continuous improvement — insights strictly from stored data. */
  insights: router({
    get: publicProcedure.query(async () => {
      const analyses = repo.listAnalyses(50).map(analysis => ({
        matchScore: analysis.matchScore,
        missingSkills: analysis.missingSkills,
        company: "",
        createdAt: "",
      }));
      const applications = repo.listApplications().map(app => ({
        status: app.status,
        company: app.company,
      }));
      const feedback = repo.listFeedback(50).map(item => ({
        category: item.category,
        insight: item.insight,
      }));
      const profile = repo.getProfile();

      // Roadmap progress always describes the CURRENT roadmap — it is derived
      // from live task completion, never hard-coded.
      const currentRoadmap = repo.getCurrentRoadmap();
      const roadmap = repo.roadmapProgress(currentRoadmap);
      const rejectionSignals = repo.listRejectionSignals(100);
      const rejectionSkills = repo.accumulateRejectionSkillCounts();
      const outcomes = repo.listApplicationOutcomeCounts();
      const currentOpportunity = repo.getCurrentOpportunity();
      const currentAnalysis = repo.getCurrentAnalysis();

      const { insights } = await generateInsights({
        analyses,
        applications,
        feedback,
        roadmap: { completed: roadmap.completed, total: roadmap.total },
        profile,
        rejectionSignals: rejectionSignals.map(signal => ({
          reason: signal.reason,
          category: signal.category,
          company: signal.company,
        })),
      });

      const frequency: Record<string, number> = {};
      for (const analysis of repo.listAnalyses(50)) {
        for (const skill of analysis.missingSkills) {
          const key = normalizeSkill(skill);
          if (key) frequency[key] = (frequency[key] ?? 0) + 1;
        }
      }

      const avgScore = analyses.length
        ? Math.round(analyses.reduce((sum, item) => sum + item.matchScore, 0) / analyses.length)
        : 0;

      return {
        insights,
        stats: {
          opportunitiesAnalyzed: repo.countOpportunities(),
          applications: applications.length,
          feedbackNotes: repo.countFeedback(),
          roadmapItemsCompleted: roadmap.completed,
          roadmapItemsTotal: roadmap.total,
          averageMatch: avgScore,
          frequentlyMissingSkills: Object.entries(frequency)
            .map(([skill, count]) => ({ skill, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6),
          roadmapTotal: roadmap.total,
          roadmapCompleted: roadmap.completed,
          roadmapRemaining: roadmap.remaining,
          roadmapPercent: roadmap.percent,
          roadmapTargetOpportunity: currentRoadmap?.targetOpportunity ?? "",
          currentOpportunityId: currentOpportunity?.id ?? null,
          currentOpportunityTitle: currentOpportunity?.jobTitle ?? "",
          currentOpportunityCompany: currentOpportunity?.company ?? "",
          currentMatchPercentage: currentAnalysis?.matchScore ?? 0,
          savedOpportunities: repo.countOpportunitySnapshots(),
          selectedApplications: outcomes.selected,
          rejectedApplications: outcomes.rejected,
          rejectionSkills,
        },
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
