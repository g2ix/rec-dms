import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosaveQueue, type AutosaveResult } from "@/lib/forms/autosave";

afterEach(() => {
  vi.useRealTimers();
});

describe("flushAll", () => {
  it("saves every pending field immediately and sequentially", async () => {
    const order: string[] = [];
    let revision = 1;
    const save = vi.fn(async (input: { path: string; value: unknown; expectedRevision: number }) => {
      order.push(input.path);
      revision += 1;
      await Promise.resolve();
      return {
        ok: true as const,
        revision,
        data: { [input.path]: input.value },
        writtenPaths: [input.path],
      } satisfies AutosaveResult;
    });

    const queue = createAutosaveQueue({
      debounceMs: 800,
      getRevision: () => revision,
      save,
    });

    queue.schedule("title", "First");
    queue.schedule("summary", "Second");
    expect(save).not.toHaveBeenCalled();

    const result = await queue.flushAll();
    expect(result).toBe("ok");
    expect(order).toEqual(["title", "summary"]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]?.[0]).toMatchObject({ path: "title", value: "First", expectedRevision: 1 });
    expect(save.mock.calls[1]?.[0]).toMatchObject({ path: "summary", value: "Second", expectedRevision: 2 });
    expect(queue.isDirty()).toBe(false);
  });

  it("returns failed when a save errors and keeps the field dirty", async () => {
    const save = vi.fn(async (input: { path: string }) => {
      if (input.path === "bad") {
        return { ok: false as const, code: "INVALID", message: "Too short." };
      }
      return {
        ok: true as const,
        revision: 2,
        data: { good: "ok" },
        writtenPaths: ["good"],
      };
    });

    const queue = createAutosaveQueue({
      getRevision: () => 1,
      save,
    });
    queue.schedule("good", "ok");
    queue.schedule("bad", "");

    expect(await queue.flushAll()).toBe("failed");
    expect(queue.hasFailed()).toBe(true);
    expect(queue.isDirty()).toBe(true);
    expect(queue.pendingEntries().map((entry) => entry.path)).toContain("bad");
  });

  it("keeps conflict handling and skips blocked fields", async () => {
    const save = vi.fn(async (input: { path: string; expectedRevision: number }) => {
      if (input.path === "title") {
        return {
          ok: false as const,
          code: "CONFLICT" as const,
          revision: 5,
          value: "theirs",
          changedBy: { id: "u1", name: "Ana" },
          changedAt: "2026-11-10T00:00:00.000Z",
        };
      }
      return {
        ok: true as const,
        revision: input.expectedRevision + 1,
        data: { other: "saved" },
        writtenPaths: ["other"],
      };
    });

    const conflicts: string[] = [];
    const queue = createAutosaveQueue({
      getRevision: () => 1,
      save,
      hooks: {
        onUi: (path, ui) => {
          if (ui.state === "conflict") conflicts.push(path);
        },
      },
    });
    queue.schedule("title", "mine");
    queue.schedule("other", "saved");

    expect(await queue.flushAll()).toBe("ok");
    expect(conflicts).toEqual(["title"]);
    expect(save.mock.calls.map((call) => call[0].path)).toEqual(["title", "other"]);
  });

  it("cancels the debounce timer so a leave does not wait 800 ms", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => ({
      ok: true as const,
      revision: 2,
      data: { title: "now" },
      writtenPaths: ["title"],
    }));
    const queue = createAutosaveQueue({
      debounceMs: 800,
      getRevision: () => 1,
      save,
    });
    queue.schedule("title", "now");
    expect(save).not.toHaveBeenCalled();
    await queue.flushAll();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
