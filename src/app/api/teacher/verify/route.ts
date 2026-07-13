import { NextResponse } from 'next/server';
import db from '@/lib/db';

// Verify Teacher Edit PIN and return student dashboard data
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { studentCode, teacherEditPin } = body;

    if (!studentCode) {
      return NextResponse.json({ error: 'Student ID is required' }, { status: 400 });
    }

    if (!teacherEditPin) {
      return NextResponse.json({ error: 'Teacher Edit PIN is required' }, { status: 400 });
    }

    // Retrieve the student record
    const student = await db.student.findUnique({
      where: { uniqueCode: studentCode.trim() },
    });

    if (!student) {
      return NextResponse.json({ error: 'Student not found with this ID' }, { status: 404 });
    }

    // Verify access via Teacher Edit PIN
    if (!student.teacherEditPin || student.teacherEditPin !== teacherEditPin.trim()) {
      return NextResponse.json({ error: 'Invalid teacher edit PIN' }, { status: 401 });
    }

    // Retrieve and compute active semester stats for the teacher
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
    });

    if (!activeSemester) {
      return NextResponse.json({
        student: { email: student.email, uniqueCode: student.uniqueCode },
        semesterName: '',
        subjects: [],
      });
    }

    const subjects = await db.subject.findMany({
      where: { semesterId: activeSemester.id },
      include: {
        scheduleSlots: true,
        attendanceLogs: {
          orderBy: { date: 'desc' },
        },
      },
    });

    const subjectsWithStats = subjects.map((sub) => {
      const present = sub.attendanceLogs.filter((l) => l.status === 'PRESENT').length;
      const absent = sub.attendanceLogs.filter((l) => l.status === 'ABSENT').length;
      const holiday = sub.attendanceLogs.filter((l) => l.status === 'HOLIDAY').length;
      
      const total = present + absent;
      const percentage = total > 0 ? (present / total) * 100 : 100.0;

      return {
        id: sub.id,
        name: sub.name,
        type: sub.type,
        targetPercentage: sub.targetPercentage,
        scheduleSlots: sub.scheduleSlots,
        logs: sub.attendanceLogs.map((l) => ({
          id: l.id,
          date: l.date.toISOString(),
          status: l.status,
        })),
        stats: {
          present,
          absent,
          holiday,
          total,
          percentage: Math.round(percentage * 10) / 10,
        },
      };
    });

    return NextResponse.json({
      student: { email: student.email, uniqueCode: student.uniqueCode },
      semesterName: activeSemester.name,
      subjects: subjectsWithStats,
    });
  } catch (error) {
    console.error('Teacher verification error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
