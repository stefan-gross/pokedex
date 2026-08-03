import { NextResponse } from 'next/server';

// Laufzeit-Build-Kennung des aktuell DEPLOYTEN Servers. Die gecachte PWA vergleicht
// diese SHA mit ihrer eingebackenen NEXT_PUBLIC_BUILD_SHA → weicht sie ab, gibt es
// einen neueren Deploy als das lokal geladene Bundle.
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';
  return NextResponse.json({ sha }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
