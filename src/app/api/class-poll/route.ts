export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// Helper to normalize course names for cross-student batch sharing
function normalizeCourseCode(name: string): string {
  if (!name) return 'general';
  return name
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/\blaboratory\b/g, 'lab')
    .replace(/[^a-z0-9&]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// GET: Fetch live class radar poll status and crowd faculty vibe ratings
export async function GET(request: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawCourse = searchParams.get('course') || 'General';
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const slotTime = searchParams.get('slotTime') || '10:00';
  const courseCode = normalizeCourseCode(rawCourse);

  try {
    // 1. Fetch live poll votes for this course session
    const pollVotes = await db.liveClassPoll.findMany({
      where: {
        courseCode,
        date,
        slotTime,
      },
      select: {
        vote: true,
        studentId: true,
      },
    });

    const haanCount = pollVotes.filter(v => v.vote === 'HAAN').length;
    const nahiCount = pollVotes.filter(v => v.vote === 'NAHI').length;
    const myVoteObj = pollVotes.find(v => v.studentId === student.id);
    const myVote = myVoteObj ? myVoteObj.vote : null;

    const totalVotes = haanCount + nahiCount;
    const haanPercent = totalVotes > 0 ? Math.round((haanCount / totalVotes) * 100) : 50;

    // 2. Fetch crowd faculty vibe reactions across all courses and students
    const allVibeVotes = await db.facultyVibeRating.findMany({
      select: {
        courseCode: true,
        vibe: true,
        reviewText: true,
        studentId: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const allVibes: Record<string, {
      strictCount: number;
      neutralCount: number;
      chillCount: number;
      totalVibeVotes: number;
      dominantVibe: 'VERY_STRICT' | 'STRICT' | 'NEUTRAL' | 'LENIENT' | 'CHILL';
      myVibe: string | null;
      myReviewText: string | null;
      myUpdatedAt: string | null;
      recentNotes: { vibe: string; text: string; date: string }[];
    }> = {};

    for (const v of allVibeVotes) {
      if (!allVibes[v.courseCode]) {
        allVibes[v.courseCode] = {
          strictCount: 0,
          neutralCount: 0,
          chillCount: 0,
          totalVibeVotes: 0,
          dominantVibe: 'NEUTRAL',
          myVibe: null,
          myReviewText: null,
          myUpdatedAt: null,
          recentNotes: [],
        };
      }
      const entry = allVibes[v.courseCode];
      entry.totalVibeVotes++;
      
      const upperVibe = (v.vibe || '').toUpperCase();
      if (upperVibe.includes('STRICT')) entry.strictCount++;
      else if (upperVibe === 'NEUTRAL' || upperVibe === 'NORMAL') entry.neutralCount++;
      else if (upperVibe.includes('CHILL') || upperVibe.includes('LENIENT')) entry.chillCount++;
      else entry.neutralCount++;

      if (v.reviewText && v.reviewText.trim().length > 0 && entry.recentNotes.length < 5) {
        entry.recentNotes.push({
          vibe: v.vibe,
          text: v.reviewText.trim(),
          date: v.updatedAt.toISOString().split('T')[0],
        });
      }

      if (v.studentId === student.id) {
        entry.myVibe = v.vibe;
        entry.myReviewText = v.reviewText || null;
        entry.myUpdatedAt = v.updatedAt.toISOString();
      }
    }

    for (const code of Object.keys(allVibes)) {
      const e = allVibes[code];
      if (e.strictCount > e.neutralCount && e.strictCount > e.chillCount) e.dominantVibe = 'STRICT';
      else if (e.chillCount > e.neutralCount && e.chillCount > e.strictCount) e.dominantVibe = 'CHILL';
      else e.dominantVibe = 'NEUTRAL';
    }

    const currentVibe = allVibes[courseCode] || {
      strictCount: 0,
      neutralCount: 0,
      chillCount: 0,
      totalVibeVotes: 0,
      dominantVibe: 'NEUTRAL',
      myVibe: null,
      myReviewText: null,
      myUpdatedAt: null,
      recentNotes: [],
    };

    return NextResponse.json({
      success: true,
      courseCode,
      rawCourse,
      date,
      slotTime,
      poll: {
        haanCount,
        nahiCount,
        totalVotes,
        haanPercent,
        myVote,
      },
      vibe: currentVibe,
      allVibes,
    });
  } catch (error: any) {
    console.error('Error fetching live class poll data:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch poll data' }, { status: 500 });
  }
}

// POST: Cast or toggle live poll vote or faculty vibe reaction
export async function POST(request: Request) {
  const student = await getCurrentUser();
  if (!student) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, rawCourse, date, slotTime, choice, vibe } = body;
    const courseCode = normalizeCourseCode(rawCourse || 'General');

    if (action === 'VOTE_POLL') {
      const sessionDate = date || new Date().toISOString().split('T')[0];
      const sessionTime = slotTime || '10:00';

      if (choice === 'REMOVE') {
        await db.liveClassPoll.deleteMany({
          where: {
            courseCode,
            date: sessionDate,
            slotTime: sessionTime,
            studentId: student.id,
          },
        });
      } else if (choice === 'HAAN' || choice === 'NAHI') {
        await db.liveClassPoll.upsert({
          where: {
            courseCode_date_slotTime_studentId: {
              courseCode,
              date: sessionDate,
              slotTime: sessionTime,
              studentId: student.id,
            },
          },
          update: {
            vote: choice,
          },
          create: {
            courseCode,
            date: sessionDate,
            slotTime: sessionTime,
            studentId: student.id,
            vote: choice,
          },
        });
      }

      // Return updated poll summary
      const pollVotes = await db.liveClassPoll.findMany({
        where: {
          courseCode,
          date: sessionDate,
          slotTime: sessionTime,
        },
      });

      const haanCount = pollVotes.filter(v => v.vote === 'HAAN').length;
      const nahiCount = pollVotes.filter(v => v.vote === 'NAHI').length;
      const myVote = choice === 'REMOVE' ? null : choice;
      const totalVotes = haanCount + nahiCount;
      const haanPercent = totalVotes > 0 ? Math.round((haanCount / totalVotes) * 100) : 50;

      return NextResponse.json({
        success: true,
        poll: {
          haanCount,
          nahiCount,
          totalVotes,
          haanPercent,
          myVote,
        },
      });
    }

    if (action === 'VOTE_VIBE' || action === 'SAVE_FACULTY_REVIEW') {
      const { reviewText } = body;
      const validVibes = ['VERY_STRICT', 'STRICT', 'NEUTRAL', 'LENIENT', 'CHILL', 'NORMAL'];
      if (validVibes.includes(vibe)) {
        await db.facultyVibeRating.upsert({
          where: {
            courseCode_studentId: {
              courseCode,
              studentId: student.id,
            },
          },
          update: {
            vibe,
            reviewText: typeof reviewText === 'string' ? reviewText.trim() : undefined,
          },
          create: {
            courseCode,
            studentId: student.id,
            vibe,
            reviewText: typeof reviewText === 'string' ? reviewText.trim() : null,
          },
        });
      }

      const vibeVotes = await db.facultyVibeRating.findMany({
        where: { courseCode },
        select: {
          vibe: true,
          reviewText: true,
          studentId: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

      let strictCount = 0;
      let neutralCount = 0;
      let chillCount = 0;
      const recentNotes: { vibe: string; text: string; date: string }[] = [];

      for (const v of vibeVotes) {
        const uv = (v.vibe || '').toUpperCase();
        if (uv.includes('STRICT')) strictCount++;
        else if (uv === 'NEUTRAL' || uv === 'NORMAL') neutralCount++;
        else if (uv.includes('CHILL') || uv.includes('LENIENT')) chillCount++;
        else neutralCount++;

        if (v.reviewText && v.reviewText.trim().length > 0 && recentNotes.length < 5) {
          recentNotes.push({
            vibe: v.vibe,
            text: v.reviewText.trim(),
            date: v.updatedAt.toISOString().split('T')[0],
          });
        }
      }

      let dominantVibe = 'NEUTRAL';
      if (strictCount > neutralCount && strictCount > chillCount) dominantVibe = 'STRICT';
      else if (chillCount > neutralCount && chillCount > strictCount) dominantVibe = 'CHILL';

      return NextResponse.json({
        success: true,
        vibe: {
          strictCount,
          neutralCount,
          chillCount,
          totalVibeVotes: vibeVotes.length,
          dominantVibe,
          myVibe: vibe,
          myReviewText: reviewText ? reviewText.trim() : null,
          myUpdatedAt: new Date().toISOString(),
          recentNotes,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Error submitting live poll/vibe action:', error);
    return NextResponse.json({ error: error.message || 'Failed to submit vote' }, { status: 500 });
  }
}
