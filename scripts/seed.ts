import { addMessage, putPlanBody, setStatus } from "@/lib/db";

// Seed a sample plan so the UI has something to show on first run.
// Run with: pnpm seed   (optionally PLAN_WORKSPACE=<name> pnpm seed)
const workspace = process.env.PLAN_WORKSPACE || "hostlet";

putPlanBody({
  workspace,
  title: "Welcome to plan-sync",
  author: "agent",
  bodyMd: `# ${workspace} — sample plan

This is a **shared plan document**. An agent wrote this; you (the human) can:

- read it here on your phone,
- tap **Edit** to change it,
- reply in the discussion below,
- then **Approve** (or **Request changes**) to send it back to the agent.

## Example steps
1. First we do the thing.
2. Then we verify the thing.
3. Then we ship it.

Edit me and approve to try the loop.`,
});

setStatus({ workspace, status: "review", author: "agent" });
addMessage({
  workspace,
  author: "agent",
  body: "Seeded a sample plan. Edit it and approve to try the round-trip.",
});

console.log(`Seeded workspace "${workspace}".`);
