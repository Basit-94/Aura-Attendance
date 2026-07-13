import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { comparePassword, generateToken } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Retrieve user record
    const student = await db.student.findUnique({
      where: { email: normalizedEmail },
    });

    // Validate credentials using secure comparison
    if (!student || !comparePassword(password, student.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Sign JWT session token
    const token = generateToken({
      userId: student.id,
      email: student.email,
      role: 'student',
    });

    const response = NextResponse.json({
      message: 'Logged in successfully',
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
    console.error('Login error:', error);
    return NextResponse.json({ error: 'An internal server error occurred' }, { status: 500 });
  }
}
