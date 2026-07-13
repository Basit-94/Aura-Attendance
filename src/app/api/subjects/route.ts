export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Fetch all subjects of the active semester and calculate metrics
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find the current active semester
    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
    });

    if (!activeSemester) {
      return NextResponse.json({ semesterName: '', semesterId: '', subjects: [] });
    }

    // Fetch subjects along with schedules and check-in logs
    const subjects = await db.subject.findMany({
      where: { semesterId: activeSemester.id },
      include: {
        scheduleSlots: true,
        attendanceLogs: {
          orderBy: { date: 'desc' },
        },
      },
    });

    // Map each subject to calculate its attendance stats
    const subjectsWithStats = subjects.map((sub) => {
      const present = sub.attendanceLogs.filter((l) => l.status === 'PRESENT').length;
      const absent = sub.attendanceLogs.filter((l) => l.status === 'ABSENT').length;
      const holiday = sub.attendanceLogs.filter((l) => l.status === 'HOLIDAY').length;
      
      const total = present + absent; // Holidays do not count toward calculations
      const percentage = total > 0 ? (present / total) * 100 : 100.0; // Default to 100%

      return {
        id: sub.id,
        name: sub.name,
        type: sub.type, // LECTURE or LAB
        targetPercentage: sub.targetPercentage,
        scheduleSlots: sub.scheduleSlots,
        stats: {
          present,
          absent,
          holiday,
          total,
          percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal place
        },
        logs: sub.attendanceLogs.slice(0, 15), // Return recent 15 logs
      };
    });

    return NextResponse.json({
      semesterName: activeSemester.name,
      semesterId: activeSemester.id,
      subjects: subjectsWithStats,
    });
  } catch (error) {
    console.error('Fetch subjects error:', error);
    return NextResponse.json({ error: 'Failed to load subjects' }, { status: 500 });
  }
}

// Create a new subject manually
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, type, targetPercentage } = body;
    
    if (!name || !type) {
      return NextResponse.json({ error: 'Subject name and type (LECTURE/LAB) are required' }, { status: 400 });
    }

    const activeSemester = await db.semester.findFirst({
      where: { studentId: student.id, isActive: true },
    });

    if (!activeSemester) {
      return NextResponse.json({ error: 'No active semester found. Please create one.' }, { status: 400 });
    }

    const subject = await db.subject.create({
      data: {
        semesterId: activeSemester.id,
        name,
        type,
        targetPercentage: targetPercentage ? parseFloat(targetPercentage) : 75.0,
      },
    });

    return NextResponse.json({ 
      message: 'Subject created successfully', 
      subject 
    });
  } catch (error) {
    console.error('Create subject error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}

// Delete a subject and cascading logs
export async function DELETE(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Subject ID is required' }, { status: 400 });
    }

    // Verify ownership
    const subject = await db.subject.findFirst({
      where: {
        id,
        semester: { studentId: student.id },
      },
    });

    if (!subject) {
      return NextResponse.json({ error: 'Subject not found or unauthorized' }, { status: 404 });
    }

    await db.subject.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Delete subject error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
