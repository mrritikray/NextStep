export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // NextStep AI configuration (server-only; never exposed to the client).
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "",
  // Optional endpoint override. Used by the token-usage verification harness to
  // point the SAME real client code at a counting stub; production leaves it
  // blank and the official Generative Language endpoint is used.
  geminiBaseUrl: process.env.GEMINI_BASE_URL ?? "",
  // Local SQLite database path.
  databasePath: process.env.DATABASE_PATH ?? "",
};
