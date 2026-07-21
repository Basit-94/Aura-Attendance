import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Light database query to keep Supabase active and prevent free-tier auto-pause
    const studentCount = await db.student.count();
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        supabaseActive: true,
        metrics: { studentCount },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Database query failed',
        error: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
