export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Fetch all archived summaries and inactive semesters
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Fetch manually archived snapshots (from active resets)
    const archivedSummaries = await db.archivedSummary.findMany({
      where: { studentId: student.id },
      orderBy: { archivedAt: 'desc' },
    });

    // 2. Fetch past inactive semesters and calculate their statistics dynamically
    const inactiveSemesters = await db.semester.findMany({
      where: { studentId: student.id, isActive: false },
      include: {
        subjects: {
          include: {
            attendanceLogs: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const computedInactiveSemesters = inactiveSemesters.map((sem) => {
      let totalLecturesPresent = 0;
      let totalLecturesCount = 0;
      let totalLabsPresent = 0;
      let totalLabsCount = 0;

      sem.subjects.forEach((sub) => {
        const present = sub.attendanceLogs.filter((l) => l.status === 'PRESENT').length;
        const absent = sub.attendanceLogs.filter((l) => l.status === 'ABSENT').length;
        const total = present + absent;

        if (sub.type === 'LECTURE') {
          totalLecturesPresent += present;
          totalLecturesCount += total;
        } else {
          totalLabsPresent += present;
          totalLabsCount += total;
        }
      });

      const lecturePercentage = totalLecturesCount > 0 ? (totalLecturesPresent / totalLecturesCount) * 100 : 100.0;
      const labPercentage = totalLabsCount > 0 ? (totalLabsPresent / totalLabsCount) * 100 : 100.0;
      
      const overallPresent = totalLecturesPresent + totalLabsPresent;
      const overallCount = totalLecturesCount + totalLabsCount;
      const overallPercentage = overallCount > 0 ? (overallPresent / overallCount) * 100 : 100.0;

      return {
        id: sem.id,
        name: sem.name,
        createdAt: sem.createdAt,
        stats: {
          overallPercentage: Math.round(overallPercentage * 10) / 10,
          lecturePercentage: Math.round(lecturePercentage * 10) / 10,
          labPercentage: Math.round(labPercentage * 10) / 10,
          totalClasses: overallCount,
        },
      };
    });

    return NextResponse.json({
      archivedSummaries,
      inactiveSemesters: computedInactiveSemesters,
    });
  } catch (error) {
    console.error('Fetch history error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

// Reset active semester logs and save snapshot to archive
export async function POST() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Load active semester details
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
      include: {
        subjects: {
          include: {
            attendanceLogs: true,
          },
        },
      },
    });

    if (!activeSemester || activeSemester.subjects.length === 0) {
      return NextResponse.json({ error: 'No active classes found to reset' }, { status: 400 });
    }

    // Compute active semester statistics for the archive snapshot
    let totalLecturesPresent = 0;
    let totalLecturesCount = 0;
    let totalLabsPresent = 0;
    let totalLabsCount = 0;

    activeSemester.subjects.forEach((sub) => {
      const present = sub.attendanceLogs.filter((l) => l.status === 'PRESENT').length;
      const absent = sub.attendanceLogs.filter((l) => l.status === 'ABSENT').length;
      const total = present + absent;

      if (sub.type === 'LECTURE') {
        totalLecturesPresent += present;
        totalLecturesCount += total;
      } else {
        totalLabsPresent += present;
        totalLabsCount += total;
      }
    });

    const lecturePercentage = totalLecturesCount > 0 ? (totalLecturesPresent / totalLecturesCount) * 100 : 100.0;
    const labPercentage = totalLabsCount > 0 ? (totalLabsPresent / totalLabsCount) * 100 : 100.0;
    
    const overallPresent = totalLecturesPresent + totalLabsPresent;
    const overallCount = totalLecturesCount + totalLabsCount;
    const overallPercentage = overallCount > 0 ? (overallPresent / overallCount) * 100 : 100.0;

    // Archive stats and clean logs in a database transaction
    await db.$transaction(async (tx) => {
      // 1. Create the ArchivedSummary row
      await tx.archivedSummary.create({
        data: {
          studentId: student.id,
          semesterName: `${activeSemester.name} (Reset Archive)`,
          overallPercentage: Math.round(overallPercentage * 10) / 10,
          lecturePercentage: Math.round(lecturePercentage * 10) / 10,
          labPercentage: Math.round(labPercentage * 10) / 10,
        },
      });

      // 2. Delete all attendance logs for the active subjects
      const subjectIds = activeSemester.subjects.map((s) => s.id);
      await tx.attendanceLog.deleteMany({
        where: {
          subjectId: { in: subjectIds },
        },
      });
    });

    return NextResponse.json({
      message: 'Active semester attendance reset and archived successfully',
    });
  } catch (error) {
    console.error('Reset archive error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
