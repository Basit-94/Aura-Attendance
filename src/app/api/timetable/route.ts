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

    // Load current active semester with subjects, schedule slots, and attendance logs
    let activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
      include: {
        subjects: {
          include: {
            scheduleSlots: true,
            attendanceLogs: true,
          },
        },
      },
    });

    if (!activeSemester) {
      activeSemester = await db.semester.create({
        data: {
          studentId: student.id,
          name: 'Semester 1',
          isActive: true,
        },
        include: {
          subjects: {
            include: {
              scheduleSlots: true,
              attendanceLogs: true,
            },
          },
        },
      });
    }

    // Filter, validate, and normalize valid slots
    const validSlots: Array<{
      subjectName: string;
      type: 'LECTURE' | 'LAB';
      dayOfWeek: string;
      startTime: string;
      endTime: string;
    }> = [];

    const ignoreList = ['lunch', 'break', 'free', 'recess', 'library', 'sports', 'gap', 'self study', 'interval', 'leisure', 'assembly', 'recreation', 'unoccupied', 'vacant', 'free period', 'lunch break', 'recess break', 'campus drive'];

    for (const parsed of slots) {
      if (!parsed.subjectName || !parsed.subjectName.trim()) continue;
      if (!parsed.startTime || !parsed.endTime) {
        throw new Error('All slots must have start and end times.');
      }
      if (parsed.startTime >= parsed.endTime) {
        throw new Error(`Start time must be before end time for "${parsed.subjectName || 'unnamed subject'}".`);
      }

      const normalizedName = normalizeSubjectName(parsed.subjectName);
      if (!normalizedName || ignoreList.some(item => normalizedName.toLowerCase().includes(item))) {
        continue;
      }

      validSlots.push({
        subjectName: normalizedName,
        type: parsed.type === 'LAB' ? 'LAB' : 'LECTURE',
        dayOfWeek: parsed.dayOfWeek.trim().toUpperCase(),
        startTime: parsed.startTime.trim(),
        endTime: parsed.endTime.trim(),
      });
    }

    const newSubjectKeySet = new Set(validSlots.map(s => `${s.subjectName.toLowerCase()}_${s.type}`));

    // Save verified schedule slots safely inside a transaction block with a higher timeout
    await db.$transaction(async (tx) => {
      // 1. CLEAR ALL EXISTING SCHEDULE SLOTS FOR THE ACTIVE SEMESTER
      // This ensures that when uploading a new timetable, old slots are completely replaced!
      await tx.scheduleSlot.deleteMany({
        where: {
          subject: {
            semesterId: activeSemester.id,
          },
        },
      });

      // 2. Remove orphaned subjects from previous timetable that have ZERO attendance logs
      // and are not part of the new timetable (preserves subjects with actual student logs!)
      for (const sub of activeSemester.subjects) {
        const subKey = `${sub.name.toLowerCase()}_${sub.type}`;
        if (sub.attendanceLogs.length === 0 && !newSubjectKeySet.has(subKey)) {
          await tx.subject.delete({
            where: { id: sub.id },
          }).catch((e) => console.warn(`Could not delete orphaned subject ${sub.name}:`, e));
        }
      }

      // 3. Keep local map of subjects in active semester
      const existingSubjects = await tx.subject.findMany({
        where: { semesterId: activeSemester.id },
      });
      const subjectMap = new Map<string, typeof existingSubjects[0]>();
      for (const sub of existingSubjects) {
        subjectMap.set(`${sub.name.toLowerCase()}_${sub.type}`, sub);
      }

      // 4. Create missing subjects for the new timetable
      for (const slot of validSlots) {
        const key = `${slot.subjectName.toLowerCase()}_${slot.type}`;
        if (!subjectMap.has(key)) {
          const newSub = await tx.subject.create({
            data: {
              semesterId: activeSemester.id,
              name: slot.subjectName,
              type: slot.type,
              targetPercentage: 75.0,
            },
          });
          subjectMap.set(key, newSub);
        }
      }

      // 5. Insert all new schedule slots
      for (const slot of validSlots) {
        const key = `${slot.subjectName.toLowerCase()}_${slot.type}`;
        const subject = subjectMap.get(key);
        if (!subject) continue;

        await tx.scheduleSlot.create({
          data: {
            subjectId: subject.id,
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
          },
        });
      }
    }, {
      maxWait: 15000,
      timeout: 30000,
    });

    return NextResponse.json({
      message: 'Timetable saved successfully and schedule updated!',
      count: validSlots.length,
    });
  } catch (error: any) {
    console.error('Timetable saving endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'An error occurred while saving your timetable',
    }, { status: 500 });
  }
}
