async (page, baseURL = 'http://127.0.0.1:3000/') => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const ids = ['44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
  const taskIds = ['a'.repeat(64),'b'.repeat(64)];
  const names = ['Fixture email revision','Fixture research plan'];
  let terminal = false;
  let unavailable = false;
  let posts = 0;
  const messages = [{id:'saved-draft',role:'draft',content:'To: nora@example.invalid\nSubject: Fixture revision\n\nA saved draft for review.',request_id:'66666666-6666-4666-8666-666666666666',task_id:taskIds[0]}];
  const patterns = ['**/api/chat/history','**/api/chat/requests/*','**/api/chat','**/api/tasks/'+taskIds[0]];
  const state = index => ({request_id:ids[index],status:terminal?(index===0?'succeeded':'failed'):'running',task_id:taskIds[index],origin:'chat',created_at:'2026-10-11T03:30:00Z',updated_at:'2026-10-11T03:30:01Z',error:terminal&&index===1?'Fixture research failure':null,runs:[{id:'run-'+index,task_id:taskIds[index],task_name:names[index],status:terminal?(index===0?'succeeded':'failed'):'running',response:null,error:null,partial_response:terminal?null:'Provisional '+names[index],activity:null}]});
  try {
    await page.route(patterns[3],route=>route.fulfill({json:{id:taskIds[0],name:names[0],name_truncated:false,history_ambiguous:false,last_activity:null}}));
    await page.route(patterns[0],route=>route.fulfill({json:{messages}}));
    await page.route(patterns[1],route=>{const index=ids.indexOf(route.request().url().split('/').pop());if(index===1&&unavailable)return route.fulfill({status:503,json:{error:'Fixture status unavailable'}});return route.fulfill({json:index<0?{request_id:'66666666-6666-4666-8666-666666666666',status:'succeeded',task_id:taskIds[0],runs:[]}:state(index)});});
    await page.route(patterns[2],route=>{const index=posts++;check(index<2,'Unexpected automatic resend');const payload=route.request().postDataJSON();check(index===0?payload.task_id===taskIds[0]:!payload.task_id,'Submitted task target does not match fixture ownership');messages.push({id:'request-'+index,role:'user',content:payload.messages[0].content,request_id:ids[index],task_id:taskIds[index]});return route.fulfill({status:202,json:{request_id:ids[index],status:'queued',task_id:taskIds[index]}});});
    await page.goto(baseURL);
    await page.getByRole('button',{name:'Continue this task',exact:true}).click();
    let targetBefore='';
    for (const text of ['First concurrent fixture request','Second concurrent fixture request']) {
      await page.locator('textarea').fill(text);
      await page.getByRole('button',{name:'Send',exact:true}).click();
      await page.getByRole('button',{name:'Send',exact:true}).isDisabled();
      await page.locator('textarea').fill('');
      if(posts===1) await page.getByRole('button',{name:'Remove selected task',exact:true}).click();
    }
    await page.locator('.active-work > summary').click();
    await page.getByRole('button',{name:'View request for '+names[1],exact:true}).waitFor();
    await page.getByRole('button',{name:'Continue this task',exact:true}).click();
    targetBefore=await page.locator('.task-target').innerText();
    check(await page.locator('.active-work-row').count()===2,'Active work did not show both independent runs');
    await page.getByRole('button',{name:'View request for '+names[0],exact:true}).click();
    check(await page.locator('.task-target').innerText()===targetBefore,'Viewing active work changed composer target');
    await page.waitForFunction(()=>document.activeElement?.textContent?.includes('First concurrent fixture request'));
    check(await page.evaluate(()=>document.activeElement?.textContent?.includes('First concurrent fixture request')),'Active-work jump lost request focus');
    check(await page.locator('.working-output').count()===2,'Provisional output was not isolated under each request');
    unavailable=true;
    await page.locator('.active-work-row').filter({hasText:names[1]}).getByText(/Status unavailable/).waitFor();
    check(await page.getByText('Last received · Status unavailable',{exact:true}).count()===1,'Stale partial output lacked its status qualifier');
    unavailable=false;terminal=true;
    await page.getByText('Fixture research failure',{exact:true}).waitFor();
    check(await page.locator('.active-work-row').count()===0,'Terminal work remained active');
    check(await page.locator('.working-output').count()===0,'Terminal provisional output remained');
    check(posts===2,'Repeated HTTP write occurred');
    check(await page.locator('.task-target').innerText()===targetBefore,'Terminal status changed composer target');
    return {passed:true,checks:['two active requests and named workers','request focus without target mutation','owned provisional outputs','status outage marks stale progress and output','success/failure terminal isolation','no automatic resend'],posts};
  } finally {
    await page.evaluate(fixtureIds=>{try{const key='openpoke.pending.v1';const pending=JSON.parse(localStorage.getItem(key)||'[]');localStorage.setItem(key,JSON.stringify(pending.filter(id=>!fixtureIds.includes(id))));}catch{}},ids);
    for(const pattern of patterns) await page.unroute(pattern);
    await page.goto(baseURL);
  }
}
