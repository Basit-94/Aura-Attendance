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

    // To prevent PostgreSQL casting/UUID-matching errors (LIKE on native uuid column),
    // we fetch all semester IDs first and resolve the matching semester id in memory.
    const allSemesters = await db.semester.findMany({
      select: { id: true }
    });

    const matchedSem = allSemesters.find(s => s.id.toLowerCase().startsWith(cleanCode));
    if (!matchedSem) {
      return NextResponse.json({ error: 'Routine not found. Check the code and try again.' }, { status: 404 });
    }

    const sourceSemester = await db.semester.findUnique({
      where: { id: matchedSem.id },
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
      where: { studentId: student.id, isActive: true },
      include: { subjects: true }
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found to import into.' }, { status: 400 });
    }

    await db.$transaction(async (tx) => {
      // 1. Wipe out existing schedule slots for the active semester's subjects
      const activeSubjectIds = activeSemester.subjects.map(s => s.id);
      if (activeSubjectIds.length > 0) {
        await tx.scheduleSlot.deleteMany({
          where: { subjectId: { in: activeSubjectIds } }
        });
      }

      // Local tracker of subjects to prevent creating duplicates in this transaction
      const localSubjects = [...activeSemester.subjects];

      // 2. Loop through friend's routine subjects
      for (const srcSub of sourceSemester.subjects) {
        // Check if subject already exists (case-insensitive name + same type)
        let subject = localSubjects.find(
          (s) => s.name.toLowerCase() === srcSub.name.toLowerCase() && s.type === srcSub.type
        );

        if (!subject) {
          // If the subject doesn't exist, create it
          subject = await tx.subject.create({
            data: {
              semesterId: activeSemester.id,
              name: srcSub.name,
              type: srcSub.type,
              targetPercentage: srcSub.targetPercentage
            }
          });
          localSubjects.push(subject);
        }

        // 3. Create schedule slots linked to this subject
        if (srcSub.scheduleSlots.length > 0) {
          for (const slot of srcSub.scheduleSlots) {
            await tx.scheduleSlot.create({
              data: {
                subjectId: subject.id,
                dayOfWeek: slot.dayOfWeek,
                startTime: slot.startTime,
                endTime: slot.endTime
              }
            });
          }
        }
      }
    });

    return NextResponse.json({ message: 'Routine imported successfully' });
  } catch (error: any) {
    console.error('Error importing routine:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
