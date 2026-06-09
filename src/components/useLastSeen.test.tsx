import "@testing-library/jest-dom";
import { act, renderHook } from "@testing-library/react";
import { useLastSeen } from "@/components/useLastSeen";

describe("useLastSeen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("unreadCount is messageCount minus the persisted seen count, floored at 0", () => {
    const { result } = renderHook(() => useLastSeen("ws-unread"));

    // Never seen: every message is unread.
    expect(
      result.current.unreadCount({ lastMessageAt: "t5", messageCount: 5 }),
    ).toBe(5);

    // After seeing 3, only 2 of 5 remain unread.
    act(() => result.current.markSeen({ lastMessageAt: "t3", messageCount: 3 }));
    expect(
      result.current.unreadCount({ lastMessageAt: "t5", messageCount: 5 }),
    ).toBe(2);

    // A snapshot at-or-below the seen count never goes negative.
    expect(
      result.current.unreadCount({ lastMessageAt: "t3", messageCount: 3 }),
    ).toBe(0);
    expect(
      result.current.unreadCount({ lastMessageAt: "t2", messageCount: 2 }),
    ).toBe(0);
  });

  test("markSeen drops unreadCount to 0 for the seen snapshot", () => {
    const { result } = renderHook(() => useLastSeen("ws-mark"));
    const snap = { lastMessageAt: "2026-06-09T00:00:00.000Z", messageCount: 7 };

    expect(result.current.unreadCount(snap)).toBe(7);
    act(() => result.current.markSeen(snap));
    expect(result.current.unreadCount(snap)).toBe(0);
  });

  test("firstUnreadAfter is null on first view and equals the persisted timestamp after markSeen", () => {
    const { result } = renderHook(() => useLastSeen("ws-divider"));

    expect(result.current.firstUnreadAfter).toBeNull();

    const at = "2026-06-09T12:34:56.000Z";
    act(() => result.current.markSeen({ lastMessageAt: at, messageCount: 4 }));
    expect(result.current.firstUnreadAfter).toBe(at);
    expect(result.current.lastSeenAt).toBe(at);
    expect(result.current.lastSeenCount).toBe(4);
  });

  test("persists across remounts under plansync:lastSeen:WORKSPACE", () => {
    const first = renderHook(() => useLastSeen("ws-persist"));
    act(() =>
      first.result.current.markSeen({ lastMessageAt: "t9", messageCount: 9 }),
    );
    first.unmount();

    expect(localStorage.getItem("plansync:lastSeen:ws-persist")).toBe(
      JSON.stringify({ at: "t9", count: 9 }),
    );

    const second = renderHook(() => useLastSeen("ws-persist"));
    expect(second.result.current.lastSeenCount).toBe(9);
    expect(
      second.result.current.unreadCount({ lastMessageAt: "t9", messageCount: 9 }),
    ).toBe(0);
  });

  test("survives localStorage throwing on both read and write", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    const { result } = renderHook(() => useLastSeen("ws-throws"));
    // Read threw → defaults; computation still works.
    expect(result.current.lastSeenCount).toBe(0);
    expect(
      result.current.unreadCount({ lastMessageAt: "t2", messageCount: 2 }),
    ).toBe(2);

    // Write throws but must not bubble out of markSeen.
    expect(() =>
      act(() =>
        result.current.markSeen({ lastMessageAt: "t1", messageCount: 1 }),
      ),
    ).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
