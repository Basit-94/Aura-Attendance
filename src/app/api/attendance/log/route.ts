import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Upsert or remove attendance marks
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subjectId, date, status, studentCode, teacherEditPin } = body; // status can be PRESENT, ABSENT, HOLIDAY, or REMOVE

    if (!subjectId || !date || !status) {
      return NextResponse.json({ error: 'Subject ID, date, and status are required' }, { status: 400 });
    }

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
      await db.attendanceLog.deleteMany({
        where: {
          subjectId,
          date: logDate,
        },
      });
      return NextResponse.json({ message: 'Attendance log cleared successfully' });
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
