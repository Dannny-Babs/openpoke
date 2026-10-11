export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: 'Invalid request identity.' }, { status: 400 });
  const base = (process.env.PY_SERVER_URL || 'http://localhost:8001').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/api/v1/chat/requests/${encodeURIComponent(id)}`, { cache: 'no-store', signal: request.signal });
    return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Could not read request status. Check the local server.' }, { status: 502 }); }
}
