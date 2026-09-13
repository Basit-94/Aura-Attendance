'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  Sun,
  Moon,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Sliders,
  ChevronRight
} from 'lucide-react';
import { 
  FacultyMood, 
  FACULTY_MOODS, 
  calculateBunkBudget, 
  evaluateClassPoll 
} from '@/lib/bunkCalculator';

interface Course {
  id: string;
  name: string;
  code: string;
  room: string;
  faculty: string;
  defaultTier: FacultyMood;
  present: number;
  absent: number;
}

const COURSES: Course[] = [
  { id: 'cs501', name: 'Compiler Design', code: 'CS 501', room: 'Hall 304', faculty: 'Prof. Sengupta', defaultTier: 'psycho_strict', present: 19, absent: 6 },
  { id: 'cs502', name: 'Operating Systems', code: 'CS 502', room: 'Hall 201', faculty: 'Dr. Mukherjee', defaultTier: 'strict', present: 22, absent: 4 },
  { id: 'cs503', name: 'Artificial Intelligence', code: 'CS 503', room: 'Lab 4', faculty: 'Dr. Roy', defaultTier: 'lenient', present: 14, absent: 7 },
  { id: 'hu501', name: 'Industrial Management', code: 'HU 501', room: 'Hall 105', faculty: 'Prof. Bannerjee', defaultTier: 'relaxed', present: 25, absent: 3 }
];

const TIERS: { id: FacultyMood; label: string; val: number; desc: string }[] = [
  { id: 'psycho_strict', label: 'V.Strict', val: 95, desc: 'Late arrivals strictly barred past slot commencement. Attendance logged via manual roll-call at initial bell.' },
  { id: 'strict', label: 'Strict', val: 75, desc: 'Roll-call completed in first 5 minutes. Late admittance subject to individual discretion.' },
  { id: 'neutral', label: 'Neutral', val: 50, desc: 'Standard attendance protocol. Roll logged mid-session or via sheet circulation.' },
  { id: 'lenient', label: 'Lenient', val: 25, desc: 'Permissive entry tolerance up to 15 minutes. Excused absences generally accommodated.' },
  { id: 'relaxed', label: 'Chill', val: 5, desc: 'Open session format. Attendance roster circulated freely at session conclusion.' }
];

