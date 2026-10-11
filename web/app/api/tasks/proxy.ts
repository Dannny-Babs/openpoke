export async function forwardTasks(path: string, request: Request) {
  const base = (process.env.PY_SERVER_URL || 'http://localhost:8001').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/v1/tasks${path}${new URL(request.url).search}`, {
      cache: 'no-store', headers: { Accept: 'application/json' }, signal: request.signal,
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'Could not reach the local server. Start it and try again.' }, { status: 502 });
  }
}
