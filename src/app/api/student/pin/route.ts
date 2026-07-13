import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Helper to generate a random 4-digit PIN
function generateRandomPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// GET: Retrieve the student's active teacher edit PIN (generate one if none exists)
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dbStudent = await db.student.findUnique({
      where: { id: student.id },
      select: { teacherEditPin: true },
    });

    let currentPin = dbStudent?.teacherEditPin;

    if (!currentPin) {
      currentPin = generateRandomPin();
      await db.student.update({
        where: { id: student.id },
        data: { teacherEditPin: currentPin },
      });
    }

    return NextResponse.json({ pin: currentPin });
  } catch (error) {
    console.error('Error fetching teacher edit PIN:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}

// POST: Rotate/regenerate a new 4-digit teacher edit PIN
export async function POST() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const newPin = generateRandomPin();
    await db.student.update({
      where: { id: student.id },
      data: { teacherEditPin: newPin },
    });

    return NextResponse.json({ pin: newPin });
  } catch (error) {
    console.error('Error rotating teacher edit PIN:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
