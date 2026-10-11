import { shouldAcceptStatus } from '../components/chat/requestStatus';
import type { RunStatus } from '../components/chat/types';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
// These local authored page functions also run through the browser connector.
function scenario(filename: string) {
  return new Function('return (' + readFileSync(resolve(process.cwd(), '../scripts', filename), 'utf8') + ');')() as (page: Page, baseURL: string) => Promise<{ passed: boolean }>;
}
test('history, readable sources, provisional output and failure recovery', async ({ page, baseURL }) => {
  expect((await scenario('browser_regression.js')(page, baseURL!)).passed).toBe(true);
});
test('concurrent run overview preserves ownership and composer target', async ({ page, baseURL }) => {
  expect((await scenario('browser_concurrency.js')(page, baseURL!)).passed).toBe(true);
});
test('real local HTTP accepts two independent offline worker requests', async ({ page, request, baseURL }, testInfo) => {
  const api = 'http://127.0.0.1:8003/api/v1';
  await page.goto(baseURL!);
  const accepted = [];
  for (const content of ['Slow draft an email to Nora', 'Slow book club plan']) {
    const response = await request.post(api + '/chat/send', { data: { messages: [{ role: 'user', content }], submission_id: randomUUID() } });
    expect(response.status()).toBe(202); accepted.push(await response.json());
  }
  expect(accepted[0].request_id).not.toBe(accepted[1].request_id);
  await expect(page.locator('.active-work-row')).toHaveCount(2);
  await page.locator('.active-work > summary').click();
  await page.screenshot({path:testInfo.outputPath('concurrent-work-desktop.png')});
  for (const submission of accepted) {
    await expect.poll(async () => (await (await request.get(api + '/chat/requests/' + submission.request_id)).json()).status).toBe('succeeded');
  }
  const results = await Promise.all(accepted.map(async value => (await request.get(api + '/chat/requests/' + value.request_id)).json()));
  expect(results[0].runs).toHaveLength(1);expect(results[1].runs).toHaveLength(1);
  expect(results[0].runs[0].task_id).not.toBe(results[1].runs[0].task_id);
  await expect(page.locator('.active-work-row')).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('final-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('final-mobile.png')});
});

test('late status snapshots cannot regress a completed request', () => {
  const snapshot=(status: RunStatus, updated_at: string, request_id='fixture-request')=>({status, updated_at, request_id});
  const running=snapshot('running','2026-10-11T03:00:00.000Z');
  const completed=snapshot('succeeded','2026-10-11T03:00:01.000Z');
  expect(shouldAcceptStatus(running,completed)).toBe(true);
  expect(shouldAcceptStatus(completed,running)).toBe(false);
  expect(shouldAcceptStatus(completed,snapshot('running','2026-10-11T03:00:02.000Z'))).toBe(false);
  expect(shouldAcceptStatus(completed,snapshot('succeeded','2026-10-11T03:00:02.000Z'))).toBe(true);
  expect(shouldAcceptStatus(completed,snapshot('failed','2026-10-11T03:00:02.000Z'))).toBe(false);
  expect(shouldAcceptStatus(running,snapshot('running','invalid'))).toBe(false);
  expect(shouldAcceptStatus(running,snapshot('running','2026-10-11T03:00:02.000Z','another-request'))).toBe(false);
});
