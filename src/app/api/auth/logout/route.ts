import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ message: 'Logged out successfully' });
  
  // Invalidate the session token by setting maxAge to 0
  response.cookies.set('token', '', { 
    maxAge: 0, 
    path: '/' 
  });
  
  return response;
}
