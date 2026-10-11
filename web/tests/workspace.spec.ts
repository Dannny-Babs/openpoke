import { test, expect, type Page } from "@playwright/test";

const REQUEST = "12345678-1234-4123-8123-123456789abc";
const taskId = (index: number) => index.toString(16).padStart(64, "0");
const stamp = "2026-10-11T12:00:00.000Z";

async function fixture(page: Page, initialMessages: object[] = []) {
  const state = {
    messages: initialMessages,
    status: "running",
    polls: 0,
    historyPolls: 0,
    taskPolls: 0,
    gmailCalls: 0,
    submissions: [] as Record<string, unknown>[],
    partial: "",
    final: "",
    savedReply: "Saved Nora draft only",
    delaySend: false,
    releaseSend: () => {},
  };
  const tasks = Array.from({ length: 40 }, (_, index) => ({
    id: taskId(index),
    name: index === 39 ? "Nora interview draft" : `Saved task ${index}`,
    name_truncated: false,
    last_activity: stamp,
    history_ambiguous: false,
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/preview") body = { demo: true, liveTest: false };
    else if (url.pathname.startsWith("/api/gmail")) {
      state.gmailCalls++;
      body = { connected: false };
    } else if (url.pathname === "/api/tasks") {
      state.taskPolls++;
      const q = url.searchParams.get("q") || "";
      const rows = tasks.filter((task) =>
        task.name.toLowerCase().includes(q.toLowerCase()),
      );
      const offset = Number(url.searchParams.get("cursor") || 0);
      body = {
        tasks: rows.slice(offset, offset + 20),
        total: rows.length,
        next_cursor: offset + 20 < rows.length ? String(offset + 20) : null,
      };
    } else if (
      url.pathname.endsWith("/history") &&
      url.pathname.startsWith("/api/tasks/")
    ) {
      body = {
        entries: [
          {
            kind: "agent_request",
            timestamp: stamp,
            content: "Private Nora task request",
            truncated: false,
          },
          {
            kind: "agent_response",
            timestamp: stamp,
            content: state.savedReply,
            truncated: false,
          },
        ],
        start_offset: 0,
        before_offset: null,
        next_offset: null,
      };
    } else if (url.pathname === "/api/chat/history") {
      state.historyPolls++;
      body = { messages: state.messages };
    } else if (
      url.pathname === "/api/chat" &&
      route.request().method() === "POST"
    ) {
      const submission = route.request().postDataJSON();
      state.submissions.push(submission);
      if (state.delaySend)
        await new Promise<void>((resolve) => {
          state.releaseSend = resolve;
        });
      state.messages = [
        ...state.messages,
        {
          id: "submitted-user",
          role: "user",
          content: submission.messages[0].content,
          request_id: REQUEST,
          task_id: taskId(39),
        },
      ];
      body = { request_id: REQUEST, status: "queued", task_id: taskId(39) };
    } else if (url.pathname.startsWith("/api/chat/requests/")) {
      state.polls++;
      body = {
        request_id: url.pathname.split("/").pop(),
        status: state.status,
        task_id: taskId(39),
        origin: "chat",
        error: null,
        created_at: stamp,
        updated_at:
          state.status === "succeeded" ? "2026-10-11T12:01:00.000Z" : stamp,
        runs: [
          {
            id: "run-nora",
            task_id: taskId(39),
            task_name: "Nora interview draft",
            status: state.status,
            error: null,
            response: state.final || null,
            partial_response: state.partial || null,
          },
        ],
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return state;
}
const gap = (page: Page) =>
  page
    .locator(".message-scroll")
    .evaluate(
      (element) =>
        element.scrollHeight - element.scrollTop - element.clientHeight,
    );
const composer = (page: Page) =>
  page.getByRole("combobox", { name: "Your next request" });

// Forty saved tasks deliberately exceed one page and the initial routing shortlist.
test("saved task selection is read-only and continuation retains the real worker name", async ({
  page,
}) => {
  const state = await fixture(page, [
    {
      id: "global",
      role: "assistant",
      content: "Unrelated global conversation",
    },
    {
      id: "older-input",
      role: "user",
      content: "Earlier background input",
      request_id: "87654321-4321-4321-8321-cba987654321",
      task_id: taskId(39),
    },
  ]);
  await page.goto("/");
  const controls = page.locator(".sidebar-controls");
  const before = await controls.boundingBox();
  await page.getByRole("button", { name: "Load more tasks" }).click();
  await expect(page.locator(".task-list button")).toHaveCount(40);
  await page.locator(".sidebar-list").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await controls.boundingBox())?.y).toBe(before?.y);
  await page.getByRole("navigation", { name: "Saved tasks" }).getByRole("button", { name: /Nora interview draft/ }).click();
  await expect(page.locator(".conversation-heading h1")).toHaveText(
    "Nora interview draft",
  );
  await expect(page.getByText("Saved Nora draft only")).toBeVisible();
  await expect(page.getByText("Unrelated global conversation")).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
  await expect.poll(() => state.polls).toBeGreaterThan(0);
  const refreshPolls = state.taskPolls;
  state.status = "succeeded";
  await expect.poll(() => state.taskPolls).toBeGreaterThan(refreshPolls);
  await expect(page.locator(".conversation-heading h1")).toHaveText(
    "Nora interview draft",
  );
  await expect(page.locator(".task-list button")).toHaveCount(40);
  state.status = "running";
  await page.getByRole("button", { name: "Continue this task" }).click();
  await expect(composer(page)).toBeFocused();
  await expect(page.locator(".conversation-heading h1")).toHaveText(
    "Nora interview draft",
  );
  await expect(page.locator(".composer")).toContainText("Nora interview draft");
  await composer(page).fill("Make Friday work");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0].task_id).toBe(taskId(39));
  state.status = "succeeded";
  state.messages = [
    ...state.messages,
    {
      id: "nora-final",
      role: "draft",
      request_id: REQUEST,
      task_id: taskId(39),
      content: "To: nora@example.invalid\nSubject: Friday\n\nFriday works.",
    },
  ];
  await expect(
    page.getByRole("button", { name: "Continue this task" }),
  ).toHaveCount(0);
  await expect(page.locator(".composer")).toContainText("Nora interview draft");
  await expect(page.locator(".task-list button")).toHaveCount(40);
});

test("send stays pinned across active work and long results, while deliberate reading survives polling", async ({
  page,
}) => {
  const history = Array.from({ length: 15 }, (_, index) => ({
    id: `old-${index}`,
    role: "assistant",
    content:
      `Earlier result ${index}\n\n` + "Useful older context. ".repeat(25),
  }));
  const state = await fixture(page, history);
  await page.goto("/");
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
  await composer(page).fill("Continue Nora");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect(page.locator(".active-work")).toBeVisible();
  await expect(composer(page)).toBeFocused();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
  await page.locator(".active-work summary").click();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
  const readerTop = await page
    .locator(".message-scroll")
    .evaluate((element) => {
      element.scrollTop = 150;
      return element.scrollTop;
    });
  await expect(page.getByRole("button", { name: /^Latest/ })).toBeVisible();
  const pollCount = state.polls;
  await expect.poll(() => state.polls).toBeGreaterThanOrEqual(pollCount + 2);
  expect(
    await page
      .locator(".message-scroll")
      .evaluate((element) => element.scrollTop),
  ).toBe(readerTop);
  state.partial = "Growing provisional answer. ".repeat(250);
  await expect(page.locator(".working-output")).toContainText(
    "Growing provisional answer",
  );
  expect(
    await page
      .locator(".message-scroll")
      .evaluate((element) => element.scrollTop),
  ).toBe(readerTop);
  await page.getByRole("button", { name: /^Latest/ }).click();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
  state.final = "Final Nora result. ".repeat(300);
  state.messages = [
    ...state.messages,
    {
      id: "final",
      role: "assistant",
      request_id: REQUEST,
      task_id: taskId(39),
      content: state.final,
    },
  ];
  state.status = "succeeded";
  await expect(page.getByText(state.final, { exact: true })).toBeVisible();
  await expect(page.locator(".active-work")).toHaveCount(0);
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
});

test("submission does not steal focus after the user moves to saved-work search", async ({
  page,
}) => {
  const state = await fixture(page);
  state.delaySend = true;
  await page.goto("/");
  await composer(page).fill("A new draft");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => state.submissions.length).toBe(1);
  const search = page.getByRole("searchbox", { name: "Search saved tasks" });
  await search.focus();
  state.releaseSend();
  await expect(page.locator(".active-work")).toBeVisible();
  await expect(search).toBeFocused();
});

