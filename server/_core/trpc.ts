import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { withAiAction } from "../services/aiUsage";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

/**
 * Every MUTATION runs inside an AI-usage scope: all Gemini calls it triggers
 * are counted and logged under the procedure path (`resume.analyze`,
 * `opportunity.analyzeText`, …) and a summary line reports the total call
 * count, token estimate and response size for that one user action.
 */
const aiUsageMiddleware = t.middleware(async opts => {
  if (opts.type !== "mutation") {
    return opts.next();
  }
  return withAiAction(opts.path, () => opts.next());
});

export const router = t.router;
export const publicProcedure = t.procedure.use(aiUsageMiddleware);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
