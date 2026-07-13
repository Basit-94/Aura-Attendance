export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { subjectId, dayOfWeek, startTime, endTime } = await req.json();
    if (!subjectId || !dayOfWeek || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (startTime >= endTime) {
      return NextResponse.json({ error: 'Start time must be before end time' }, { status: 400 });
    }

    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found' }, { status: 400 });
    }

    const subject = await db.subject.findFirst({
      where: { id: subjectId, semesterId: activeSemester.id },
    });

    if (!subject) {
      return NextResponse.json({ error: 'Subject not found in active semester' }, { status: 404 });
    }

    const slot = await db.scheduleSlot.create({
      data: {
        subjectId,
        dayOfWeek: dayOfWeek.toUpperCase(),
        startTime,
        endTime,
      },
    });

    return NextResponse.json({ message: 'Slot created successfully', slot });
  } catch (error: any) {
    console.error('Error creating slot:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const slotId = searchParams.get('slotId');

    if (!slotId) {
      return NextResponse.json({ error: 'Slot ID is required' }, { status: 400 });
    }

    const slot = await db.scheduleSlot.findFirst({
      where: {
        id: slotId,
        subject: {
          semester: {
            studentId: student.id,
            isActive: true,
          },
        },
      },
    });

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found or unauthorized' }, { status: 404 });
    }

    await db.scheduleSlot.delete({
      where: { id: slotId },
    });

    return NextResponse.json({ message: 'Slot deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting slot:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
