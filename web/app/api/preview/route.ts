export const dynamic = 'force-dynamic';
export async function GET() {
  const liveTest = process.env.OPENPOKE_LIVE_TEST === '1';
  const cap = Number(process.env.OPENPOKE_LIVE_BUDGET_USD || '2');
  return Response.json({ demo: process.env.OPENPOKE_DEMO === '1', liveTest,
    budgetUsd: liveTest && (cap === 2 || cap === 5) ? cap : null
  }, { headers: { 'Cache-Control': 'no-store' } });
}
