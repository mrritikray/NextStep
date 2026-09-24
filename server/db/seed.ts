/**
 * Seeds a small set of SAMPLE opportunities so the Opportunities page is not
 * empty on first run. Every row is flagged is_sample = 1 and the UI labels them
 * as sample data. Real analysis only ever uses the job description you supply.
 */
import * as repo from "../db/repositories";
import { extractJobFromText } from "../services/demoFallback";
import { getMeta, setMeta } from "../db/sqlite";

const SAMPLES: Array<{ description: string }> = [
  {
    description: `Frontend Developer Intern
Company: Northstar Labs
Location: Remote
Employment type: Internship
Stipend: ₹15,000 / month

About the role
Northstar Labs is looking for a frontend intern to build accessible product interfaces. You will work closely with designers and backend engineers.

Responsibilities
- Build responsive user interfaces with HTML, CSS and JavaScript
- Implement new components in React and connect them to REST APIs
- Collaborate through Git and code review

Requirements
- Familiarity with HTML, CSS and JavaScript
- Exposure to React or a similar component framework
- Understanding of Git workflows
- Basic understanding of REST APIs and fetch

Preferred
- Experience with Tailwind CSS
- Any deployed personal project`,
  },
  {
    description: `Backend Developer Intern
Company: Mosaic Systems
Location: Bengaluru (Hybrid)
Employment type: Internship (6 months)
Stipend: ₹20,000 / month

Requirements
- Working knowledge of Node.js and Express
- Understanding of SQL databases and schema design
- Familiarity with REST APIs and JSON
- Basic knowledge of Git and Postman

Responsibilities
- Build and maintain REST API endpoints
- Write database queries and migrations
- Debug production issues with senior engineers

Eligibility
- B.Tech / BE / BCA students in any branch, final or pre-final year`,
  },
  {
    description: `Data Analyst Intern
Company: Orbit Learning
Location: Pune (On-site)
Employment type: Internship
Stipend: ₹12,000 / month

Requirements
- Strong Excel skills
- Working knowledge of SQL
- Basic Python for data cleaning
- Ability to present findings clearly

Preferred
- Exposure to Power BI or Tableau
- Understanding of statistics

Responsibilities
- Clean and analyse learner activity data
- Build weekly dashboards
- Present insights to the product team`,
  },
];

export function seedSampleOpportunities(): void {
  if (getMeta("samples_seeded") === "1") return;
  try {
    for (const sample of SAMPLES) {
      const job = extractJobFromText(sample.description);
      repo.createOpportunity({
        ...job,
        description: sample.description,
        source: "sample",
        isSample: true,
      });
    }
    setMeta("samples_seeded", "1");
    console.log(`[Seed] Added ${SAMPLES.length} sample opportunities (clearly labelled as samples).`);
  } catch (error) {
    console.error("[Seed] Failed to seed sample opportunities:", error);
  }
}