test("mobile saved-work dialog has unique IDs, restores focus, and demo settings cannot contact Gmail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Saved tasks",
    exact: true,
  });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Saved tasks" })).toBeVisible();
  const duplicates = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll("[id]")).map(
      (element) => element.id,
    );
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicates).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Saved tasks" })).toHaveCount(
    0,
  );
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: /New task/ }).click();
  await expect(page.getByRole("dialog", { name: "Saved tasks" })).toHaveCount(
    0,
  );
  await expect(composer(page)).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("Gmail is disabled in this mode.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#settings-timezone")).toBeDisabled();
  expect(state.gmailCalls).toBe(0);
});

test("older draft resolves its exact name and rejected keyboard sends preserve the draft", async ({
  page,
}) => {
  const id = taskId(39);
  const state = await fixture(page, [
    {
      id: "old-draft",
      role: "draft",
      content:
        "To: nora@example.invalid\nSubject: Older draft\n\nPlease review.",
      task_id: id,
    },
  ]);
  let lookups = 0;
  await page.route("**/api/tasks/" + id, (route) => {
    lookups++;
    return route.fulfill({
      json: {
        id,
        name: "Nora interview draft",
        name_truncated: false,
        history_ambiguous: false,
      },
    });
  });
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Fixture rejected stale target" },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue this task", exact: true })
    .click();
  await expect(page.locator(".task-target")).toContainText(
    "Nora interview draft",
  );
  expect(lookups).toBe(1);
  expect(state.submissions).toHaveLength(0);
  await composer(page).fill("Keep this draft");
  await composer(page).press("Shift+Enter");
  await composer(page).press("Enter");
  await expect(
    page.getByText("Request rejected: Fixture rejected stale target"),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue("Keep this draft");
  await expect(composer(page)).toBeFocused();
  await expect(page.locator(".task-target")).toContainText(
    "Nora interview draft",
  );
});

test("unknown or failed mode blocks sending and integration requests", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.route("**/api/preview", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture mode unavailable" } }),
  );
  await page.goto("/");
  await expect(page.getByText(/Could not verify app mode/)).toBeVisible();
  await composer(page).fill("Do not dispatch while mode is unknown");
  await expect(page.getByRole("button", { name: /^Send/ })).toBeDisabled();
  await composer(page).press("Enter");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect Gmail" }),
  ).toBeDisabled();
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});

