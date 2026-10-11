async (page, baseURL = 'http://127.0.0.1:3000/') => {
  // Run with the Playwright connector's browser_run_code (or a Playwright page).
  // Every chat write below is intercepted. This does not call a model or clear data.
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const task = 'a'.repeat(64);
  const draftBody = 'Fixture draft body stays reviewable.';
  let phase = 0;
  let posts = 0;
  const messages = [
    {id:'fixture-user',role:'user',content:'UI fixture reference request',request_id:first},
    {id:'fixture-answer',role:'assistant',content:'## A readable answer\n\n- **One** useful detail\n• A second detail\n\n[Official source](https://example.invalid/source)\n\n```js\nconst answer = 42;\n```\n\n<script>window.fixtureUnsafe = true</script>\n[Unsafe](javascript:alert(1))',request_id:first,task_id:task}
    ,{id:'fixture-draft',role:'draft',content:`To: nora@example.invalid\nSubject: Fixture draft\n\n${draftBody}`,request_id:first,task_id:task}
    ,{id:'fixture-draft-echo',role:'assistant',content:'Fixture   draft body stays reviewable.',request_id:first,task_id:task}
    ,{id:'fixture-review',role:'assistant',content:'A separate review reply remains visible.',request_id:first,task_id:task}
    ,{id:'fixture-cross-request',role:'assistant',content:draftBody,request_id:'33333333-3333-4333-8333-333333333333',task_id:task}
  ];
  const response = id => ({request_id:id,status:id===first?'succeeded':phase===2?'failed':'running',task_id:task,origin:'chat',error:phase===2?'Simulated isolated failure':null,partial_response:null,created_at:'2026-10-10T22:00:00Z',updated_at:'2026-10-10T22:00:01Z',runs:[{id:'fixture-run',task_id:task,task_name:'Fixture research',status:id===first?'succeeded':phase===2?'failed':'running',error:null,response:null,partial_response:id===second && phase!==2?'## Live fixture output\n\nFirst received chunk.':null,activity:null}]});
  const routes = ['**/api/chat/history','**/api/chat/requests/*','**/api/chat'];
  try {
    await page.route(routes[0], route=>route.fulfill({json:{messages}}));
    await page.route(routes[1], route=>route.fulfill({json:response(route.request().url().split('/').pop())}));
    await page.route(routes[2], route=>{posts++; messages.push({id:'fixture-user-2',role:'user',content:'UI fixture follow-up',request_id:second});return route.fulfill({status:202,json:{request_id:second,status:'queued',task_id:task}})});
    await page.goto(baseURL);
    await page.getByRole('heading',{name:'A readable answer'}).waitFor();
    check(await page.locator('.draft-result').getByText(draftBody,{exact:true}).count()===1,'draft body not rendered once');
    check(await page.locator('#chat-message-3').count()===0,'same-request draft echo remains');
    check(await page.locator('.assistant-result').getByText(draftBody,{exact:true}).count()===1,'cross-request matching reply suppressed');
    check(await page.getByText('A separate review reply remains visible.',{exact:true}).count()===1,'other review reply suppressed');
    check(await page.getByRole('link',{name:/Official source/}).getAttribute('href')==='https://example.invalid/source','supplied source link missing');
    check(await page.locator('.source-link').count()===1,'compact source treatment missing');
    check(await page.locator('.reply-prose li').count()===2,'Unicode bullets did not render as a list');
    check(await page.locator('.reply-prose code').count()===1,'code block missing');
    check(await page.locator('a[href^="javascript:"]').count()===0,'unsafe URL rendered');
    check(await page.evaluate(()=>window.fixtureUnsafe!==true),'raw HTML executed');
    await page.getByRole('button',{name:'Your messages',exact:true}).click();
    await page.locator('dialog[open]').getByRole('button',{name:'UI fixture reference request'}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='chat-message-0');
    check(await page.locator('#chat-message-0').evaluate(el=>el===document.activeElement),'history jump did not focus message');
    await page.locator('textarea').fill('UI fixture follow-up');
    await page.getByRole('button',{name:'Send'}).click();
    await page.locator('.working-output').waitFor();
    check(await page.getByText('Reply in progress').isVisible(),'partial not labeled provisional');
    phase = 2;
    await page.getByText('Simulated isolated failure',{exact:true}).waitFor();
    check(await page.locator('.working-output').count()===0,'terminal partial remains visible');
    check(posts===1,'automatic write retry occurred');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Your messages',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Your messages');
    check(await page.getByRole('button',{name:'Your messages',exact:true}).evaluate(el=>el===document.activeElement),'Escape focus lost');
    const layout = await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,composerVisible:document.querySelector('textarea').getBoundingClientRect().bottom<=innerHeight}));
    check(!layout.overflow && layout.composerVisible,'mobile layout/composer failed');
    return {passed:true,checks:['same-request draft echo suppressed; cross-request and review replies preserved','Markdown and real supplied links','HTML/unsafe URL rejection','history jump and focus','request-owned partial rendering','terminal partial clearing','no automatic resend','mobile Escape/focus and composer'],posts};
  } finally {
    for(const pattern of routes) await page.unroute(pattern);
    await page.goto(baseURL);
  }
}
