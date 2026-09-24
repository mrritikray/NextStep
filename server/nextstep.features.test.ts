/**
 * NextStep — end-to-end feature verification.
 *
 * Exercises the REAL tRPC procedures against the REAL SQLite database (no mocks)
 * and then reopens the database to prove the data survives a restart.
 *
 * Run with:  npx vitest run server/nextstep.features.test.ts
 *
 * The suite uses its own database file so it never touches your working data.
 */
import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";

process.env.DATABASE_PATH = path.resolve(process.cwd(), "server", "data", "nextstep.test.db");
process.env.GEMINI_API_KEY = "";

const { appRouter } = await import("./routers");
const { closeDb, getDb } = await import("./db/sqlite");

type Ctx = Parameters<typeof appRouter.createCaller>[0];
const ctx = { user: null, req: {} as never, res: {} as never } as unknown as Ctx;
const caller = appRouter.createCaller(ctx);

const JOB_ONE = `Frontend Developer Intern
Company: Northstar Labs
Location: Remote
Employment type: Internship
Stipend: 15000 per month
Requirements
- Strong React and JavaScript
- Understanding of REST APIs and fetch
- Familiarity with Git workflows
Preferred
- Tailwind CSS experience
Responsibilities
- Build responsive user interfaces with React
- Connect components to REST APIs`;

const JOB_TWO = `Data Analyst Intern
Company: Orbit Learning
Location: Pune
Employment type: Internship
Requirements
- Strong Excel skills
- Working knowledge of SQL
- Basic Python for data cleaning
Preferred
- Exposure to Power BI
Responsibilities
- Clean and analyse learner activity data
- Build weekly dashboards`;

const state: Record<string, unknown> = {};