export default function VibePreviewPage() {
  const [isDark, setIsDark] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState('cs501');
  
  const course = COURSES.find(c => c.id === selectedCourseId) || COURSES[0];
  const [tier, setTier] = useState<FacultyMood>(course.defaultTier);
  const [present, setPresent] = useState(course.present);
  const [absent, setAbsent] = useState(course.absent);

  useEffect(() => {
    setTier(course.defaultTier);
    setPresent(course.present);
    setAbsent(course.absent);
  }, [course]);

  // Live Voting State
  const [haan, setHaan] = useState(4);
  const [nahi, setNahi] = useState(1);
  const [userVote, setUserVote] = useState<'HAAN' | 'NAHI' | null>(null);
  const [countdown, setCountdown] = useState(525);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => (prev > 0 ? prev - 1 : 600));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleVote = (choice: 'HAAN' | 'NAHI') => {
    if (userVote === choice) {
      setUserVote(null);
      if (choice === 'HAAN') setHaan(v => Math.max(0, v - 1));
      if (choice === 'NAHI') setNahi(v => Math.max(0, v - 1));
    } else {
      if (userVote === 'HAAN') setHaan(v => Math.max(0, v - 1));
      if (userVote === 'NAHI') setNahi(v => Math.max(0, v - 1));
      setUserVote(choice);
      if (choice === 'HAAN') setHaan(v => v + 1);
      if (choice === 'NAHI') setNahi(v => v + 1);
    }
    showToast(`Recorded: ${choice === 'HAAN' ? 'In Class' : 'Not Present'}`);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const logAttendance = (type: 'PRESENT' | 'ABSENT' | 'EXCUSED') => {
    if (type === 'PRESENT') setPresent(p => p + 1);
    if (type === 'ABSENT') setAbsent(a => a + 1);
    showToast(`Logged ${type} for ${course.name}`);
  };

  const bunkBudget = useMemo(() => calculateBunkBudget(present, absent, 75.0), [present, absent]);
  const activeTierObj = TIERS.find(t => t.id === tier) || TIERS[0];
  const totalVotes = haan + nahi;
  const haanPercent = totalVotes > 0 ? Math.round((haan / totalVotes) * 100) : 50;
  const isInHall = haan > nahi;

  // Theme variables
  const bg = isDark ? '#050507' : '#f8f9fa';
  const surface = isDark ? 'rgba(18, 19, 24, 0.7)' : 'rgba(255, 255, 255, 0.85)';
  const surfaceElevated = isDark ? 'rgba(26, 27, 34, 0.85)' : '#ffffff';
  const border = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
  const borderSubtle = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
  const textPrimary = isDark ? '#f4f4f5' : '#09090b';
  const textSecondary = isDark ? '#a1a1aa' : '#52525b';
  const textTertiary = isDark ? '#71717a' : '#a1a1aa';

  return (
    <div 
      style={{
        backgroundColor: bg,
        color: textPrimary,
        minHeight: '100vh',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        transition: 'background-color 0.25s ease, color 0.25s ease'
      }}
      className="p-4 sm:p-6 lg:p-10 flex flex-col items-center relative overflow-x-hidden selection:bg-zinc-800 selection:text-white"
    >
      {/* Muted Ambient Glow */}
      <div 
        className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] pointer-events-none opacity-40 blur-[130px] rounded-full"
        style={{ backgroundColor: isDark ? 'rgba(99, 102, 241, 0.06)' : 'rgba(79, 70, 229, 0.03)' }}
      />

      {/* Floating Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div 
            className="px-4 py-2 rounded-full text-xs font-mono font-medium shadow-2xl backdrop-blur-xl border"
            style={{
              backgroundColor: surfaceElevated,
              borderColor: border,
              color: textPrimary
            }}
          >
            {toast}
          </div>
        </div>
      )}

      <div className="w-full max-w-5xl relative z-10">
        
        {/* Header Bar */}
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <Link 
              href="/"
              className="flex items-center gap-2 text-xs font-mono font-semibold px-3 py-1.5 rounded-lg border transition-all"
              style={{
                backgroundColor: surface,
                borderColor: border,
                color: textSecondary
              }}
            >
              <span>←</span>
              <span>Dashboard</span>
            </Link>

            <div className="flex items-center gap-2 text-xs font-semibold tracking-tight">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Aura Telemetry</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDark(!isDark)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
              style={{
                backgroundColor: surface,
                borderColor: border,
                color: textSecondary
              }}
            >
              {isDark ? <Sun size={13} className="text-zinc-400" /> : <Moon size={13} className="text-zinc-600" />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </header>

        {/* ========================================================= */}
        {/* SCROLLTIDE #c-card-folder: Matte Metallic Tabs Deck       */}
        {/* ========================================================= */}
        <div className="flex gap-1 overflow-x-auto mb-[-1px] relative z-20 scrollbar-none">
          {COURSES.map((c) => {
            const isActive = c.id === selectedCourseId;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCourseId(c.id)}
                className={`px-4 py-2.5 rounded-t-xl text-xs font-medium border-t border-x transition-all duration-150 flex items-center gap-2 relative ${
                  isActive ? 'font-semibold z-10' : 'opacity-60 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: isActive ? (isDark ? '#121318' : '#ffffff') : (isDark ? '#0b0c10' : '#edeef2'),
                  borderColor: border,
                  color: isActive ? textPrimary : textTertiary
                }}
              >
                {isActive && (
                  <span 
                    className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
                    style={{ backgroundColor: textPrimary }}
                  />
                )}
                <span className={`w-1.5 h-1.5 rounded-full ${c.present / (c.present + c.absent) >= 0.75 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span>{c.name}</span>
                <span className="text-[10px] opacity-50 font-mono">({c.code})</span>
              </button>
            );
          })}
        </div>

        {/* Folder Body Container */}
        <div 
          className="rounded-2xl rounded-tl-none border p-6 sm:p-8 backdrop-blur-2xl shadow-2xl transition-all"
          style={{
            backgroundColor: surface,
            borderColor: border
          }}
        >
          {/* ========================================================= */}
          {/* 3-Column Balanced Spatial Telemetry Grid                  */}
          {/* ========================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* COLUMN 1: Faculty Telemetry (3.5 cols) */}
            <div 
              className="lg:col-span-4 p-5 rounded-xl border flex flex-col justify-between"
              style={{
                backgroundColor: surfaceElevated,
                borderColor: borderSubtle
              }}
            >
              <div>
                <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textTertiary }}>
                  <span>Faculty Telemetry</span>
                  <span>{course.room}</span>
                </div>

                <h3 className="text-lg font-semibold tracking-tight">{course.faculty}</h3>
                <p className="text-xs mt-0.5" style={{ color: textSecondary }}>{course.name} · {course.code}</p>

                {/* Strictness Telemetry Gauge */}
                <div 
                  className="mt-5 p-3.5 rounded-lg border"
                  style={{
                    backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
                    borderColor: borderSubtle
                  }}
                >
                  <div className="flex justify-between items-center text-xs mb-2">
                    <span style={{ color: textSecondary }}>Strictness Index</span>
                    <span className="font-mono font-semibold">{activeTierObj.val}%</span>
                  </div>

                  <div className="h-1 rounded-full bg-zinc-800/40 overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${activeTierObj.val}%`,
                        backgroundColor: textPrimary
                      }}
                    />
                  </div>

                  {/* Tier Selector */}
                  <div className="grid grid-cols-5 gap-1 mt-3">
                    {TIERS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTier(t.id)}
                        className={`py-1 rounded text-[10px] font-mono font-medium border transition-all ${
                          tier === t.id ? 'border-zinc-400 bg-white/10 font-bold' : 'border-transparent opacity-60 hover:opacity-100'
                        }`}
                        style={{ color: tier === t.id ? textPrimary : textTertiary }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t text-[11px] leading-relaxed" style={{ borderColor: borderSubtle, color: textSecondary }}>
                {activeTierObj.desc}
              </div>
            </div>

            {/* COLUMN 2: Bunk Runway Hero Meter (4 cols) */}
            <div 
              className="lg:col-span-4 p-6 rounded-xl border flex flex-col items-center justify-center text-center"
              style={{
                backgroundColor: surfaceElevated,
                borderColor: borderSubtle
              }}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textTertiary }}>
                Runway Telemetry
              </div>

              {/* Minimal Radial Progress Meter */}
              <div className="relative w-36 h-36 my-2 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    strokeWidth="3.5"
                    className="stroke-current opacity-10 fill-none"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    strokeWidth="3.5"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * 75) / 100}
                    className="stroke-current opacity-25 fill-none"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    strokeWidth="3.5"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * Math.min(100, bunkBudget.currentPercentage)) / 100}
                    strokeLinecap="round"
                    className="fill-none transition-all duration-500"
                    style={{ stroke: textPrimary }}
                  />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold tracking-tight">
                    {bunkBudget.currentPercentage}
                    <span className="text-sm font-normal opacity-50">%</span>
                  </span>
                  <span className="text-[9px] font-mono opacity-50 mt-0.5">Min 75.0%</span>
                </div>
              </div>

              {/* Discrete Status Badge */}
              <div 
                className="mt-1 px-3 py-1 rounded-full text-[11px] font-mono font-medium border flex items-center gap-1.5"
                style={{
                  backgroundColor: bunkBudget.isAboveTarget ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                  borderColor: bunkBudget.isAboveTarget ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)',
                  color: bunkBudget.isAboveTarget ? '#10b981' : '#f43f5e'
                }}
              >
                <span>●</span>
                <span>{bunkBudget.isAboveTarget ? `${bunkBudget.bunksAvailable} Bunks Safe` : `Deficit: +${bunkBudget.classesNeeded} Classes`}</span>
              </div>

              <p className="text-[11px] mt-2 max-w-xs leading-relaxed" style={{ color: textSecondary }}>
                {bunkBudget.isAboveTarget 
                  ? `Current buffer permits ${bunkBudget.bunksAvailable} absence${bunkBudget.bunksAvailable === 1 ? '' : 's'} before dropping below 75%.`
                  : `Attend ${bunkBudget.classesNeeded} consecutive sessions to restore institutional compliance.`}
              </p>

              {/* Micro Steppers */}
              <div className="grid grid-cols-2 gap-2 w-full mt-4 pt-3 border-t" style={{ borderColor: borderSubtle }}>
                <div 
                  className="flex justify-between items-center px-2.5 py-1.5 rounded border text-[11px] font-mono"
                  style={{ borderColor: borderSubtle, color: textSecondary }}
                >
                  <span>Pres: {present}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setPresent(p => Math.max(0, p - 1))} className="w-4 h-4 rounded border text-center leading-none" style={{ borderColor: border }}>-</button>
                    <button onClick={() => setPresent(p => p + 1)} className="w-4 h-4 rounded border text-center leading-none" style={{ borderColor: border }}>+</button>
                  </div>
                </div>

                <div 
                  className="flex justify-between items-center px-2.5 py-1.5 rounded border text-[11px] font-mono"
                  style={{ borderColor: borderSubtle, color: textSecondary }}
                >
                  <span>Abs: {absent}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setAbsent(a => Math.max(0, a - 1))} className="w-4 h-4 rounded border text-center leading-none" style={{ borderColor: border }}>-</button>
                    <button onClick={() => setAbsent(a => a + 1)} className="w-4 h-4 rounded border text-center leading-none" style={{ borderColor: border }}>+</button>
                  </div>
                </div>
              </div>
            </div>

            {/* COLUMN 3: Live Radar Poll (4.5 cols) */}
            <div 
              className="lg:col-span-4 p-5 rounded-xl border flex flex-col justify-between"
              style={{
                backgroundColor: surfaceElevated,
                borderColor: borderSubtle
              }}
            >
              <div>
                <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textTertiary }}>
                  <span>Live Attendance Radar</span>
                  <span>⏱ {formatTimer(countdown)}</span>
                </div>

                <h3 className="text-base font-semibold tracking-tight">Faculty In Attendance?</h3>
                <p className="text-xs mt-0.5" style={{ color: textSecondary }}>
                  Crowd-sourced verification for {course.room}.
                </p>

                {/* SCROLLTIDE #c-glow-ring-button: Minimal Luminous Filament Orbit */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  
                  {/* IN CLASS button with subtle rotating filament */}
                  <div className="relative rounded-lg p-[1px] overflow-hidden group">
                    <div 
                      className="absolute inset-[-150%] rounded-full opacity-50 group-hover:opacity-100 transition-opacity"
                      style={{
                        background: 'conic-gradient(from 0deg, transparent 0deg, var(--text-primary) 60deg, transparent 120deg)',
                        animation: 'spinFilament 5s linear infinite'
                      }}
                    />
                    <button
                      onClick={() => handleVote('HAAN')}
                      className={`relative w-full py-2.5 px-3 rounded-[7px] text-xs font-mono font-medium flex items-center justify-between transition-all ${
                        userVote === 'HAAN' 
                          ? 'bg-zinc-100 text-black font-semibold' 
                          : isDark ? 'bg-[#090a0e] text-zinc-200 hover:bg-zinc-900' : 'bg-white text-zinc-800 hover:bg-zinc-50'
                      }`}
                    >
                      <span>IN CLASS</span>
                      <span className="text-[10px] opacity-60 font-mono">[{haan}]</span>
                    </button>
                  </div>

                  {/* NOT PRESENT button */}
                  <button
                    onClick={() => handleVote('NAHI')}
                    className={`py-2.5 px-3 rounded-lg border text-xs font-mono font-medium flex items-center justify-between transition-all ${
                      userVote === 'NAHI'
                        ? 'border-zinc-400 bg-white/10 font-semibold'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
                      borderColor: borderSubtle,
                      color: textPrimary
                    }}
                  >
                    <span>NOT HERE</span>
                    <span className="text-[10px] opacity-60 font-mono">[{nahi}]</span>
                  </button>

                </div>

                {/* Peer Consensus Panel */}
                <div 
                  className="mt-4 p-3 rounded-lg border text-xs font-mono"
                  style={{
                    backgroundColor: isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.02)',
                    borderColor: borderSubtle
                  }}
                >
                  <div className="flex justify-between text-[10px] mb-1.5" style={{ color: textTertiary }}>
                    <span>PEER CONSENSUS</span>
                    <span style={{ color: textPrimary }}>{haanPercent}% In Hall</span>
                  </div>

                  <div className="h-1 rounded-full bg-zinc-800/40 overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${haanPercent}%`,
                        backgroundColor: textPrimary
                      }}
                    />
                  </div>

                  <div className="flex justify-between text-[10px] mt-1.5" style={{ color: textTertiary }}>
                    <span>{totalVotes} verified peers</span>
                    <span>Active</span>
                  </div>
                </div>
              </div>

              {/* Intelligence Alert Banner */}
              <div 
                className="mt-4 p-2.5 rounded-lg border text-[11px] leading-relaxed flex items-start gap-2"
                style={{
                  backgroundColor: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
                  borderColor: borderSubtle,
                  color: textSecondary
                }}
              >
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isInHall ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <p>
                  {isInHall 
                    ? (activeTierObj.val >= 75 
                        ? 'Faculty presence confirmed. Zero late admittance permitted under current policy.' 
                        : 'Faculty presence confirmed. Moderate policy permits quiet rear entry.')
                    : 'Hall currently vacant. Estimated 8 minutes before scheduled commencement.'}
                </p>
              </div>
            </div>

          </div>

          {/* ========================================================= */}
          {/* ACTION TRAY                                               */}
          {/* ========================================================= */}
          <div 
            className="mt-6 pt-5 border-t flex flex-col sm:flex-row justify-between items-center gap-3"
            style={{ borderColor: borderSubtle }}
          >
            <div className="text-xs font-medium" style={{ color: textSecondary }}>
              Log Today&apos;s Session:
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => logAttendance('PRESENT')}
                className="px-4 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(5, 150, 105, 0.06)',
                  borderColor: 'rgba(16, 185, 129, 0.3)',
                  color: '#10b981'
                }}
              >
                + Present
              </button>

              <button
                onClick={() => logAttendance('ABSENT')}
                className="px-4 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all hover:-translate-y-0.5"
                style={{
                  backgroundColor: isDark ? 'rgba(244, 63, 94, 0.08)' : 'rgba(225, 29, 72, 0.06)',
                  borderColor: 'rgba(244, 63, 94, 0.3)',
                  color: '#f43f5e'
                }}
              >
                - Absent
              </button>

              <button
                onClick={() => logAttendance('EXCUSED')}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all hover:-translate-y-0.5 opacity-70 hover:opacity-100"
                style={{
                  backgroundColor: surfaceElevated,
                  borderColor: border,
                  color: textSecondary
                }}
              >
                Excused / Holiday
              </button>
            </div>
          </div>

        </div>

      </div>

      <style jsx global>{`
        @keyframes spinFilament {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
