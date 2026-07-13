export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Retrieve active semester share code
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true }
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found' }, { status: 404 });
    }

    const shareCode = activeSemester.id.substring(0, 8).toUpperCase();

    return NextResponse.json({ shareCode });
  } catch (error: any) {
    console.error('Error fetching share code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Clone timetable using share code
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { code } = await req.json();
    if (!code || code.trim().length < 8) {
      return NextResponse.json({ error: 'Valid share code is required (min 8 characters)' }, { status: 400 });
    }

    const cleanCode = code.trim().toLowerCase();

    const sourceSemester = await db.semester.findFirst({
      where: { id: { startsWith: cleanCode } },
      include: {
        subjects: {
          include: {
            scheduleSlots: true
          }
        }
      }
    });

    if (!sourceSemester) {
      return NextResponse.json({ error: 'Routine not found. Check the code and try again.' }, { status: 404 });
    }

    if (sourceSemester.studentId === student.id) {
      return NextResponse.json({ error: 'Cannot clone your own routine.' }, { status: 400 });
    }

    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true }
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found to import into.' }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      await tx.subject.deleteMany({
        where: { semesterId: activeSemester.id }
      });

      for (const srcSub of sourceSemester.subjects) {
        const newSub = await tx.subject.create({
          data: {
            semesterId: activeSemester.id,
            name: srcSub.name,
            type: srcSub.type,
            targetPercentage: srcSub.targetPercentage
          }
        });

        if (srcSub.scheduleSlots.length > 0) {
          await tx.scheduleSlot.createMany({
            data: srcSub.scheduleSlots.map(slot => ({
              subjectId: newSub.id,
              dayOfWeek: slot.dayOfWeek,
              startTime: slot.startTime,
              endTime: slot.endTime
            }))
          });
        }
      }
    });

    return NextResponse.json({ message: 'Routine imported successfully' });
  } catch (error: any) {
    console.error('Error importing routine:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