describe("NextStep dynamic features (SQLite-backed, no fake data)", () => {
  it("runs the full lifecycle: analyze → roadmap → progress → save/switch → resources → outcomes → delete → restart", async () => {
    /* ---------------------------------------------------------------- */
    /* 0. Clean test database + profile                                  */
    /* ---------------------------------------------------------------- */
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${process.env.DATABASE_PATH}${suffix}`;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    getDb();

    const profile = await caller.profile.create({
      name: "Test Student",
      email: "test@example.com",
      degree: "B.Tech",
      branch: "CSE",
      graduationYear: "2026",
      skills: ["JavaScript", "HTML", "CSS"],
      careerObjective: "Frontend internship",
    });
    expect(profile.id).toBeGreaterThan(0);

    /* ---------------------------------------------------------------- */
    /* 1. New opportunity → analysis + automatically generated roadmap   */
    /* ---------------------------------------------------------------- */
    const first = await caller.opportunity.analyzeText({ description: JOB_ONE });
    expect(first.analysis.matchScore).toBeGreaterThanOrEqual(0);
    expect(first.opportunity.id).toBeGreaterThan(0);
    expect(first.roadmap, "a roadmap must be generated for the new opportunity").toBeTruthy();

    const oppOne = first.opportunity.id;
    const currentAfterFirst = await caller.opportunity.current();
    expect(currentAfterFirst.opportunity?.id).toBe(oppOne);

    const roadmapOne = await caller.roadmap.get();
    expect(roadmapOne?.opportunityId).toBe(oppOne);
    const totalTasks = roadmapOne!.items.length;
    expect(totalTasks).toBeGreaterThan(0);

    const orderBefore = roadmapOne!.items.map(item => ({
      id: item.id,
      position: item.position,
      title: item.title,
    }));

    /* ---------------------------------------------------------------- */
    /* 2. Overview counts are derived from the roadmap (10/3/7 example)  */
    /* ---------------------------------------------------------------- */
    const progress0 = await caller.roadmap.progress();
    expect(progress0.total).toBe(totalTasks);
    expect(progress0.completed).toBe(0);
    expect(progress0.remaining).toBe(totalTasks);
    expect(progress0.percent).toBe(0);

    const stats0 = await caller.insights.get();
    expect(stats0.stats.roadmapTotal).toBe(totalTasks);
    expect(stats0.stats.roadmapCompleted).toBe(0);
    expect(stats0.stats.roadmapRemaining).toBe(totalTasks);
    expect(stats0.stats.roadmapPercent).toBe(0);
    expect(stats0.stats.currentOpportunityId).toBe(oppOne);

    /* ---------------------------------------------------------------- */
    /* 3. Completing a task updates every count and NEVER re-indexes     */
    /* ---------------------------------------------------------------- */
    const firstItemId = roadmapOne!.items[0].id;
    const secondItemPosition = roadmapOne!.items[1]?.position ?? null;

    await caller.roadmap.updateProgress({ itemId: firstItemId, completed: true });

    const progress1 = await caller.roadmap.progress();
    expect(progress1.total).toBe(totalTasks);
    expect(progress1.completed).toBe(1);
    expect(progress1.remaining).toBe(totalTasks - 1);
    expect(progress1.percent).toBe(Math.round((1 / totalTasks) * 100));

    const roadmapAfterToggle = await caller.roadmap.get();
    const orderAfter = roadmapAfterToggle!.items.map(item => ({
      id: item.id,
      position: item.position,
      title: item.title,
    }));
    expect(orderAfter).toEqual(orderBefore); // ids, positions AND titles unchanged
    expect(roadmapAfterToggle!.items[0].completed).toBe(true);
    if (secondItemPosition !== null) {
      const second = roadmapAfterToggle!.items.find(item => item.position === secondItemPosition);
      expect(second?.completed).toBe(false);
    }

    const stats1 = await caller.insights.get();
    expect(stats1.stats.roadmapCompleted).toBe(1);
    expect(stats1.stats.roadmapRemaining).toBe(totalTasks - 1);

    /* ---------------------------------------------------------------- */
    /* 4. Learning resources: language pick, saved preference, real URLs */
    /* ---------------------------------------------------------------- */
    const preferences = await caller.roadmap.resourcePreference();
    expect(preferences.languages.map(item => item.id)).toContain("Hindi");
    expect(preferences.selected).toBe("English");

    const resources = await caller.roadmap.findResources({ itemId: firstItemId, language: "Hindi" });
    expect(resources.language).toBe("Hindi");
    expect(resources.resources.length).toBeGreaterThan(0);
    for (const resource of resources.resources) {
      expect(resource.url).toMatch(/^https?:\/\//);
      expect(resource.title.length).toBeGreaterThan(3);
      expect(["youtube_video", "youtube_playlist", "course", "website"]).toContain(resource.kind);
    }
    expect(new Set(resources.resources.map(item => item.kind)).size).toBeGreaterThanOrEqual(2);

    const afterPreference = await caller.roadmap.resourcePreference();
    expect(afterPreference.selected).toBe("Hindi"); // saved for future searches

    const stored = await caller.roadmap.itemResources({});
    expect(stored.resources.filter(item => item.roadmapItemId === firstItemId).length).toBe(
      resources.resources.length,
    );

    // Idempotent: re-running replaces instead of duplicating.
    await caller.roadmap.findResources({ itemId: firstItemId, language: "Hindi" });
    const storedAgain = await caller.roadmap.itemResources({ language: "Hindi" });
    expect(storedAgain.resources.filter(item => item.roadmapItemId === firstItemId).length).toBe(
      resources.resources.length,
    );

    /* ---------------------------------------------------------------- */
    /* 5. New opportunity → previous one archived, roadmap rebuilt       */
    /* ---------------------------------------------------------------- */
    const second = await caller.opportunity.analyzeText({ description: JOB_TWO });
    const oppTwo = second.opportunity.id;
    expect(oppTwo).not.toBe(oppOne);
    expect(second.roadmap).toBeTruthy();

    const historyAfterTwo = await caller.opportunity.history();
    expect(historyAfterTwo.snapshots.length).toBe(2);
    expect(historyAfterTwo.currentOpportunityId).toBe(oppTwo);

    const archived = historyAfterTwo.snapshots.find(snapshot => snapshot.opportunityId === oppOne);
    expect(archived, "the previous opportunity must be saved").toBeTruthy();
    expect(archived!.progress.completed).toBe(1);
    expect(archived!.progress.total).toBe(totalTasks);
    expect(archived!.isCurrent).toBe(false);

    const currentTwo = await caller.opportunity.current();
    expect(currentTwo.opportunity?.id).toBe(oppTwo);
    expect(currentTwo.roadmap?.opportunityId).toBe(oppTwo);

    const progressTwo = await caller.roadmap.progress();
    expect(progressTwo.total).toBe(currentTwo.roadmap!.items.length);
    expect(progressTwo.completed).toBe(0);

    /* ---------------------------------------------------------------- */
    /* 6. Progress on the new opportunity does not touch the old one     */
    /* ---------------------------------------------------------------- */
    if (currentTwo.roadmap!.items.length > 1) {
      await caller.roadmap.updateProgress({ itemId: currentTwo.roadmap!.items[1].id, completed: true });
    }
    const progressTwoAfter = await caller.roadmap.progress();
    expect(progressTwoAfter.completed).toBeGreaterThanOrEqual(1);

    const archivedStill = (await caller.opportunity.history()).snapshots.find(
      snapshot => snapshot.opportunityId === oppOne,
    );
    expect(archivedStill!.progress.completed).toBe(1);

    /* ---------------------------------------------------------------- */
    /* 7. Switch back → roadmap, progress and analysis restored          */
    /* ---------------------------------------------------------------- */
    const profileBeforeSwitch = await caller.profile.get();
    const switched = await caller.opportunity.switch({ id: oppOne });
    expect(switched.opportunity.id).toBe(oppOne);
    expect(switched.progress.completed).toBe(1);
    expect(switched.progress.total).toBe(totalTasks);

    const restoredRoadmap = await caller.roadmap.get();
    expect(restoredRoadmap!.opportunityId).toBe(oppOne);
    expect(restoredRoadmap!.items.map(item => item.id)).toEqual(orderBefore.map(item => item.id));
    expect(restoredRoadmap!.items[0].completed).toBe(true);

    const profileAfterSwitch = await caller.profile.get();
    expect(profileAfterSwitch).toEqual(profileBeforeSwitch); // profile never rewritten

    const statsAfterSwitch = await caller.insights.get();
    expect(statsAfterSwitch.stats.currentOpportunityId).toBe(oppOne);
    expect(statsAfterSwitch.stats.roadmapCompleted).toBe(1);

    /* ---------------------------------------------------------------- */
    /* 8. Application tracker: after interview → rejection + reason      */
    /* ---------------------------------------------------------------- */
    const application = await caller.application.create({ opportunityId: oppOne });
    await caller.application.updateStatus({ id: application.id, status: "Interview" });
    const interview = await caller.application.list();
    expect(interview.find(item => item.id === application.id)?.status).toBe("Interview");

    const rejected = await caller.application.resolveAfterInterview({
      id: application.id,
      outcome: "rejected",
      reason: "The panel asked for stronger React and SQL evidence in my projects.",
    });
    expect(rejected.mode).toBe("rejected");
    expect(rejected.application?.status).toBe("Rejected");
    expect(rejected.application?.rejectionReason).toContain("React");
    expect(rejected.feedback, "the reason must be analysed and stored").toBeTruthy();

    const afterRejection = await caller.opportunity.history();
    const archivedWithReason = afterRejection.snapshots.find(snapshot => snapshot.opportunityId === oppOne);
    expect(archivedWithReason!.rejectionReason.length).toBeGreaterThan(0);

    const statsWithRejection = await caller.insights.get();
    expect(statsWithRejection.stats.rejectedApplications).toBe(1);
    expect(
      statsWithRejection.insights.some(insight => insight.title === "Learned from rejections"),
      "accumulated rejection feedback must feed insights",
    ).toBe(true);

    /* ---------------------------------------------------------------- */
    /* 9. Rejection + Skip (no reason)                                   */
    /* ---------------------------------------------------------------- */
    const skippedApp = await caller.application.create({ opportunityId: oppTwo });
    await caller.application.updateStatus({ id: skippedApp.id, status: "Interview" });
    const skipped = await caller.application.resolveAfterInterview({ id: skippedApp.id, outcome: "rejected" });
    expect(skipped.mode).toBe("rejected");
    expect(skipped.application?.status).toBe("Rejected");
    expect(skipped.message).toContain("Add new opportunities");
    expect(skipped.feedback).toBeNull();

    /* ---------------------------------------------------------------- */
    /* 10. Selection → congratulation + success notification             */
    /* ---------------------------------------------------------------- */
    const selectedApp = await caller.application.create({ opportunityId: oppTwo });
    await caller.application.updateStatus({ id: selectedApp.id, status: "Interview" });
    const selected = await caller.application.resolveAfterInterview({
      id: selectedApp.id,
      outcome: "selected",
    });
    expect(selected.mode).toBe("selected");
    expect(selected.application?.status).toBe("Selected");
    expect(selected.message.toLowerCase()).toContain("congratulations");

    const notifications = await caller.notification.list({});
    expect(notifications.notifications.some(item => item.type === "selection")).toBe(true);

    const statsSelected = await caller.insights.get();
    expect(statsSelected.stats.selectedApplications).toBe(1);

    /* ---------------------------------------------------------------- */
    /* 11. Delete opportunity → history + roadmap removed, profile kept  */
    /* ---------------------------------------------------------------- */
    const beforeDeleteStats = await caller.insights.get();
    const deleteResult = await caller.opportunity.delete({ id: oppTwo });
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.profileUntouched).toBe(true);

    const historyAfterDelete = await caller.opportunity.history();
    expect(historyAfterDelete.snapshots.some(snapshot => snapshot.opportunityId === oppTwo)).toBe(false);
    expect(historyAfterDelete.snapshots.some(snapshot => snapshot.opportunityId === oppOne)).toBe(true);

    const opportunitiesAfterDelete = await caller.opportunity.list();
    expect(opportunitiesAfterDelete.some(item => item.id === oppTwo)).toBe(false);

    const roadmapForDeleted = await caller.roadmap.progress();
    expect(roadmapForDeleted.total).toBe(totalTasks); // still the surviving opportunity's roadmap

    const profileAfterDelete = await caller.profile.get();
    expect(profileAfterDelete?.skills.length).toBeGreaterThan(0);
    expect(profileAfterDelete?.name).toBe("Test Student");
    expect((await caller.insights.get()).stats.applications).toBeLessThan(beforeDeleteStats.stats.applications);

    /* ---------------------------------------------------------------- */
    /* 12. Persistence across a restart (reopen the SQLite file)         */
    /* ---------------------------------------------------------------- */
    const beforeRestart = {
      history: await caller.opportunity.history(),
      progress: await caller.roadmap.progress(),
      current: await caller.opportunity.current(),
      preference: await caller.roadmap.resourcePreference(),
      resources: await caller.roadmap.itemResources({}),
      profile: await caller.profile.get(),
    };

    closeDb();
    getDb();

    const afterRestart = {
      history: await caller.opportunity.history(),
      progress: await caller.roadmap.progress(),
      current: await caller.opportunity.current(),
      preference: await caller.roadmap.resourcePreference(),
      resources: await caller.roadmap.itemResources({}),
      profile: await caller.profile.get(),
    };

    expect(afterRestart.history.snapshots.map(item => item.opportunityId)).toEqual(
      beforeRestart.history.snapshots.map(item => item.opportunityId),
    );
    expect(afterRestart.history.currentOpportunityId).toBe(beforeRestart.history.currentOpportunityId);
    expect(afterRestart.progress).toEqual(beforeRestart.progress);
    expect(afterRestart.preference.selected).toBe("Hindi");
    expect(afterRestart.resources.resources.length).toBe(beforeRestart.resources.resources.length);
    expect(afterRestart.profile).toEqual(beforeRestart.profile);
    expect(afterRestart.current.roadmap?.id).toBe(beforeRestart.current.roadmap?.id);

    state.summary = {
      totalTasksOnFirstRoadmap: totalTasks,
      archivedOpportunityProgress: archived!.progress,
      selectedApplications: statsSelected.stats.selectedApplications,
      resourcesStored: afterRestart.resources.resources.length,
      savedLanguage: afterRestart.preference.selected,
    };
    console.log("[NextStep test summary]", JSON.stringify(state.summary, null, 2));
  }, 120_000);
});

afterAll(() => {
  closeDb();
});
