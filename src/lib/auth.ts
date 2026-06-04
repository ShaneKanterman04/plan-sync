/**
 * Auth is OPEN in the MVP: write routes trust the `author` field in the body.
 *
 * To lock it down later, set the `PLAN_API_TOKEN` env var. Every write route
 * already calls `await requireAuth(req)`, so enabling auth requires no route
 * changes — only the env var (and a matching Bearer header from the skill's
 * `scripts/plan` helper, which forwards `PLAN_API_TOKEN` when set).
 */
export class AuthError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireAuth(req: Request): Promise<void> {
  const token = process.env.PLAN_API_TOKEN;
  if (!token) return; // open mode (MVP default)
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${token}`) {
    throw new AuthError();
  }
}
