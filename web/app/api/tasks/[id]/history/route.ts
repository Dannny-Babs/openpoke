import { forwardTasks } from '../../proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{64}$/.test(id)) return Response.json({ error: 'Task not found' }, { status: 404 });
  return forwardTasks(`/${id}/history`, request);
}
