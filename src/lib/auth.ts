import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import db from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'aura-attend-cryptographic-hash-jwt-secret-key-99881122';

export interface UserSessionPayload {
  userId: string;
  email: string;
  role: 'student' | 'teacher';
}

// Security: Hash password using bcryptjs with salt factor 10
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

// Security: Safe comparison of input passwords and hashed database records
export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

// Session: Sign session details with 7-day expiration
export function generateToken(payload: UserSessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// Session: Verify session details and return payload
export function verifyToken(token: string): UserSessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as UserSessionPayload;
  } catch (e) {
    return null;
  }
}

// Endpoint protection: Retrieve currently authenticated student
export async function getCurrentUser() {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('token')?.value;
    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload || payload.role !== 'student') return null;

    const student = await db.student.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, uniqueCode: true },
    });

    return student;
  } catch (error) {
    console.error('Error fetching current user:', error);
    return null;
  }
}
