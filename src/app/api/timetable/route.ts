export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { parseTimetableImage, normalizeSubjectName, canonicalSubjectKey } from '@/lib/ocr';
import { mergeDuplicateSubjects } from '@/lib/subject-merge';

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

    // Merge split lab sessions for the same subject on the same day into a single slot
    const mergedValidSlots: typeof validSlots = [];
    const labSlotMap = new Map<string, typeof validSlots[0]>();

    for (const slot of validSlots) {
      if (slot.type === 'LAB') {
        const key = `${slot.subjectName.toLowerCase()}_${slot.dayOfWeek}`;
        const existing = labSlotMap.get(key);
        if (existing) {
          if (slot.startTime < existing.startTime) existing.startTime = slot.startTime;
          if (slot.endTime > existing.endTime) existing.endTime = slot.endTime;
        } else {
          const newSlot = { ...slot };
          labSlotMap.set(key, newSlot);
          mergedValidSlots.push(newSlot);
        }
      } else {
        mergedValidSlots.push(slot);
      }
    }

    // 1. Run automatic duplicate merging before processing timetable upload
    await mergeDuplicateSubjects(activeSemester.id);

    // Save verified schedule slots safely inside a transaction block with a higher timeout
    await db.$transaction(async (tx) => {
      // 2. CLEAR ALL EXISTING SCHEDULE SLOTS FOR THE ACTIVE SEMESTER
      // This ensures that when uploading a new timetable, old slots are completely replaced!
      await tx.scheduleSlot.deleteMany({
        where: {
          subject: {
            semesterId: activeSemester.id,
          },
        },
      });

      // 3. Keep local map of subjects in active semester mapped by canonical key
      const existingSubjects = await tx.subject.findMany({
        where: { semesterId: activeSemester.id },
        include: { attendanceLogs: true },
      });

      const subjectMap = new Map<string, typeof existingSubjects[0]>();
      for (const sub of existingSubjects) {
        subjectMap.set(canonicalSubjectKey(sub.name, sub.type), sub);
      }

      const slotToSubjectMap = new Map<string, typeof existingSubjects[0]>();

      // 4. Match slots to existing subjects or create genuine missing subjects
      for (const slot of mergedValidSlots) {
        const slotKey = `${slot.subjectName.toLowerCase()}_${slot.type}`;
        if (slotToSubjectMap.has(slotKey)) continue;

        const cKey = canonicalSubjectKey(slot.subjectName, slot.type);
        let matchedSub = subjectMap.get(cKey);

        if (!matchedSub) {
          // Loose matching: check if clean names contain each other with identical lab/lecture type
          matchedSub = existingSubjects.find((s) => {
            const isSubLab = s.type === 'LAB' || s.type.toLowerCase().includes('lab');
            const isSlotLab = slot.type === 'LAB' || slot.type.toLowerCase().includes('lab');
            if (isSubLab !== isSlotLab) return false;
            const sClean = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const slClean = slot.subjectName.toLowerCase().replace(/[^a-z0-9]/g, '');
            return sClean.includes(slClean) || slClean.includes(sClean);
          });
        }

        if (!matchedSub) {
          const normName = normalizeSubjectName(slot.subjectName);
          matchedSub = await tx.subject.create({
            data: {
              semesterId: activeSemester.id,
              name: normName,
              type: slot.type,
              targetPercentage: 75.0,
            },
            include: { attendanceLogs: true },
          });
          existingSubjects.push(matchedSub);
          subjectMap.set(cKey, matchedSub);
        }

        slotToSubjectMap.set(slotKey, matchedSub);
      }

      // 5. Remove orphaned subjects from previous timetable that have ZERO attendance logs
      // and are not part of the new timetable (preserves subjects with actual student logs!)
      const activeSubjectIds = new Set(Array.from(slotToSubjectMap.values()).map((s) => s.id));
      for (const sub of existingSubjects) {
        if (sub.attendanceLogs.length === 0 && !activeSubjectIds.has(sub.id)) {
          await tx.subject.delete({
            where: { id: sub.id },
          }).catch((e) => console.warn(`Could not delete orphaned subject ${sub.name}:`, e));
        }
      }

      // 6. Insert all new schedule slots linked directly to existing subjects
      for (const slot of mergedValidSlots) {
        const slotKey = `${slot.subjectName.toLowerCase()}_${slot.type}`;
        const subject = slotToSubjectMap.get(slotKey);
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
      count: mergedValidSlots.length,
    });
  } catch (error: any) {
    console.error('Timetable saving endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'An error occurred while saving your timetable',
    }, { status: 500 });
  }
}
