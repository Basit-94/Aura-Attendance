export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Retrieve all semesters mapped to the student
export async function GET() {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const semesters = await db.semester.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ semesters });
  } catch (error) {
    console.error('Error fetching semesters:', error);
    return NextResponse.json({ error: 'Failed to fetch semesters' }, { status: 500 });
  }
}

// Create a new semester (and archive/deactivate existing active one)
export async function POST(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name } = body;
    
    if (!name) {
      return NextResponse.json({ error: 'Semester name is required' }, { status: 400 });
    }

    // Set all other semesters to inactive, and create the new one in a transaction
    const newSemester = await db.$transaction(async (tx) => {
      await tx.semester.updateMany({
        where: { studentId: student.id, isActive: true },
        data: { isActive: false },
      });

      return tx.semester.create({
        data: {
          studentId: student.id,
          name,
          isActive: true,
        },
      });
    });

    return NextResponse.json({ 
      message: 'New semester created successfully', 
      semester: newSemester 
    });
  } catch (error) {
    console.error('Semester creation error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}

// Reactivate an archived/inactive semester
export async function PUT(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { semesterId } = body;

    if (!semesterId) {
      return NextResponse.json({ error: 'Semester ID is required' }, { status: 400 });
    }

    // Deactivate all active semesters for this student, then activate the target one
    await db.$transaction(async (tx) => {
      await tx.semester.updateMany({
        where: { studentId: student.id, isActive: true },
        data: { isActive: false },
      });

      await tx.semester.update({
        where: { id: semesterId, studentId: student.id },
        data: { isActive: true },
      });
    });

    return NextResponse.json({ 
      message: 'Semester restored and activated successfully'
    });
  } catch (error) {
    console.error('Semester restoration error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}

// Rename a semester
export async function PATCH(req: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { semesterId, name } = body;

    if (!semesterId || !name) {
      return NextResponse.json({ error: 'Semester ID and name are required' }, { status: 400 });
    }

    const updatedSemester = await db.semester.update({
      where: { id: semesterId, studentId: student.id },
      data: { name: name.trim() },
    });

    return NextResponse.json({
      message: 'Semester renamed successfully',
      semester: updatedSemester,
    });
  } catch (error) {
    console.error('Semester renaming error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
