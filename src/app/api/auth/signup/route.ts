import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { hashPassword, generateToken } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if student already exists
    const existingUser = await db.student.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 400 });
    }

    // Password hashing
    const hashedPassword = hashPassword(password);
    
    // Generate a unique 6-digit code for teacher dashboard access
    let uniqueCode = '';
    let isUnique = false;
    while (!isUnique) {
      uniqueCode = Math.floor(100000 + Math.random() * 900000).toString();
      const codeCheck = await db.student.findUnique({
        where: { uniqueCode },
      });
      if (!codeCheck) isUnique = true;
    }

    // Execute student setup inside a safe transaction block
    const student = await db.$transaction(async (tx) => {
      const newStudent = await tx.student.create({
        data: {
          email: normalizedEmail,
          passwordHash: hashedPassword,
          uniqueCode,
        },
      });

      // Seed a default "1st Semester" record
      await tx.semester.create({
        data: {
          studentId: newStudent.id,
          name: '1st Semester',
          isActive: true,
        },
      });

      return newStudent;
    });

    // Sign JWT session token
    const token = generateToken({
      userId: student.id,
      email: student.email,
      role: 'student',
    });

    const response = NextResponse.json({
      message: 'Account created successfully',
      student: { email: student.email, uniqueCode: student.uniqueCode },
    });

    // Secure Session Cookie (HttpOnly, Lax SameSite, secure in prod)
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
