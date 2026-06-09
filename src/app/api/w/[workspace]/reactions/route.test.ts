/**
 * @jest-environment node
 */

import { GET as planGet, PUT } from "@/app/api/w/[workspace]/route";
import { POST as messagePost } from "@/app/api/w/[workspace]/messages/route";
import { POST as reactionPost } from "@/app/api/w/[workspace]/reactions/route";

function ctx(workspace: string) {
  return { params: Promise.resolve({ workspace }) };
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedMessage(workspace: string): Promise<string> {
  await PUT(
    jsonRequest(`/api/w/${workspace}`, "PUT", { author: "agent", bodyMd: "# Plan" }),
    ctx(workspace),
  );
  const res = await messagePost(
    jsonRequest(`/api/w/${workspace}/messages`, "POST", {
      author: "human",
      body: "Please review.",
    }),
    ctx(workspace),
  );
  const data = await res.json();
  return data.message.id as string;
}

describe("reactions API", () => {
  test("POST toggles a reaction on then off for the same emoji", async () => {
    const ws = "react-toggle";
    const messageId = await seedMessage(ws);

    const on = await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "human",
        messageId,
        emoji: "👍",
      }),
      ctx(ws),
    );
    expect(on.status).toBe(200);
    const onData = await on.json();
    expect(onData.toggled).toBe("on");
    expect(onData.reaction).toMatchObject({ messageId, emoji: "👍", author: "human" });

    const off = await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "human",
        messageId,
        emoji: "👍",
      }),
      ctx(ws),
    );
    expect(off.status).toBe(200);
    const offData = await off.json();
    expect(offData.toggled).toBe("off");
    expect(offData.reaction).toBeNull();
  });

  test("POST rejects an emoji outside the allow-list", async () => {
    const ws = "react-bad-emoji";
    const messageId = await seedMessage(ws);

    const res = await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "human",
        messageId,
        emoji: "🚀",
      }),
      ctx(ws),
    );
    expect(res.status).toBe(400);
  });

  test("POST rejects an unknown messageId", async () => {
    const ws = "react-unknown";
    await seedMessage(ws);

    const res = await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "human",
        messageId: "does-not-exist",
        emoji: "✅",
      }),
      ctx(ws),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message not found" });
  });

  test("GET workspace surfaces the reaction count after reacting", async () => {
    const ws = "react-count";
    const messageId = await seedMessage(ws);

    await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "human",
        messageId,
        emoji: "🎉",
      }),
      ctx(ws),
    );

    const res = await planGet(new Request(`http://localhost/api/w/${ws}`), ctx(ws));
    const data = await res.json();
    const message = data.messages.find((m: { id: string }) => m.id === messageId);
    // The full-plan GET passes viewer "human", so a human-owned reaction is mine:true.
    expect(message.reactions).toEqual([{ emoji: "🎉", count: 1, mine: true }]);
  });

  test("GET marks an agent-authored reaction as not owned by the human viewer", async () => {
    const ws = "react-other-author";
    const messageId = await seedMessage(ws);

    await reactionPost(
      jsonRequest(`/api/w/${ws}/reactions`, "POST", {
        author: "agent",
        messageId,
        emoji: "👀",
      }),
      ctx(ws),
    );

    const res = await planGet(new Request(`http://localhost/api/w/${ws}`), ctx(ws));
    const data = await res.json();
    const message = data.messages.find((m: { id: string }) => m.id === messageId);
    // Viewer is "human"; the reaction belongs to "agent", so it must NOT be mine.
    expect(message.reactions).toEqual([{ emoji: "👀", count: 1, mine: false }]);
  });
});