test("a pending older-task lookup cannot dispatch or override New task", async ({
  page,
}) => {
  const id = taskId(39);
  const state = await fixture(page, [
    {
      id: "old-draft",
      role: "draft",
      content:
        "To: nora@example.invalid\nSubject: Old saved work\n\nReview this.",
      task_id: id,
    },
  ]);
  let release = () => {};
  let requested = false;
  await page.route("**/api/tasks/" + id, async (route) => {
    requested = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: {
        id,
        name: "Nora interview draft",
        name_truncated: false,
        history_ambiguous: false,
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue this task", exact: true })
    .click();
  await expect.poll(() => requested).toBe(true);
  await composer(page).fill("Keep this new request");
  await expect(page.getByRole("button", { name: /^Send/ })).toBeDisabled();
  await composer(page).press("Enter");
  expect(state.submissions).toHaveLength(0);
  await page.getByRole("button", { name: /New task/ }).click();
  release();
  await expect(page.getByRole("button", { name: /^Send/ })).toBeEnabled();
  await expect(page.locator(".task-target")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Keep this new request");
});

test("adapted task rows keep real failure state, manual disclosure and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await fixture(page, [{ id: "row-input", role: "user", content: "Review the Nora draft", request_id: REQUEST, task_id: taskId(39) }]);
  state.partial = "A provisional draft for review.";
  await page.goto("/");
  const row = page.locator(".inline-task-status .task-run-row");
  await expect(row).toHaveAttribute("data-status", "running");
  const toggle = row.getByRole("button", { name: /Nora interview draft/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const ring = row.locator(".spinning");
  expect(await ring.evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName))).toEqual(["none", "none"]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  state.partial = "The next received chunk.";
  await expect(row.locator(".working-output")).toContainText("The next received chunk.");
  await expect(row.locator(".task-run-details")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.press("Enter");
  await expect(row.locator(".task-run-details")).toBeVisible();
  state.status = "failed";
  state.partial = "";
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row.locator(".task-run-status")).toHaveText("Failed");
  await expect(row.locator(".spinning")).toHaveCount(0);
  await expect(page.locator(".active-work-row")).toHaveCount(0);
  // Further unrelated history updates must never trigger the reference's demo recovery.
  const polls = state.historyPolls;
  await expect.poll(() => state.historyPolls).toBeGreaterThan(polls);
  await expect(row).toHaveAttribute("data-status", "failed");
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});


test("prompt suggestions and keyboard shortcuts prepare a request without dispatching", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use prompt", exact: true }).click();
  await expect(composer(page)).toHaveValue(/Draft a friendly email/);
  await expect(composer(page)).toBeFocused();
  expect(state.submissions).toHaveLength(0);
  await composer(page).fill("/compare");
  await expect(page.getByRole("listbox", { name: "Prompt shortcuts" })).toBeVisible();
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue(/Compare .*Explain the tradeoffs/);
  expect(state.submissions).toHaveLength(0);
  await composer(page).fill("Make it shorter @Nora");
  await expect(page.getByRole("option", { name: /Nora interview draft/ })).toBeVisible();
  await composer(page).press("Enter");
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  await expect(composer(page)).toHaveValue("Make it shorter");
  expect(state.submissions).toHaveLength(0);
  await composer(page).press("Enter");
  await expect.poll(() => state.submissions.length).toBe(1);
  expect(state.submissions[0].task_id).toBe(taskId(39));
});

test("latest task history loads older records without moving the reader and keeps new results discoverable", async ({ page }) => {
  const state = await fixture(page, [{id: "active-old", role: "user", content: "Background task", request_id: REQUEST, task_id: taskId(39)}]);
  const entries = Array.from({length: 45}, (_, index) => ({kind: "agent_response", timestamp: stamp, content: `Task record ${index}. ` + "Saved context. ".repeat(55), truncated: false}));
  const calls: string[] = [];
  await page.route("**/api/tasks/*/history?*", async route => {
    const url = new URL(route.request().url()); calls.push(url.search);
    const end = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : entries.length;
    const start = Math.max(0, end - 20);
    await route.fulfill({json: {entries: entries.slice(start, end), start_offset: start, before_offset: start || null, next_offset: end < entries.length ? end : null}});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Load more tasks" }).click();
  await page.getByRole("navigation", {name: "Saved tasks"}).getByRole("button", {name: /Nora interview draft/}).click();
  await expect(page.locator("[data-history-offset]")).toHaveCount(20);
  expect(calls[0]).toContain("latest=true");
  await expect(page.locator('[data-history-offset="44"]')).toBeVisible();
  await expect(page.locator('[data-history-offset="0"]')).toHaveCount(0);
  await page.locator(".message-scroll").evaluate(node => { node.scrollTop = 0; });
  const anchor = page.locator('[data-history-offset="25"]');
  const initialY = (await anchor.boundingBox())!.y;
  await page.getByRole("button", {name: "Load earlier", exact: true}).click();
  await expect(page.locator("[data-history-offset]")).toHaveCount(40);
  expect(calls.some(call => call.includes("before=25"))).toBe(true);
  expect(Math.abs((await anchor.boundingBox())!.y - initialY)).toBeLessThanOrEqual(2);
  const readingTop = await page.locator(".message-scroll").evaluate(node => node.scrollTop);
  entries.push({kind: "agent_response", timestamp: stamp, content: "New final result. " + "Fresh context. ".repeat(55), truncated: false});
  state.status = "succeeded";
  await expect(page.locator('[data-history-offset="45"]')).toHaveCount(1);
  expect(await page.locator(".message-scroll").evaluate(node => node.scrollTop)).toBe(readingTop);
  await expect(page.getByRole("button", {name: /^Latest/})).toBeVisible();
  await page.getByRole("button", {name: /^Latest/}).click();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(2);
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});

test("reply follow-up is a local review step and retains exact task ownership on rejection", async ({ page }) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  const state = await fixture(page);
  let posts = 0;
  await page.route("**/api/chat", async route => {
    posts++;
    expect(route.request().postDataJSON().task_id).toBe(taskId(39));
    await route.fulfill({status: 409, json: {error: "Fixture target rejected"}});
  });
  await page.goto("/");
  await page.getByRole("button", {name: "Load more tasks"}).click();
  await page.getByRole("navigation", {name: "Saved tasks"}).getByRole("button", {name: /Nora interview draft/}).click();
  await page.getByRole("button", {name: "Ask about reply", exact: true}).click();
  await expect(page.getByRole("heading", {name: "What would you like to do with this?"})).toBeVisible();
  await page.setViewportSize({width: 390, height: 844});
  const add = page.getByRole("button", {name: "Add to prompt"});
  await expect(add).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path: "/tmp/openpoke-review-mobile390.png"});
  expect(posts).toBe(0);
  await page.getByRole("radio", {name: "Make it shorter", exact: true}).check();
  await page.getByRole("button", {name: "Add to prompt"}).click();
  await expect(composer(page)).toHaveValue(/Make it shorter/);
  await expect(composer(page)).toHaveValue(/Saved Nora draft only/);
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  expect(posts).toBe(0);
  const draft = await composer(page).inputValue();
  await composer(page).press("Enter");
  await expect(page.getByText("Request rejected: Fixture target rejected")).toBeVisible();
  await expect(composer(page)).toHaveValue(draft);
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  expect(posts).toBe(1);
  expect(state.gmailCalls).toBe(0);
});

test("selected answer text offers copy feedback and local follow-up without dispatch", async ({ page, context }) => {
  const state = await fixture(page, [{id: "selection-answer", role: "assistant", content: "A specific answer worth discussing."}]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const answer = page.locator("[data-selectable-answer]").filter({hasText: "A specific answer worth discussing."});
  await answer.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    node.dispatchEvent(new PointerEvent("pointerup", {bubbles: true}));
  });
  const toolbar = page.getByRole("toolbar", {name: "Selected text actions"});
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", {name: "Copy", exact: true}).click();
  await expect(page.getByText("Copied selection", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("A specific answer worth discussing.");
  await toolbar.getByRole("button", {name: "Ask about this", exact: true}).click();
  await expect(page.getByRole("heading", {name: "What would you like to do with this?"})).toBeVisible();
  await page.getByRole("textbox", {name: "Custom instruction for selection"}).fill("Check this reasoning");
  await page.getByRole("button", {name: "Add to prompt"}).click();
  await expect(composer(page)).toHaveValue(/Check this reasoning/);
  await expect(composer(page)).toHaveValue(/A specific answer worth discussing/);
  expect(state.submissions).toHaveLength(0);
});

test("activity filters and search reflect receipt state and Escape returns focus", async ({ page }) => {
  const failed = "87654321-4321-4321-8321-cba987654321";
  const state = await fixture(page, [
    {id: "running-input", role: "user", content: "Nora work", request_id: REQUEST, task_id: taskId(39)},
    {id: "failed-input", role: "user", content: "Comparison work", request_id: failed, task_id: taskId(1)},
  ]);
  await page.route("**/api/chat/requests/" + failed, route => route.fulfill({json: {
    request_id: failed, status: "failed", origin: "chat", task_id: taskId(1), error: "Fixture failed", created_at: stamp, updated_at: stamp,
    runs: [{id: "failed-run", task_id: taskId(1), task_name: "Options comparison", status: "failed", response: null, partial_response: null, error: "Fixture failed"}],
  }}));
  await page.goto("/");
  await expect.poll(() => state.polls).toBeGreaterThan(0);
  const trigger = page.getByRole("button", {name: "Activity", exact: true});
  await trigger.click();
  const dialog = page.getByRole("dialog", {name: "Recent activity"});
  await expect(dialog.getByRole("row")).toHaveCount(3);
  await dialog.getByRole("button", {name: /^Needs review/}).click();
  await expect(dialog.getByRole("row")).toHaveCount(2);
  await expect(dialog.getByRole("cell", {name: "Options comparison", exact: true})).toBeVisible();
  await dialog.getByRole("button", {name: /^Active/}).click();
  await expect(dialog.getByRole("cell", {name: "Nora interview draft", exact: true})).toBeVisible();
  await dialog.getByRole("textbox", {name: "Search recent activity"}).fill("no matching request");
  await expect(dialog.getByText("No requests match these filters.")).toBeVisible();
  await dialog.getByRole("textbox", {name: "Search recent activity"}).fill("Nora");
  await expect(dialog.getByRole("row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(state.submissions).toHaveLength(0);
});

test("Enter while a saved-task suggestion has no matches remains local until dismissed", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/");
  await composer(page).fill("Continue @does-not-exist");
  await expect(page.getByText("No matches. Try another name.")).toBeVisible();
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("Continue @does-not-exist");
  await expect(composer(page)).toHaveAttribute("aria-expanded", "true");
  expect(state.submissions).toHaveLength(0);
  await composer(page).press("Escape");
  await expect(composer(page)).toHaveAttribute("aria-expanded", "false");
  await composer(page).press("Enter");
  await expect.poll(() => state.submissions.length).toBe(1);
});

test("message navigator cancellation preserves task reading and a chosen result navigates deliberately", async ({ page }) => {
  const state = await fixture(page, [
    { id: "navigation-first", role: "user", content: "First navigation request" },
    { id: "navigation-answer", role: "assistant", content: "A saved conversation answer" },
    { id: "navigation-second", role: "user", content: "Second navigation request" },
  ]);
  await page.route("**/api/tasks/*/history?*", route => route.fulfill({json: {
    entries: Array.from({length:20},(_, index) => ({kind:"agent_response",timestamp:stamp,content:`Reading record ${index}. ` + "Retained history. ".repeat(40),truncated:false})),
    start_offset:0,before_offset:null,next_offset:null,
  }}));
  await page.goto("/");
  await composer(page).fill("Keep this unsent draft");
  await page.getByRole("button", {name:"Load more tasks"}).click();
  await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/Nora interview draft/}).click();
  await expect(page.locator("[data-history-offset]")).toHaveCount(20);
  await page.locator(".message-scroll").evaluate(node => {node.scrollTop = 200; node.dispatchEvent(new Event("scroll"));});
  const readingPosition = await page.locator(".message-scroll").evaluate(node => node.scrollTop);
  expect(readingPosition).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Your messages",exact:true}).click();
  await page.getByRole("dialog",{name:"Your messages"}).press("Escape");
  await expect(page.getByRole("heading",{name:"Nora interview draft",exact:true})).toBeVisible();
  expect(await page.locator(".message-scroll").evaluate(node => node.scrollTop)).toBe(readingPosition);
  await expect(page.getByRole("button",{name:"Your messages",exact:true})).toBeFocused();
  await expect(composer(page)).toHaveValue("Keep this unsent draft");
  await page.getByRole("button",{name:"Your messages",exact:true}).click();
  await page.getByRole("searchbox",{name:"Search your messages"}).fill("second navigation");
  const matches = page.getByRole("navigation",{name:"Jump to a message"}).getByRole("button");
  await expect(matches).toHaveCount(1);
  await matches.click();
  await expect(page.getByRole("heading",{name:"All messages",exact:true})).toBeVisible();
  await expect(page.locator("#chat-message-2")).toBeFocused();
  await expect(composer(page)).toHaveValue("Keep this unsent draft");
  expect(state.submissions).toHaveLength(0);
});

for (const mobile of [false,true]) test(`New task clears quoted follow-up ownership without losing draft (${mobile?"mobile":"desktop"})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({width:390,height:844});
  const state=await fixture(page,[{id:"target-draft",role:"assistant",content:"To: nora@example.invalid\nSubject: Saved draft\n\nA fixture reply.",task_id:taskId(39)}]);
  await page.goto("/");
  await composer(page).fill("@Nora");
  await expect(page.getByRole("option",{name:/Nora interview draft/})).toBeVisible();
  await composer(page).press("Enter");
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  await composer(page).fill("My independent unsent idea");
  await page.getByRole("button",{name:"Ask about reply",exact:true}).click();
  await expect(page.getByRole("heading",{name:"What would you like to do with this?"})).toBeVisible();
  if (mobile) await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
  await page.getByRole("button",{name:"New task",exact:true}).click();
  await expect(page.locator(".prompt-review-card")).toHaveCount(0);
  await expect(page.locator(".task-target")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("My independent unsent idea");
  await expect(composer(page)).toBeFocused();
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});

for (const mobile of [false, true]) test(`activity navigation discards an unrelated quote while preserving draft and exact target (${mobile ? "mobile" : "desktop"})`, async ({page}) => {
  if (mobile) await page.setViewportSize({width:390,height:844});
  const state = await fixture(page, [{id:"activity-input",role:"user",content:"Inspect this request",request_id:REQUEST,task_id:taskId(39)}]);
  await page.goto("/");
  await composer(page).fill("@Nora");
  await page.getByRole("option", {name:"Nora interview draft"}).click();
  await composer(page).fill("Keep this independent unsent draft");
  if (mobile) await page.getByRole("button", {name:"Saved tasks",exact:true}).click();
  await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/^Saved task 0\b/}).click();
  await page.getByRole("button",{name:"Ask about reply"}).click();
  await expect(page.locator(".prompt-review-card")).toBeVisible();
  const trigger = page.getByRole("button",{name:"Activity",exact:true});
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".conversation-heading h1")).toHaveText("Saved task 0");
  await expect(page.locator(".prompt-review-card")).toBeVisible();
  await trigger.click();
  await page.getByRole("button",{name:"View request for Nora interview draft"}).click();
  await expect(page.getByRole("dialog",{name:"Recent activity"})).toHaveCount(0);
  await expect(page.locator(".conversation-heading h1")).toHaveText("Nora interview draft");
  await expect(page.locator(".prompt-review-card")).toHaveCount(0);
  await expect(page.locator("#chat-message-0")).toBeFocused();
  await expect(composer(page)).toHaveValue("Keep this independent unsent draft");
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});

test("mobile activity search clears and resets locally without changing the reader", async ({page}, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  const state = await fixture(page, [{id:"activity-input",role:"user",content:"Inspect this request",request_id:REQUEST,task_id:taskId(39)}]);
  await page.goto("/");
  await composer(page).fill("Unsent draft remains here");
  await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
  const search = page.getByRole("searchbox",{name:"Search saved tasks",exact:true});
  await search.fill("Nora");
  await search.press("Enter");
  await expect(page.getByRole("status").filter({hasText:"1 matching task"})).toHaveText("1 matching task");
  await expect(page.getByText("Search results",{exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/Nora interview draft/}).click();
  const trigger = page.getByRole("button",{name:"Activity",exact:true});
  await trigger.click();
  const dialog = page.getByRole("dialog",{name:"Recent activity"});
  const activitySearch = dialog.getByRole("textbox",{name:"Search recent activity"});
  await expect(activitySearch).toHaveCSS("font-size","16px");
  await dialog.getByRole("button",{name:/^Needs review/}).click();
  await activitySearch.fill("No matching request");
  await dialog.getByRole("button",{name:"Clear activity search"}).click();
  await expect(activitySearch).toBeFocused();
  await expect(activitySearch).toHaveValue("");
  await expect(dialog.getByRole("button",{name:/^Needs review/})).toHaveAttribute("aria-pressed","true");
  await expect(dialog.getByText("No requests match these filters.")).toBeVisible();
  await dialog.getByRole("button",{name:"Reset activity filters"}).click();
  await expect(activitySearch).toBeFocused();
  await expect(dialog.getByRole("button",{name:/^All/})).toHaveAttribute("aria-pressed","true");
  await expect(dialog.getByRole("row")).toHaveCount(2);
  await expect(dialog.getByRole("columnheader",{name:"Origin",exact:true})).toBeHidden();
  await expect(dialog.locator(".activity-task-meta")).toContainText("Message");
  const actionBounds = await dialog.getByRole("button",{name:"View request for Nora interview draft"}).boundingBox();
  const tableBounds = await dialog.locator(".activity-table-scroll").boundingBox();
  expect(actionBounds).not.toBeNull();
  expect(tableBounds).not.toBeNull();
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(tableBounds!.x + tableBounds!.width);
  expect(await dialog.locator(".activity-table-scroll").evaluate(element=>element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("activity-recovery-mobile.png")});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.locator(".conversation-heading h1")).toHaveText("Nora interview draft");
  await expect(composer(page)).toHaveValue("Unsent draft remains here");
  expect(state.submissions).toHaveLength(0);
  expect(state.gmailCalls).toBe(0);
});

for (const mobile of [false,true]) test(`explicit task changes discard stale quote ownership and removal preserves draft (${mobile ? "mobile" : "desktop"})`, async ({page}) => {
  if (mobile) await page.setViewportSize({width:390,height:844});
  const state=await fixture(page);
  await page.goto("/");
  if (mobile) await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
  await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/^Saved task 0\b/}).click();
  await page.getByRole("button",{name:"Ask about reply"}).click();
  await expect(page.locator(".prompt-review-card")).toBeVisible();
  await composer(page).fill("Keep my draft @Nora");
  await expect(page.getByRole("option",{name:/Nora interview draft/})).toBeVisible();
  await composer(page).press("Enter");
  await expect(page.locator(".task-target")).toContainText("Nora interview draft");
  await expect(page.locator(".prompt-review-card")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Keep my draft");
  // A matching quote may remain until the user explicitly removes its task.
  if (mobile) await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
  const search=page.getByRole("searchbox",{name:"Search saved tasks",exact:true});
  await search.fill("Nora"); await search.press("Enter");
  await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/Nora interview draft/}).click();
  await page.getByRole("button",{name:"Ask about reply"}).click();
  await expect(page.locator(".prompt-review-card")).toBeVisible();
  await page.getByRole("button",{name:"Continue this task",exact:true}).click();
  await expect(page.locator(".prompt-review-card")).toBeVisible();
  await page.getByRole("button",{name:"Remove selected task"}).click();
  await expect(page.locator(".prompt-review-card")).toHaveCount(0);
  await expect(page.locator(".task-target")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Keep my draft");
  await expect(composer(page)).toBeFocused();
  expect(state.submissions).toHaveLength(0); expect(state.gmailCalls).toBe(0);
});

test("shortcut button ignores task queries and appends a separated prompt without dispatch", async ({page}) => {
  const state=await fixture(page);
  await page.goto("/");
  await composer(page).fill("Keep this text @Nora");
  await expect(page.getByText("Searching saved tasks…")).toBeVisible();
  await page.getByRole("button",{name:"Prompt shortcuts",exact:true}).click();
  const menu=page.getByRole("listbox",{name:"Prompt shortcuts"});
  await expect(menu.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("button",{name:"Send",exact:true})).toBeDisabled();
  await expect(menu.getByText("Searching saved tasks…")).toHaveCount(0);
  await composer(page).press("ArrowDown");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("Keep this text @Nora\n\nCompare … Explain the tradeoffs and what still needs checking.");
  await expect(composer(page)).toBeFocused();
  await expect(menu).toHaveCount(0);
  expect(state.submissions).toHaveLength(0);
});

test("Send stays disabled while task suggestions are unresolved until explicitly dismissed", async ({page}) => {
  const state=await fixture(page);
  let release=()=>{};
  let lookupStarted=false;
  await page.route("**/api/tasks?q=Nora",async route=>{
    await new Promise<void>(resolve=>{release=resolve; lookupStarted=true;});
    await route.fulfill({json:{tasks:[],total:0,next_cursor:null}});
  });
  await page.goto("/");
  await composer(page).fill("Draft for @Nora");
  await expect(page.getByText("Searching saved tasks…")).toBeVisible();
  await expect(page.getByRole("button",{name:"Send",exact:true})).toBeDisabled();
  await expect.poll(()=>lookupStarted).toBe(true);
  release();
  await expect(page.getByText("No matches. Try another name.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Send",exact:true})).toBeDisabled();
  await composer(page).press("Enter");
  expect(state.submissions).toHaveLength(0);
  await composer(page).press("Escape");
  await expect(page.getByRole("button",{name:"Send",exact:true})).toBeEnabled();
  await expect(composer(page)).toHaveValue("Draft for @Nora");
  expect(state.submissions).toHaveLength(0);
});

test("a newly selected reply starts with a fresh instruction instead of reusing the previous choice",async ({page},testInfo)=>{
  const state=await fixture(page,[{id:"reply-one",role:"assistant",content:"First answer to inspect"},{id:"reply-two",role:"assistant",content:"Second answer to inspect"}]);
  await page.goto("/");
  await page.locator("#chat-message-0").getByRole("button",{name:"Ask about reply"}).click();
  await page.getByRole("radio",{name:"Make it shorter"}).check();
  await page.getByRole("textbox",{name:"Custom instruction for selection"}).fill("First answer instruction only");
  await page.locator("#chat-message-1").getByRole("button",{name:"Ask about reply"}).click();
  await expect(page.locator(".prompt-review-card blockquote")).toHaveText("Second answer to inspect");
  await expect(page.getByRole("textbox",{name:"Custom instruction for selection"})).toHaveValue("");
  await expect(page.getByRole("radio",{name:"Explain this passage"})).toBeChecked();
  expect(state.submissions).toHaveLength(0);
  await page.screenshot({path:testInfo.outputPath("composer-review-desktop.png")});
});


for (const mobile of [false, true]) {
  test(`email content retains its structure through history and exact continuation${mobile ? " on mobile" : ""}`, async ({ page, context }) => {
    if (mobile) await page.setViewportSize({ width:390, height:844 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const text = "To: Nora <nora@example.invalid>\nSubject: Friday interview\n\nHi Nora,\n\nFriday works. Please suggest a time.\n\nBest,\nDaniel";
    const state = await fixture(page, [{id:"email-draft",role:"draft",content:text,task_id:taskId(39)}]);
    state.savedReply = text;
    await page.goto("/");
    const card = page.getByRole("region",{name:"Email draft",exact:true});
    await expect(card.getByRole("heading",{name:"Friday interview"})).toBeVisible();
    await expect(card).toContainText("Nora <nora@example.invalid>");
    await expect(card).toContainText("Not sent");
    await expect(card).not.toContainText("From");
    await page.getByRole("button",{name:"Copy draft",exact:true}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    if (mobile) await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
    await page.getByRole("searchbox",{name:"Search saved tasks",exact:true}).fill("Nora");
    await page.getByRole("button",{name:"Search saved tasks",exact:true}).click();
    await page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button",{name:/Nora interview draft/}).click();
    const saved = page.getByRole("region",{name:"Email content",exact:true});
    await expect(saved.getByRole("heading",{name:"Friday interview"})).toBeVisible();
    await expect(saved).toContainText("Delivery not tracked");
    await expect(saved).not.toContainText("Not sent");
    expect(state.submissions).toHaveLength(0);
    await saved.locator(".email-body").click();
    await page.getByRole("button",{name:"Continue this task",exact:true}).click();
    await composer(page).fill("Make the email warmer, keep Friday.");
    await page.getByRole("button",{name:/^Send/}).click();
    await expect.poll(() => state.submissions.length).toBe(1);
    expect(state.submissions[0].task_id).toBe(taskId(39));
    state.status="succeeded";
    state.messages.push({id:"email-revision",role:"draft",content:text.replace("Friday works.","Thank you for the invitation. Friday works."),task_id:taskId(39),request_id:REQUEST});
    await expect(page.getByRole("region",{name:"Email draft",exact:true})).toHaveCount(2);
    const cards = page.locator(".email-reply");
    await expect(cards.last()).toContainText("Thank you for the invitation");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.gmailCalls).toBe(0);
  });
}

test("streaming email headers wait for a complete body and never invent delivery", async ({page}) => {
  const state = await fixture(page,[{id:"email-request",role:"user",content:"Revise this fictional email",task_id:taskId(39),request_id:REQUEST}]);
  state.partial="To: nora@example.invalid\nSubject: Fri";
  await page.goto("/");
  await expect(page.getByText("Reply in progress",{exact:true})).toBeVisible();
  await expect(page.locator(".email-reply")).toHaveCount(0);
  state.partial="**To:** Nora <nora@example.invalid>\n**Subject:** Friday interview\n\nHi Nora, Friday";
  const card=page.getByRole("region",{name:"Email content",exact:true});
  await expect(card.getByRole("heading",{name:"Friday interview"})).toBeVisible();
  await expect(card).toContainText("In progress");
  state.partial += " works. Please suggest a time.";
  await expect(card).toContainText("Please suggest a time.");
  await expect(card).not.toContainText("Not sent");
  expect(state.submissions).toHaveLength(0);
});

test("ordinary prose and quoted email headers remain readable without email metadata", async ({page}) => {
  await fixture(page,[
    {id:"ordinary",role:"assistant",content:"Use these fields in your draft:\nTo: Nora\nSubject: Friday\n\nThen write the body."},
    {id:"quoted",role:"assistant",content:"> To: nora@example.invalid\n> Subject: Friday\n\nThese are quoted instructions."},
    {id:"headers",role:"assistant",content:"From: Nora <nora@example.invalid>\nTo: Daniel <daniel@example.invalid>\nCc: colleague@example.invalid\nSubject: Friday interview\nDate: As supplied; timezone unknown\n\n<img src=x onerror=alert(1)>\n\nLet's talk Friday."}
  ]);
  await page.goto("/");
  await expect(page.locator(".email-reply")).toHaveCount(1);
  await expect(page.getByText("Then write the body.",{exact:false})).toBeVisible();
  const card=page.getByRole("region",{name:"Email content",exact:true});
  await expect(card).toContainText("Nora <nora@example.invalid>");
  await expect(card).toContainText("colleague@example.invalid");
  await expect(card).toContainText("As supplied; timezone unknown");
  await expect(card.locator("img")).toHaveCount(0);
  await expect(card).toContainText("<img src=x onerror=alert(1)>");
  await expect(card).toContainText("Delivery not tracked");
});


test("isolated live mode displays the configured approval cap and blocks Gmail", async ({ page }) => {
  const state = await fixture(page);
  await page.route("**/api/preview", route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({demo:false,liveTest:true,budgetUsd:5})}));
  await page.goto("/");
  await expect(page.getByText("Live model test · Temporary data · Gmail disabled · US$5 cap",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Settings",exact:true}).click();
  await expect(page.getByText("Gmail is disabled in this mode.",{exact:false})).toBeVisible();
  expect(state.gmailCalls).toBe(0);
  expect(state.submissions).toHaveLength(0);
});


for (const mobile of [false, true]) test(`annotated workspace refinement keeps one draft toolbar and clear task context (${mobile ? "mobile" : "desktop"})`, async ({page}, testInfo) => {
  await page.setViewportSize(mobile ? {width:390,height:844} : {width:1035,height:1090});
  const text="To: nora@example.invalid\nSubject: Interview availability\n\nHi Nora, Friday works. Please suggest a time.";
  const state=await fixture(page,[
    {id:"comment-request",role:"user",content:"Reply to Nora",request_id:REQUEST,task_id:taskId(39)},
    {id:"comment-draft",role:"draft",content:text,request_id:REQUEST,task_id:taskId(39)},
    {id:"comment-commentary",role:"assistant",content:"Here is your draft. You can revise it below.",request_id:REQUEST,task_id:taskId(39)},
    {id:"independent-answer",role:"assistant",content:"A different request still has its own actions.",request_id:REQUEST,task_id:taskId(0)}
  ]);
  state.status="succeeded";
  await page.route("**/api/preview",route=>route.fulfill({json:{demo:false,liveTest:true,budgetUsd:5}}));
  await page.goto("/");
  const badge=page.locator(".demo-banner");
  await expect(badge).toContainText("US$5 cap");
  const badgeStyle=await badge.evaluate(el=>({radius:getComputedStyle(el).borderRadius,width:el.getBoundingClientRect().width,viewport:innerWidth}));
  expect(badgeStyle.radius).toBe("999px"); expect(badgeStyle.width).toBeLessThan(badgeStyle.viewport);
  const draft=page.getByRole("region",{name:"Email draft",exact:true});
  await expect(draft.locator(".email-heading .email-fields")).toContainText("nora@example.invalid");
  await expect(draft.locator(".email-heading")).toContainText("Not sent");
  await expect(page.locator("#chat-message-2 .message-actions")).toHaveCount(0);
  await expect(page.locator("#chat-message-2")).toContainText("Here is your draft");
  await expect(page.locator("#chat-message-3").getByRole("button",{name:"Ask about reply"})).toBeVisible();
  await expect(page.locator(".draft-result").getByRole("button",{name:"Ask about reply"})).toHaveCount(0);
  await page.getByRole("button",{name:"Continue this task",exact:true}).click();
  await expect(page.locator(".conversation-heading h1")).toHaveText("Nora interview draft");
  await expect(page.getByRole("button",{name:"Continue this task",exact:true})).toHaveCount(0);
  await expect(composer(page)).toBeFocused();
  if (mobile) await page.getByRole("button",{name:"Saved tasks",exact:true}).click();
  await expect(page.locator(".sidebar-footer")).toHaveCount(0);
  await expect(page.locator(".task-meta")).toHaveCount(0);
  const search=page.getByRole("searchbox",{name:"Search saved tasks",exact:true});
  await search.fill("Nora"); await search.press("Enter");
  const searchButton=page.getByRole("button",{name:"Search saved tasks",exact:true});
  await expect(searchButton).toHaveText("");
  await expect(page.getByRole("navigation",{name:"Saved tasks"}).getByRole("button")).toHaveCount(1);
  if (mobile) await page.getByRole("button",{name:"Close saved tasks",exact:true}).click();
  const row=page.locator("#chat-message-0 .task-run-row");
  await expect(row).toHaveAttribute("data-status","succeeded");
  const successColor=await row.evaluate(el=>getComputedStyle(el).backgroundColor);
  state.status="failed";
  await page.reload();
  await expect(row).toHaveAttribute("data-status","failed");
  await expect(row.locator(".task-run-status")).toHaveText("Draft saved · Reply incomplete");
  expect(await row.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(successColor);
  await page.screenshot({path:testInfo.outputPath("annotated-refinement.png")});
  expect(state.submissions).toHaveLength(0); expect(state.gmailCalls).toBe(0);
});
