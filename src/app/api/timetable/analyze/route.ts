export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { analyzeTimetableStructure } from '@/lib/ocr';

// Pre-analyze timetable image/PDF to find streams and lab groups
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/png';

    // Run AI analysis
    const analysis = await analyzeTimetableStructure(buffer, mimeType);

    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error('Timetable analysis endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'An error occurred while analyzing the routine layout',
    }, { status: 500 });
  }
}
