export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { parseTimetableImage, normalizeSubjectName } from '@/lib/ocr';

// Retrieve all scheduled slots of the active semester
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
    });

    if (!activeSemester) {
      return NextResponse.json({ timetable: [] });
    }

    // Load slots with subject names and type details
    const slots = await db.scheduleSlot.findMany({
      where: {
        subject: { semesterId: activeSemester.id },
      },
      include: {
        subject: {
          select: { name: true, type: true },
        },
      },
    });

    const formattedSlots = slots.map((s) => ({
      id: s.id,
      subjectId: s.subjectId,
      subjectName: s.subject.name,
      type: s.subject.type,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    return NextResponse.json({ timetable: formattedSlots });
  } catch (error) {
    console.error('Fetch timetable error:', error);
    return NextResponse.json({ error: 'Failed to fetch timetable' }, { status: 500 });
  }
}

// Save verified schedule slots (JSON array) into the database
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { slots } = body;

    if (!slots || !Array.isArray(slots)) {
      return NextResponse.json({ error: 'Invalid slots array' }, { status: 400 });
    }

    // Load current active semester
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
      include: { subjects: true },
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found' }, { status: 400 });
    }

    // Save verified schedule slots safely inside a transaction block
    await db.$transaction(async (tx) => {
      // 1. Wipe out existing schedule slots for subjects in the active semester
      const activeSubjectIds = activeSemester.subjects.map((s) => s.id);
      await tx.scheduleSlot.deleteMany({
        where: {
          subjectId: { in: activeSubjectIds },
        },
      });

      // Local tracker of subjects to prevent creating duplicates in this request
      const localSubjects = [...activeSemester.subjects];

      // 2. Loop through verified slots
      for (const parsed of slots) {
        const normalizedName = normalizeSubjectName(parsed.subjectName);
        
        // Skip blanks, free periods, lunch, breaks, recess, library, etc.
        const ignoreList = ['lunch', 'break', 'free', 'recess', 'library', 'sports', 'gap', 'self study', 'interval', 'leisure', 'assembly', 'recreation', 'unoccupied', 'vacant', 'free period', 'lunch break', 'recess break'];
        if (!normalizedName || ignoreList.some(item => normalizedName.toLowerCase().includes(item))) {
          continue;
        }

        const type = parsed.type === 'LAB' ? 'LAB' : 'LECTURE';

        // Check if subject already exists
        let subject = localSubjects.find(
          (s) => s.name.toLowerCase() === normalizedName.toLowerCase() && s.type === type
        );

        if (!subject) {
          // If the subject doesn't exist, create it (default target 75%)
          subject = await tx.subject.create({
            data: {
              semesterId: activeSemester.id,
              name: normalizedName,
              type,
              targetPercentage: 75.0,
            },
          });
          localSubjects.push(subject);
        }

        // Create the new schedule slot linked to this subject
        await tx.scheduleSlot.create({
          data: {
            subjectId: subject.id,
            dayOfWeek: parsed.dayOfWeek,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
          },
        });
      }
    });

    return NextResponse.json({
      message: 'Timetable saved successfully!',
    });
  } catch (error: any) {
    console.error('Timetable saving endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'An error occurred while saving your timetable',
    }, { status: 500 });
  }
}
