import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Upsert or remove attendance marks (supports both single and batch operations)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subjectId, date, status, logs, studentCode, teacherEditPin } = body; // status can be PRESENT, ABSENT, HOLIDAY, or REMOVE

    let authenticatedStudentId: string | null = null;
    let isTeacherAction = false;

    // Check if teacher is performing action via custom edit PIN
    if (studentCode && teacherEditPin) {
      const student = await db.student.findUnique({
        where: { uniqueCode: studentCode.trim() },
        select: { id: true, teacherEditPin: true },
      });

      if (!student || !student.teacherEditPin || student.teacherEditPin !== teacherEditPin.trim()) {
        return NextResponse.json({ error: 'Invalid teacher edit PIN or Student ID' }, { status: 401 });
      }

      authenticatedStudentId = student.id;
      isTeacherAction = true;
    } else {
      // Otherwise, require standard student authentication
      const student = await getCurrentUser();
      if (!student) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      authenticatedStudentId = student.id;
    }

    // Handle batch logs if provided
    if (Array.isArray(logs) && logs.length > 0) {
      const userSubjects = await db.subject.findMany({
        where: {
          semester: { studentId: authenticatedStudentId },
        },
        select: { id: true },
      });
      const userSubjectIds = new Set(userSubjects.map((s) => s.id));

      const validLogs = logs.filter(
        (item: any) =>
          item.subjectId &&
          userSubjectIds.has(item.subjectId) &&
          item.date &&
          ['PRESENT', 'ABSENT', 'HOLIDAY', 'REMOVE'].includes(item.status)
      );

      if (validLogs.length === 0) {
        return NextResponse.json({ message: 'No valid attendance entries to process' });
      }

      await db.$transaction(
        async (tx) => {
          for (const item of validLogs) {
            const logDate = new Date(item.date);
            const dateStr = typeof item.date === 'string' ? item.date : '';
            const isSpecificTime = dateStr.includes('T') && !dateStr.includes('T00:00:00');

            const dayPart = logDate.toISOString().split('T')[0];
            const dayStart = new Date(`${dayPart}T00:00:00.000Z`);
            const dayEnd = new Date(`${dayPart}T23:59:59.999Z`);

            if (item.status === 'REMOVE') {
              if (isSpecificTime) {
                await tx.attendanceLog.deleteMany({
                  where: {
                    subjectId: item.subjectId,
                    date: logDate,
                  },
                });
                const legacyDate = new Date(`${dayPart}T00:00:00.000Z`);
                await tx.attendanceLog.deleteMany({
                  where: {
                    subjectId: item.subjectId,
                    date: legacyDate,
                  },
                });
              } else {
                await tx.attendanceLog.deleteMany({
                  where: {
                    subjectId: item.subjectId,
                    date: {
                      gte: dayStart,
                      lte: dayEnd,
                    },
                  },
                });
              }
            } else {
              if (isSpecificTime) {
                const dayPart = logDate.toISOString().split('T')[0];
                const legacyDate = new Date(`${dayPart}T00:00:00.000Z`);
                await tx.attendanceLog.deleteMany({
                  where: {
                    subjectId: item.subjectId,
                    date: legacyDate,
                  },
                });
              }

              await tx.attendanceLog.upsert({
                where: {
                  subjectId_date: {
                    subjectId: item.subjectId,
                    date: logDate,
                  },
                },
                update: { status: item.status },
                create: {
                  subjectId: item.subjectId,
                  date: logDate,
                  status: item.status,
                },
              });
            }
          }
        },
        {
          maxWait: 15000,
          timeout: 30000,
        }
      );

      return NextResponse.json({
        message: 'Batch attendance processed successfully',
        count: validLogs.length,
      });
    }

    if (!subjectId || !date || !status) {
      return NextResponse.json({ error: 'Subject ID, date, and status are required' }, { status: 400 });
    }

    // Verify ownership of the subject
    const subject = await db.subject.findFirst({
      where: {
        id: subjectId,
        semester: { studentId: authenticatedStudentId },
      },
    });

    if (!subject) {
      return NextResponse.json({ error: 'Subject not found or unauthorized' }, { status: 404 });
    }

    const logDate = new Date(date);
    const dateStr = typeof date === 'string' ? date : '';
    const isSpecificTime = dateStr.includes('T') && !dateStr.includes('T00:00:00');

    // Enforce: Teachers can only edit attendance for today!
    if (isTeacherAction) {
      const todayStr = new Date().toISOString().split('T')[0];
      const inputDateStr = logDate.toISOString().split('T')[0];
      if (todayStr !== inputDateStr) {
        return NextResponse.json({ error: 'Teachers can only modify attendance for today.' }, { status: 403 });
      }
    }

    // Option to clear the attendance record completely
    if (status === 'REMOVE') {
      const dayPart = logDate.toISOString().split('T')[0];
      const dayStart = new Date(`${dayPart}T00:00:00.000Z`);
      const dayEnd = new Date(`${dayPart}T23:59:59.999Z`);

      if (isSpecificTime) {
        await db.attendanceLog.deleteMany({
          where: {
            subjectId,
            date: logDate,
          },
        });
        const legacyDate = new Date(`${dayPart}T00:00:00.000Z`);
        await db.attendanceLog.deleteMany({
          where: {
            subjectId,
            date: legacyDate,
          },
        });
      } else {
        await db.attendanceLog.deleteMany({
          where: {
            subjectId,
            date: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
        });
      }
      return NextResponse.json({ message: 'Attendance log cleared successfully' });
    }

    // If logging a slot with a specific time, clean up any legacy 00:00:00 record for this subject on this date
    if (isSpecificTime) {
      const dayPart = logDate.toISOString().split('T')[0];
      const legacyDate = new Date(`${dayPart}T00:00:00.000Z`);
      await db.attendanceLog.deleteMany({
        where: {
          subjectId,
          date: legacyDate,
        },
      });
    }

    // Validate standard statuses
    if (!['PRESENT', 'ABSENT', 'HOLIDAY'].includes(status)) {
      return NextResponse.json({ error: 'Invalid attendance status' }, { status: 400 });
    }

    // Use Prisma compound key upsert to create or replace the logs
    const log = await db.attendanceLog.upsert({
      where: {
        subjectId_date: {
          subjectId,
          date: logDate,
        },
      },
      update: { status },
      create: {
        subjectId,
        date: logDate,
        status,
      },
    });

    return NextResponse.json({ 
      message: 'Attendance recorded successfully', 
      log 
    });
  } catch (error) {
    console.error('Log attendance error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
