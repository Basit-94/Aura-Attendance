export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { parseTimetableImage } from '@/lib/ocr';

// Upload routine and return parsed class JSON (dry run/preview)
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const branchSection = formData.get('branchSection') as string | null;
    const labGroup = formData.get('labGroup') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/png';

    // Parse the routine using OCR helper
    const parsedClasses = await parseTimetableImage(
      buffer,
      mimeType,
      branchSection || undefined,
      labGroup || undefined
    );

    return NextResponse.json({
      message: 'Routine parsed successfully!',
      classes: parsedClasses,
    });
  } catch (error: any) {
    console.error('Routine parse endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'An error occurred while parsing the routine',
    }, { status: 500 });
  }
}
