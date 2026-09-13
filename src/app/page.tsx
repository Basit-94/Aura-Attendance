'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import dynamic from 'next/dynamic';
import {
  Check,
  X,
  Plus,
  Trash,
  LogOut,
  Calendar,
  Copy,
  Upload,
  RefreshCw,
  History,
  BookOpen,
  AlertCircle,
  Clock,
  ShieldCheck,
  Award,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  FileText,
  Sliders,
  Sun,
  Moon,
  Edit,
  Sparkles,
  Zap,
  Bell,
  ArrowUpDown,
  Radio,
  Users,
  Save,
  WifiOff,
  Layers
} from 'lucide-react';

const AttendanceChart = dynamic(() => import('@/components/AttendanceChart'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Loading chart visualizer...
    </div>
  ),
});

import { renderAttendanceReport } from '@/lib/exportEngine';

interface ScheduleSlot {
  id: string;
  subjectId: string;
  subjectName: string;
  type: 'LECTURE' | 'LAB';
  dayOfWeek: string;
  startTime: string;
  endTime: string;
}

interface Subject {
  id: string;
  name: string;
  type: 'LECTURE' | 'LAB';
  targetPercentage: number;
  stats: {
    present: number;
    absent: number;
    holiday: number;
    total: number;
    percentage: number;
  };
  logs: {
    id: string;
    date: string;
    status: 'PRESENT' | 'ABSENT' | 'HOLIDAY';
  }[];
}

interface Semester {
  id: string;
  name: string;
  isActive: boolean;
}

interface ArchiveSnapshot {
  id: string;
  semesterName: string;
  overallPercentage: number;
  lecturePercentage: number;
  labPercentage: number;
  archivedAt: string;
}

interface InactiveSemester {
  id: string;
  name: string;
  createdAt: string;
  stats: {
    overallPercentage: number;
    lecturePercentage: number;
    labPercentage: number;
    totalClasses: number;
  };
}

// Attendance advice calculator based on target criteria (75% or 60%)
const calculateAdvice = (present: number, total: number, target: number) => {
  if (total === 0) {
    return {
      status: 'neutral',
      text: 'No classes logged yet.',
      classCount: 0
    };
  }

  const currentPercent = (present / total) * 100;
  const G = target / 100;

  if (currentPercent >= target) {
    const maxBunk = Math.floor((present - G * total + 0.001) / G);
    if (maxBunk > 0) {
      return {
        status: 'safe',
        text: `Can skip next ${maxBunk} class${maxBunk > 1 ? 'es' : ''}`,
        classCount: maxBunk
      };
    } else {
      return {
        status: 'warning',
        text: 'Cannot skip next class',
        classCount: 0
      };
    }
  } else {
    const minAttend = Math.ceil((G * total - present - 0.001) / (1 - G));
    return {
      status: 'danger',
      text: `Attend next ${minAttend} class${minAttend > 1 ? 'es' : ''}`,
      classCount: minAttend
    };
  }
};

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to normalize course names for cross-student batch sharing
const normalizeCourseCode = (name: string): string => {
  if (!name) return 'general';
  return name
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/\blaboratory\b/g, 'lab')
    .replace(/[^a-z0-9&]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
};

// Helper to format YYYY-MM-DD into a readable date e.g. "Sat, Sep 12, 2026"
const formatFriendlyDate = (dateStr: string) => {
  try {
    const raw = dateStr.split('T')[0];
    const parts = raw.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  } catch {}
  return dateStr;
};

// Helper to format ISO log date with time if present
const formatLogDateTime = (isoDateStr: string) => {
  try {
    const datePartOnly = isoDateStr.split('T')[0];
    const friendlyDate = formatFriendlyDate(datePartOnly);
    let timePart: string | null = null;
    if (isoDateStr.includes('T')) {
      const timeCandidate = isoDateStr.split('T')[1].substring(0, 5);
      if (timeCandidate && timeCandidate !== '00:00') {
        timePart = timeCandidate;
      }
    }
    return {
      formattedDate: friendlyDate,
      timePart,
      isoDateOnly: datePartOnly
    };
  } catch {
    return {
      formattedDate: isoDateStr,
      timePart: null,
      isoDateOnly: isoDateStr
    };
  }
};

// Helper to match an attendance log to a specific class slot on a given date
const getSlotLog = (
  sub: Subject | undefined,
  dateStr: string,
  slotStartTime?: string,
  allSubjectSlotsOnDay?: { startTime: string }[]
) => {
  if (!sub || !sub.logs || sub.logs.length === 0) return undefined;

  const dayLogs = sub.logs.filter((l) => l.date.split('T')[0] === dateStr);
  if (dayLogs.length === 0) return undefined;

  if (!slotStartTime) return dayLogs[0];

  // 1. Exact match by slot start time (e.g. T09:30 or 09:30:)
  const exactMatch = dayLogs.find(
    (l) => l.date.includes(`T${slotStartTime}`) || l.date.includes(`${slotStartTime}:`)
  );
  if (exactMatch) return exactMatch;

  // 2. Legacy fallback: If there is ONLY ONE slot for this subject on this day, match legacy 00:00 log
  const hasMultipleSlotsOnDay = allSubjectSlotsOnDay && allSubjectSlotsOnDay.length > 1;
  if (!hasMultipleSlotsOnDay) {
    const legacyLog = dayLogs.find((l) => l.date.includes('T00:00') || l.date.endsWith('00:00.000Z'));
    if (legacyLog) return legacyLog;
  }

  return undefined;
};

// Official Verified Routine Slots for CAC 3 / CSE 3 (Updated Sept 2026)
const OFFICIAL_CSE3_SLOTS = [
  // MONDAY
  { subjectName: 'Operating Systems', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Object Oriented Programming Laboratory', type: 'LAB', dayOfWeek: 'MONDAY', startTime: '12:45', endTime: '13:45' },
  { subjectName: 'Object Oriented Programming Laboratory', type: 'LAB', dayOfWeek: 'MONDAY', startTime: '14:30', endTime: '17:30' },

  // TUESDAY
  { subjectName: 'Operating Systems Lab', type: 'LAB', dayOfWeek: 'TUESDAY', startTime: '09:30', endTime: '13:45' },
  { subjectName: 'Compiler Design', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '14:30', endTime: '15:30' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '15:30', endTime: '16:30' },
  { subjectName: 'Object Oriented Programming', type: 'LECTURE', dayOfWeek: 'TUESDAY', startTime: '16:30', endTime: '17:30' },

  // WEDNESDAY
  { subjectName: 'Object Oriented Programming', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Compiler Design', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Operating Systems', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '12:45', endTime: '13:45' },

  // THURSDAY
  { subjectName: 'Industrial Management', type: 'LECTURE', dayOfWeek: 'THURSDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Object Oriented Programming', type: 'LECTURE', dayOfWeek: 'THURSDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Constitution of India', type: 'LECTURE', dayOfWeek: 'THURSDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Software Engineering Laboratory', type: 'LAB', dayOfWeek: 'THURSDAY', startTime: '12:45', endTime: '13:45' },
  { subjectName: 'Software Engineering Laboratory', type: 'LAB', dayOfWeek: 'THURSDAY', startTime: '14:30', endTime: '17:30' },

  // FRIDAY
  { subjectName: 'Industrial Management', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Constitution of India', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Compiler Design', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '12:45', endTime: '13:45' },
  { subjectName: 'Operating Systems', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '14:30', endTime: '15:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '15:30', endTime: '16:30' },
  { subjectName: 'Industrial Management', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '16:30', endTime: '17:30' },
];

// Cutoff timestamp: Existing accounts registered during/before the routine revision rollout
const CSE3_ROUTINE_UPDATE_CUTOFF = new Date('2026-09-30T00:00:00+05:30').getTime();

// Effective date when the new CSE 3 routine comes into effect (Monday, Sep 14, 2026)
const NEW_ROUTINE_EFFECTIVE_DATE = '2026-09-14';

// Previous Official Routine Slots in effect until Friday, Sep 11, 2026 (Dates < 2026-09-14)
const PREVIOUS_CSE3_SLOTS = [
  // MONDAY
  { subjectName: 'Operating Systems', type: 'LECTURE' as const, dayOfWeek: 'MONDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE' as const, dayOfWeek: 'MONDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Object Oriented Programming', type: 'LECTURE' as const, dayOfWeek: 'MONDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Object Oriented Programming Laboratory', type: 'LAB' as const, dayOfWeek: 'MONDAY', startTime: '11:45', endTime: '17:30' },

  // TUESDAY
  { subjectName: 'Operating Systems Lab', type: 'LAB' as const, dayOfWeek: 'TUESDAY', startTime: '09:30', endTime: '13:45' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE' as const, dayOfWeek: 'TUESDAY', startTime: '14:30', endTime: '15:30' },
  { subjectName: 'Compiler Design', type: 'LECTURE' as const, dayOfWeek: 'TUESDAY', startTime: '15:30', endTime: '16:30' },
  { subjectName: 'Constitution of India', type: 'LECTURE' as const, dayOfWeek: 'TUESDAY', startTime: '16:30', endTime: '17:30' },

  // WEDNESDAY
  { subjectName: 'Object Oriented Programming', type: 'LECTURE' as const, dayOfWeek: 'WEDNESDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Industrial Management', type: 'LECTURE' as const, dayOfWeek: 'WEDNESDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE' as const, dayOfWeek: 'WEDNESDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Operating Systems', type: 'LECTURE' as const, dayOfWeek: 'WEDNESDAY', startTime: '12:45', endTime: '13:45' },
  { subjectName: 'Constitution of India', type: 'LECTURE' as const, dayOfWeek: 'WEDNESDAY', startTime: '15:30', endTime: '16:30' },

  // THURSDAY
  { subjectName: 'Compiler Design', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Object Oriented Programming', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Constitution of India', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Industrial Management', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '12:45', endTime: '13:45' },
  { subjectName: 'Operating Systems', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '14:30', endTime: '15:30' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '15:30', endTime: '16:30' },
  { subjectName: 'Software Engineering', type: 'LECTURE' as const, dayOfWeek: 'THURSDAY', startTime: '16:30', endTime: '17:30' },

  // FRIDAY (The exact 4-period schedule in effect till Friday, Sep 11, 2026)
  { subjectName: 'Industrial Management', type: 'LECTURE' as const, dayOfWeek: 'FRIDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Compiler Design', type: 'LECTURE' as const, dayOfWeek: 'FRIDAY', startTime: '10:30', endTime: '11:30' },
  { subjectName: 'Computer Graphics and Artificial Intelligence', type: 'LECTURE' as const, dayOfWeek: 'FRIDAY', startTime: '11:45', endTime: '12:45' },
  { subjectName: 'Software Engineering Laboratory', type: 'LAB' as const, dayOfWeek: 'FRIDAY', startTime: '12:45', endTime: '17:30' },
];

// Helper: Match a slot to student subjects flexibly with fallback and log-presence prioritization
const findSubjectForSlot = (
  subjectsList: Subject[],
  slotSubjectName: string,
  slotType: string,
  dateStr?: string,
  slotStartTime?: string
): Subject | undefined => {
  if (!subjectsList || subjectsList.length === 0) return undefined;

  const cleanText = (str: string) =>
    str
      .toLowerCase()
      .replace(/\band\b/g, '&')
      .replace(/\blaboratory\b/g, 'lab')
      .replace(/[^a-z0-9]/g, '');

  const normSlot = cleanText(slotSubjectName);

  // 1. Direct clean text and type match
  let candidates = subjectsList.filter((s) => {
    return cleanText(s.name) === normSlot && s.type?.toUpperCase() === slotType.toUpperCase();
  });

  // 2. Direct clean text match (ignore type if mismatch)
  if (candidates.length === 0) {
    candidates = subjectsList.filter((s) => cleanText(s.name) === normSlot);
  }

  // 3. Substring / inclusion match
  if (candidates.length === 0) {
    candidates = subjectsList.filter((s) => {
      const sClean = cleanText(s.name);
      return (sClean.includes(normSlot) || normSlot.includes(sClean)) &&
        (s.type?.toUpperCase() === slotType.toUpperCase());
    });
  }

  if (candidates.length === 0) {
    candidates = subjectsList.filter((s) => {
      const sClean = cleanText(s.name);
      return sClean.includes(normSlot) || normSlot.includes(sClean);
    });
  }

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  // If multiple candidates exist, prioritize the one with an attendance log on dateStr
  if (dateStr) {
    const candidateWithDateLog = candidates.find((cand) =>
      cand.logs?.some((l) => {
        const dPart = l.date.split('T')[0];
        if (dPart !== dateStr) return false;
        if (slotStartTime) {
          return l.date.includes(`T${slotStartTime}`) || l.date.includes(`${slotStartTime}:`);
        }
        return true;
      })
    );
    if (candidateWithDateLog) return candidateWithDateLog;
  }

  // Next prioritize exact type match
  const exactTypeMatch = candidates.find((c) => c.type?.toUpperCase() === slotType.toUpperCase());
  if (exactTypeMatch) return exactTypeMatch;

  return candidates[0];
};

// Helper: Determine if user belongs to CSE 3 (via notice action, local storage, or academic signature)
const isCse3Student = (subjectsList: Subject[], timetableList: ScheduleSlot[], noticeStatus: string) => {
  if (noticeStatus === 'applied_cse3') return true;
  if (typeof window !== 'undefined' && (
    localStorage.getItem('routine_notice_status_cse3_v5') === 'applied_cse3' ||
    localStorage.getItem('routine_notice_status_cse3_v3') === 'applied_cse3'
  )) {
    return true;
  }

  // Check if subject list has core CSE 3 signature subjects
  const subNames = subjectsList.map((s) => s.name.toLowerCase());
  const hasCompiler = subNames.some((n) => n.includes('compiler'));
  const hasManagement = subNames.some((n) => n.includes('management') || n.includes('industrial'));
  const hasGraphics = subNames.some((n) => n.includes('graphics'));
  if (hasCompiler && hasManagement && hasGraphics) return true;

  // Check if timetable has CSE 3 signature slots
  const hasCse3Slots = timetableList.some(
    (s) => s.subjectName?.toLowerCase().includes('compiler') ||
           (s.subjectName?.toLowerCase().includes('management') && s.dayOfWeek.toUpperCase() === 'FRIDAY')
  );
  if (hasCse3Slots && (hasCompiler || hasManagement)) return true;

  return false;
};

const isUserEligibleForRoutineNotice = (user?: { createdAt?: string } | null) => {
  if (!user) return false;
  // If user payload has no createdAt, default to eligible (existing account)
  if (!user.createdAt) return true;
  const userCreated = new Date(user.createdAt).getTime();
  if (isNaN(userCreated)) return true;
  return userCreated <= CSE3_ROUTINE_UPDATE_CUTOFF;
};

export default function Home() {
  // Global Mock Mode Check
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

  // App Toggles
  const [authMode, setAuthMode] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [studentSubMode, setStudentSubMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; uniqueCode: string; createdAt?: string } | null>(null);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [uploadFilter, setUploadFilter] = useState('');
  const [labGroupFilter, setLabGroupFilter] = useState('');

  // Timetable wizard states
  const [pendingTimetableFile, setPendingTimetableFile] = useState<File | null>(null);
  const [detectedStreams, setDetectedStreams] = useState<string[]>([]);
  const [detectedGroups, setDetectedGroups] = useState<string[]>([]);
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [selectedStream, setSelectedStream] = useState('');
  const [customStream, setCustomStream] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');

  // Timetable review editor states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewSlots, setReviewSlots] = useState<any[]>([]);

  // Routine Update Notice states
  const [showRoutineNotice, setShowRoutineNotice] = useState(false);
  const [routineNoticeStatus, setRoutineNoticeStatus] = useState<'unanswered' | 'temporary_closed' | 'dismissed_other_branch' | 'applied_cse3' | 'new_account'>('unanswered');
  const [isApplyingRoutine, setIsApplyingRoutine] = useState(false);

  // Data States
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [activeSemesterName, setActiveSemesterName] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timetable, setTimetable] = useState<ScheduleSlot[]>([]);
  const [archivedSummaries, setArchivedSummaries] = useState<ArchiveSnapshot[]>([]);
  const [inactiveSemesters, setInactiveSemesters] = useState<InactiveSemester[]>([]);

  // Semester renaming states
  const [isEditingSemesterName, setIsEditingSemesterName] = useState(false);
  const [tempSemesterName, setTempSemesterName] = useState('');

  // Teacher dashboard view data (read-only mode)
  const [teacherViewingData, setTeacherViewingData] = useState<{
    studentEmail: string;
    studentCode: string;
    semesterName: string;
    subjects: Subject[];
  } | null>(null);



  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Offline & PWA States
  const [isOfflineSyncPending, setIsOfflineSyncPending] = useState(false);
  const [isBrowserOffline, setIsBrowserOffline] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [inFlightChecks, setInFlightChecks] = useState<Record<string, boolean>>({});

  // Predictor Slider state
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [bunkCount, setBunkCount] = useState(0);

  // Heatmap interactive tooltip for mobile/touch
  const [activeHeatmapCell, setActiveHeatmapCell] = useState<{
    subjectId: string;
    dateStr: string;
    formattedDate: string;
    status: string;
    statusClass: string;
  } | null>(null);

  // Subject Full Attendance History Modal
  const [selectedSubjectForHistory, setSelectedSubjectForHistory] = useState<Subject | null>(null);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'ALL' | 'PRESENT' | 'ABSENT' | 'HOLIDAY'>('ALL');
  const [historySortAsc, setHistorySortAsc] = useState<boolean>(true);

  // Modals
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<'LECTURE' | 'LAB'>('LECTURE');
  const [addTarget, setAddTarget] = useState(75);
  const [isSubmittingSubject, setIsSubmittingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState('');

  const [showAddSemester, setShowAddSemester] = useState(false);
  const [addSemName, setAddSemName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkInAbortControllers = useRef<Record<string, AbortController>>({});

  // Custom Criteria Thresholds
  const [criteriaA, setCriteriaA] = useState<number>(75);
  const [criteriaB, setCriteriaB] = useState<number>(60);

  // Theme & Design Version state
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [designVersion, setDesignVersion] = useState<'neo' | 'classic'>('neo');

  // Teacher Edit PIN states
  const [teacherEditPin, setTeacherEditPin] = useState('');
  const [enteredEditPin, setEnteredEditPin] = useState('');
  const [isTeacherEditingUnlocked, setIsTeacherEditingUnlocked] = useState(false);

  // Multi-day Bunk Simulator state
  const [bunkProjectionDays, setBunkProjectionDays] = useState<number>(3);

  // Tab State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timetable' | 'analytics' | 'calendar' | 'radar' | 'faculty'>('dashboard');

  // Live Class Radar ("Sir aa gaye kya?") states (Real-Time Synchronized)
  const [livePoll, setLivePoll] = useState<{
    haanCount: number;
    nahiCount: number;
    totalVotes: number;
    haanPercent: number;
    myVote: 'HAAN' | 'NAHI' | null;
  }>({
    haanCount: 0,
    nahiCount: 0,
    totalVotes: 0,
    haanPercent: 50,
    myVote: null
  });

  const [liveAllVibes, setLiveAllVibes] = useState<Record<string, {
    strictCount: number;
    neutralCount: number;
    chillCount: number;
    totalVibeVotes: number;
    dominantVibe: string;
    myVibe: string | null;
    myReviewText?: string | null;
    myUpdatedAt?: string | null;
    recentNotes?: { vibe: string; text: string; date: string }[];
  }>>({});
  const [isPollSubmitting, setIsPollSubmitting] = useState(false);
  const [radarTimerSec, setRadarTimerSec] = useState<number>(480);
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());

  // Dedicated Faculty Reviews state
  const [editingFacultyReview, setEditingFacultyReview] = useState<Record<string, boolean>>({});
  const [pendingReviewForm, setPendingReviewForm] = useState<Record<string, { vibe: string; text: string }>>({});
  const [isSavingReview, setIsSavingReview] = useState<Record<string, boolean>>({});
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('faculty_review_autosave');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [unsavedChanges, setUnsavedChanges] = useState<Record<string, boolean>>({});
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [unsavedPromptModal, setUnsavedPromptModal] = useState<{ open: boolean; targetTab: 'dashboard' | 'timetable' | 'analytics' | 'calendar' | 'radar' | 'faculty' | null }>({ open: false, targetTab: null });

  // Mobile Timetable view states (Day Cards vs Full Grid)
  const [timetableMobileView, setTimetableMobileView] = useState<'day' | 'grid'>('day');
  const [mobileSelectedDay, setMobileSelectedDay] = useState<string>(() => {
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return dayNames[new Date().getDay()];
  });

  // Calendar Logger state
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString());
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState<Date>(() => new Date());

  // Subject Filter State
  const [subjectFilter, setSubjectFilter] = useState<'ALL' | 'LECTURE' | 'LAB'>('ALL');

  // Teacher Batch Mode states
  const [isBatchModeActive, setIsBatchModeActive] = useState(false);
  const [batchStudents, setBatchStudents] = useState<any[]>([]);
  const [batchTargetSubjectName, setBatchTargetSubjectName] = useState('');
  const [batchTargetStatus, setBatchTargetStatus] = useState<'PRESENT' | 'ABSENT' | 'HOLIDAY'>('PRESENT');
  const [batchPins, setBatchPins] = useState<Record<string, string>>({});

  // Manual timetable slot scheduling states
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [slotDay, setSlotDay] = useState('');
  const [slotStartTime, setSlotStartTime] = useState('');
  const [slotEndTime, setSlotEndTime] = useState('');
  const [slotSubjectId, setSlotSubjectId] = useState('');

  // Timetable sharing states
  const [timetableShareCode, setTimetableShareCode] = useState('');
  const [friendShareCodeInput, setFriendShareCodeInput] = useState('');
  const [showImportCodeModal, setShowImportCodeModal] = useState(false);
  const [copiedShareCode, setCopiedShareCode] = useState(false);

  // Initialize and load saved criteria & theme
  useEffect(() => {
    const savedA = localStorage.getItem('attendance_criteria_a');
    const savedB = localStorage.getItem('attendance_criteria_b');
    if (savedA) setCriteriaA(parseInt(savedA));
    if (savedB) setCriteriaB(parseInt(savedB));

    const savedTheme = localStorage.getItem('aura_theme') || 'light';
    setTheme(savedTheme as 'dark' | 'light');
    document.documentElement.classList.toggle('light', savedTheme === 'light');
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');

    const savedDesign = (localStorage.getItem('aura_design_version') as 'neo' | 'classic') || 'neo';
    setDesignVersion(savedDesign);
    document.documentElement.classList.toggle('design-neo', savedDesign === 'neo');
    document.documentElement.classList.toggle('design-classic', savedDesign === 'classic');
  }, []);

  // Live 1-second clock ticker for accurate timetable matching and class countdown (scoped to radar tab for mobile battery & performance)
  useEffect(() => {
    if (activeTab !== 'radar') return;
    setCurrentTime(new Date());
    const clockTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, [activeTab]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('aura_theme', newTheme);
    document.documentElement.classList.toggle('light', newTheme === 'light');
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  const toggleDesignVersion = () => {
    const nextDesign = designVersion === 'neo' ? 'classic' : 'neo';
    setDesignVersion(nextDesign);
    localStorage.setItem('aura_design_version', nextDesign);
    document.documentElement.classList.toggle('design-neo', nextDesign === 'neo');
    document.documentElement.classList.toggle('design-classic', nextDesign === 'classic');
  };

  const handleUpdateCriteriaA = (val: number) => {
    setCriteriaA(val);
    localStorage.setItem('attendance_criteria_a', val.toString());
  };

  const handleUpdateCriteriaB = (val: number) => {
    setCriteriaB(val);
    localStorage.setItem('attendance_criteria_b', val.toString());
  };

  const fetchTeacherEditPin = async () => {
    try {
      const res = await fetch('/api/student/pin');
      if (res.ok) {
        const data = await res.json();
        setTeacherEditPin(data.pin);
      }
    } catch (err) {
      console.error('Failed to fetch PIN:', err);
    }
  };

  const rotateTeacherEditPin = async () => {
    try {
      const res = await fetch('/api/student/pin', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTeacherEditPin(data.pin);
        setSuccess('Teacher Edit PIN rotated successfully!');
        setError('');
      }
    } catch (err) {
      console.error('Failed to rotate PIN:', err);
    }
  };

  // Initialize session checks
  useEffect(() => {
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dev OTP fetcher removed because OTP verification has been disabled

  const checkSession = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.student);
        setIsLoggedIn(true);
        fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // Check if CSE 3 routine notice should be displayed upon login or foreground resume
  useEffect(() => {
    // Reset stale test statuses from earlier versions to ensure all mobile users see the notice
    if (typeof window !== 'undefined') {
      try {
        const storedRoutineVer = localStorage.getItem('aura_pwa_routine_version');
        if (storedRoutineVer !== 'v5') {
          localStorage.setItem('aura_pwa_routine_version', 'v5');
          localStorage.removeItem('routine_notice_status_cse3_v3');
          localStorage.removeItem('routine_notice_status_cse3_v4');
        }
      } catch (e) {}
    }

    const checkAndTriggerNotice = () => {
      if (isLoggedIn && currentUser) {
        try {
          const storedStatus = (localStorage.getItem('routine_notice_status_cse3_v5') || 'unanswered') as any;
          setRoutineNoticeStatus(storedStatus);

          const eligible = isUserEligibleForRoutineNotice(currentUser);
          if (eligible && storedStatus !== 'dismissed_other_branch' && storedStatus !== 'applied_cse3' && storedStatus !== 'new_account') {
            setShowRoutineNotice(true);
          }
        } catch (e) {}
      }
    };

    const timer = setTimeout(checkAndTriggerNotice, 600);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkAndTriggerNotice();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isLoggedIn, currentUser]);


  const fetchShareCode = async () => {
    try {
      const res = await fetch('/api/timetable/share');
      if (res.ok) {
        const data = await res.json();
        setTimetableShareCode(data.shareCode);
      }
    } catch (err) {
      console.error('Failed to fetch share code:', err);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const resSubjects = await fetch('/api/subjects');
      if (resSubjects.ok) {
        const data = await resSubjects.json();
        setSubjects(data.subjects);
        setActiveSemesterName(data.semesterName);
        if (data.subjects.length > 0 && !selectedSubjectId) {
          setSelectedSubjectId(data.subjects[0].id);
        }
      }

      const resTimetable = await fetch('/api/timetable');
      if (resTimetable.ok) {
        const data = await resTimetable.json();
        setTimetable(data.timetable);
      }

      const resSemesters = await fetch('/api/semester');
      if (resSemesters.ok) {
        const data = await resSemesters.json();
        setSemesters(data.semesters);
      }

      fetchTeacherEditPin();
      fetchShareCode();
    } catch (err) {
      console.error(err);
    }
  };

  const addToOfflineQueue = (subjectId: string, status: string, dateOverride?: string) => {
    const todayStr = dateOverride || getLocalDateString();
    const logItem = {
      subjectId,
      date: todayStr,
      status,
      timestamp: Date.now()
    };
    
    const existingQueueStr = localStorage.getItem('aura_offline_logs');
    let queue = existingQueueStr ? JSON.parse(existingQueueStr) : [];
    
    queue = queue.filter((item: any) => !(item.subjectId === subjectId && item.date === todayStr));
    queue.push(logItem);
    
    localStorage.setItem('aura_offline_logs', JSON.stringify(queue));
    setIsOfflineSyncPending(true);
  };

  const syncOfflineLogs = async () => {
    const existingQueueStr = localStorage.getItem('aura_offline_logs');
    if (!existingQueueStr) return;
    
    const queue = JSON.parse(existingQueueStr);
    if (queue.length === 0) return;
    
    console.log(`[Offline Sync] Syncing ${queue.length} attendance logs...`);
    const successfulIds: number[] = [];
    
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        const res = await fetch('/api/attendance/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectId: item.subjectId,
            date: item.date,
            status: item.status,
          }),
        });
        
        if (res.ok) {
          successfulIds.push(item.timestamp);
        }
      } catch (err) {
        console.warn('[Offline Sync] Sync failed for item:', item, err);
        break;
      }
    }
    
    const remainingQueue = queue.filter((item: any) => !successfulIds.includes(item.timestamp));
    if (remainingQueue.length > 0) {
      localStorage.setItem('aura_offline_logs', JSON.stringify(remainingQueue));
      setIsOfflineSyncPending(true);
    } else {
      localStorage.removeItem('aura_offline_logs');
      setIsOfflineSyncPending(false);
      fetchDashboardData();
    }
  };

  // Register PWA service worker and initialize online/offline listeners
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      // Purge any legacy caches immediately from window.caches
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((key) => {
            if (key !== 'aura-attend-cache-v5') {
              console.log('[App] Clearing old cache:', key);
              caches.delete(key);
            }
          });
        }).catch(() => {});
      }

      const registerSW = () => {
        navigator.serviceWorker.register('/sw.js').then(
          (registration) => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
            // Proactively check for SW updates
            registration.update().catch(() => {});

            // If a worker is waiting, tell it to skip waiting immediately
            if (registration.waiting) {
              registration.waiting.postMessage({ action: 'skipWaiting' });
            }
          },
          (err) => {
            console.log('ServiceWorker registration failed: ', err);
          }
        );

        // Also update all existing registrations
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((reg) => {
            reg.update().catch(() => {});
            if (reg.waiting) {
              reg.waiting.postMessage({ action: 'skipWaiting' });
            }
          });
        }).catch(() => {});
      };

      if (document.readyState === 'complete') {
        registerSW();
      } else {
        window.addEventListener('load', registerSW);
      }

      let hasRefreshed = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hasRefreshed) {
          hasRefreshed = true;
          window.location.reload();
        }
      });

      // Handle message from sw to force reload
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'FORCE_REFRESH_PWA' && !hasRefreshed) {
          hasRefreshed = true;
          window.location.reload();
        }
      });
    }

    setIsBrowserOffline(!navigator.onLine);
    
    const existingQueueStr = localStorage.getItem('aura_offline_logs');
    if (existingQueueStr && JSON.parse(existingQueueStr).length > 0) {
      setIsOfflineSyncPending(true);
      if (navigator.onLine) {
        syncOfflineLogs();
      }
    }

    const handleOnline = () => {
      setIsBrowserOffline(false);
      syncOfflineLogs();
    };

    const handleOffline = () => {
      setIsBrowserOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchHistoryData = async () => {
    try {
      const res = await fetch('/api/attendance/history');
      if (res.ok) {
        const data = await res.json();
        setArchivedSummaries(data.archivedSummaries);
        setInactiveSemesters(data.inactiveSemesters);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Auth Operations
  const handleStudentAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (studentSubMode === 'LOGIN') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setCurrentUser(data.student);
        setIsLoggedIn(true);
        fetchDashboardData();
        setEmail('');
        setPassword('');
      } else {
        // Direct Sign-up (no OTP)
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        localStorage.setItem('routine_notice_status_cse3_v5', 'new_account');
        setRoutineNoticeStatus('new_account');
        setCurrentUser(data.student);
        setIsLoggedIn(true);
        fetchDashboardData();
        setSuccess('Account created and logged in!');
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTeacherAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      // Check if multiple comma-separated student codes were entered
      const isBatch = studentCode.includes(',');
      if (isBatch) {
        const codes = studentCode.split(',').map(c => c.trim()).filter(c => c.length > 0);
        if (codes.length === 0) throw new Error('Please enter valid student codes.');
        
        const initialBatch = codes.map(code => ({
          studentCode: code,
          email: '',
          pin: '',
          isUnlocked: false,
          subjects: [],
          semesterName: '',
        }));

        setBatchStudents(initialBatch);
        setIsBatchModeActive(true);
        setTeacherViewingData({
          studentEmail: 'Batch Mode',
          studentCode: studentCode,
          semesterName: 'Multiple Semesters',
          subjects: [],
        });
        setSuccess('Batch mode initiated. Please unlock students below with their Edit PINs.');
        setIsLoading(false);
        return;
      }

      // Single student verification via PIN
      if (!enteredEditPin || enteredEditPin.length !== 4) {
        throw new Error('Please enter a valid 4-digit Teacher Edit PIN.');
      }

      const res = await fetch('/api/teacher/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentCode, teacherEditPin: enteredEditPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setTeacherViewingData({
        studentEmail: data.student.email,
        studentCode: data.student.uniqueCode,
        semesterName: data.semesterName,
        subjects: data.subjects,
      });
      setIsTeacherEditingUnlocked(true); // Automatically unlock editing
      setSuccess('Student credentials and PIN verified successfully!');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setIsLoggedIn(false);
      setCurrentUser(null);
      setSubjects([]);
      setTimetable([]);
      setTeacherViewingData(null);
      setViewingHistory(false);
    } catch (err) {
      console.error(err);
    }
  };

  // Quick Check-in Actions with slot-specific timing support
  const handleCheckIn = async (
    subjectId: string, 
    status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' | 'REMOVE', 
    dateOverride?: string,
    slotStartTime?: string
  ) => {
    const targetDateStr = dateOverride || getLocalDateString();
    const checkKey = `${targetDateStr}_${subjectId}_${slotStartTime || '00'}`;

    // Abort previous request for this specific slot if it exists
    if (checkInAbortControllers.current[checkKey]) {
      checkInAbortControllers.current[checkKey].abort();
    }
    const controller = new AbortController();
    checkInAbortControllers.current[checkKey] = controller;
    
    // Set in-flight check indicator
    setInFlightChecks(prev => ({ ...prev, [checkKey]: true, [subjectId]: true }));

    const fullDateTimeStr = slotStartTime 
      ? `${targetDateStr}T${slotStartTime}:00.000Z` 
      : `${targetDateStr}T00:00:00.000Z`;

    // Optimistic Update
    const previousSubjects = [...subjects];
    setSubjects(prevSubjects => {
      return prevSubjects.map(sub => {
        if (sub.id !== subjectId) return sub;

        let updatedLogs = sub.logs ? [...sub.logs] : [];
        const todayLogIndex = updatedLogs.findIndex(log => {
          const logDatePart = log.date.split('T')[0];
          if (logDatePart !== targetDateStr) return false;
          if (slotStartTime) {
            return log.date.includes(`T${slotStartTime}`) || log.date.includes(`${slotStartTime}:`);
          }
          return true;
        });

        const oldTodayLog = todayLogIndex !== -1 ? sub.logs?.[todayLogIndex] : undefined;
        const oldStatus = oldTodayLog?.status || 'NONE';

        let presentDiff = 0;
        let absentDiff = 0;
        let holidayDiff = 0;

        if (status === 'REMOVE') {
          if (slotStartTime) {
            if (todayLogIndex !== -1) {
              const old = updatedLogs[todayLogIndex];
              if (old.status === 'PRESENT') presentDiff--;
              else if (old.status === 'ABSENT') absentDiff--;
              else if (old.status === 'HOLIDAY') holidayDiff--;
              updatedLogs.splice(todayLogIndex, 1);
            }
          } else {
            const logsToRemove = updatedLogs.filter(log => log.date.split('T')[0] === targetDateStr);
            logsToRemove.forEach(l => {
              if (l.status === 'PRESENT') presentDiff--;
              else if (l.status === 'ABSENT') absentDiff--;
              else if (l.status === 'HOLIDAY') holidayDiff--;
            });
            updatedLogs = updatedLogs.filter(log => log.date.split('T')[0] !== targetDateStr);
          }
        } else {
          if (todayLogIndex !== -1) {
            updatedLogs[todayLogIndex] = { ...updatedLogs[todayLogIndex], status };
          } else {
            updatedLogs = [{ id: `temp-${Date.now()}-${slotStartTime || '00'}`, date: fullDateTimeStr, status }, ...updatedLogs];
          }

          if (oldStatus === 'PRESENT') presentDiff--;
          else if (oldStatus === 'ABSENT') absentDiff--;
          else if (oldStatus === 'HOLIDAY') holidayDiff--;

          if (status === 'PRESENT') presentDiff++;
          else if (status === 'ABSENT') absentDiff++;
          else if (status === 'HOLIDAY') holidayDiff++;
        }

        const newPresent = Math.max(0, sub.stats.present + presentDiff);
        const newAbsent = Math.max(0, sub.stats.absent + absentDiff);
        const newHoliday = Math.max(0, sub.stats.holiday + holidayDiff);
        const newTotal = newPresent + newAbsent;
        const newPercentage = newTotal > 0 ? (newPresent / newTotal) * 100 : 100.0;

        return {
          ...sub,
          logs: updatedLogs,
          stats: {
            ...sub.stats,
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10
          }
        };
      });
    });

    // Instant offline handling: if device is offline in a basement/poor-signal classroom, queue immediately with 0ms delay
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.log('[handleCheckIn] Device is offline. Queuing check-in locally.');
      addToOfflineQueue(subjectId, status, fullDateTimeStr);
      setSuccess('Offline Mode: Check-in saved locally. Auto-sync will run when connection returns.');
      setInFlightChecks(prev => {
        const next = { ...prev };
        delete next[checkKey];
        return next;
      });
      return;
    }

    try {
      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          date: fullDateTimeStr,
          status,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        // Rollback on error
        setSubjects(previousSubjects);
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to update attendance');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[handleCheckIn] Request aborted for slot:', checkKey);
        return;
      }
      console.warn('[handleCheckIn] Network request failed. Saving check-in locally.', err);
      addToOfflineQueue(subjectId, status, fullDateTimeStr);
      setSuccess('Offline Mode: Attendance saved locally. We will sync it when connection returns.');
    } finally {
      setInFlightChecks(prev => {
        const next = { ...prev };
        delete next[checkKey];
        delete next[subjectId];
        return next;
      });
      if (checkInAbortControllers.current[checkKey] === controller) {
        delete checkInAbortControllers.current[checkKey];
      }
    }
  };

  const handleTeacherCheckIn = async (subjectId: string, status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' | 'REMOVE') => {
    if (!teacherViewingData) return;
    
    if (checkInAbortControllers.current[subjectId]) {
      checkInAbortControllers.current[subjectId].abort();
    }
    const controller = new AbortController();
    checkInAbortControllers.current[subjectId] = controller;

    setError('');
    setSuccess('');

    // Optimistic Update for Teacher View
    const previousTeacherViewingData = teacherViewingData;
    setTeacherViewingData(prev => {
      if (!prev) return null;
      const updatedSubjects = prev.subjects.map(sub => {
        if (sub.id !== subjectId) return sub;

        const todayDateStr = getLocalDateString();
        let updatedLogs = sub.logs ? [...sub.logs] : [];
        const todayLogIndex = updatedLogs.findIndex(log => log.date.split('T')[0] === todayDateStr);

        if (status === 'REMOVE') {
          if (todayLogIndex !== -1) {
            updatedLogs.splice(todayLogIndex, 1);
          }
        } else {
          if (todayLogIndex !== -1) {
            updatedLogs[todayLogIndex] = { ...updatedLogs[todayLogIndex], status };
          } else {
            updatedLogs = [{ id: `temp-${Date.now()}`, date: new Date(getLocalDateString()).toISOString(), status }, ...updatedLogs];
          }
        }

        const oldTodayLog = sub.logs?.find(log => log.date.split('T')[0] === todayDateStr);
        const oldStatus = oldTodayLog?.status || 'NONE';
        
        let presentDiff = 0;
        let absentDiff = 0;
        let holidayDiff = 0;

        if (oldStatus === 'PRESENT') presentDiff--;
        else if (oldStatus === 'ABSENT') absentDiff--;
        else if (oldStatus === 'HOLIDAY') holidayDiff--;

        if (status === 'PRESENT') presentDiff++;
        else if (status === 'ABSENT') absentDiff++;
        else if (status === 'HOLIDAY') holidayDiff++;

        const newPresent = Math.max(0, sub.stats.present + presentDiff);
        const newAbsent = Math.max(0, sub.stats.absent + absentDiff);
        const newHoliday = Math.max(0, sub.stats.holiday + holidayDiff);
        const newTotal = newPresent + newAbsent;
        const newPercentage = newTotal > 0 ? (newPresent / newTotal) * 100 : 100.0;

        return {
          ...sub,
          logs: updatedLogs,
          stats: {
            ...sub.stats,
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10
          }
        };
      });
      return { ...prev, subjects: updatedSubjects };
    });

    try {
      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          date: getLocalDateString(),
          status,
          studentCode: teacherViewingData.studentCode,
          teacherEditPin: enteredEditPin,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setTeacherViewingData(previousTeacherViewingData);
        throw new Error(data.error);
      }

      setSuccess('Attendance logged successfully!');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[handleTeacherCheckIn] Request aborted for subject:', subjectId);
        return;
      }
      setError(err.message || 'Failed to update attendance');
      setTeacherViewingData(previousTeacherViewingData);
    } finally {
      if (checkInAbortControllers.current[subjectId] === controller) {
        delete checkInAbortControllers.current[subjectId];
      }
    }
  };

  const refreshTeacherMirrorData = async () => {
    if (!teacherViewingData) return;
    try {
      const res = await fetch('/api/teacher/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentCode: teacherViewingData.studentCode,
          teacherEditPin: enteredEditPin,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTeacherViewingData({
          studentEmail: data.student.email,
          studentCode: data.student.uniqueCode,
          semesterName: data.semesterName,
          subjects: data.subjects,
        });
      }
    } catch (err) {
      console.error('Failed to refresh teacher view:', err);
    }
  };


  const getLast30Days = () => {
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(getLocalDateString(d));
    }
    return dates;
  };

  const getProjectedMissCount = (subjectId: string, daysCount: number): number => {
    let missCount = 0;
    const start = new Date();
    for (let i = 1; i <= daysCount; i++) {
      const nextDay = new Date(start);
      nextDay.setDate(start.getDate() + i);
      const dayOfWeekName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][nextDay.getDay()];
      const matchingSlots = timetable.filter(
        slot => slot.subjectId === subjectId && slot.dayOfWeek.toUpperCase() === dayOfWeekName
      );
      missCount += matchingSlots.length;
    }
    return missCount;
  };

  const handleUnlockBatchStudent = async (code: string, pin: string) => {
    if (pin.length !== 4) {
      setError('Please enter a valid 4-digit PIN for ' + code);
      return;
    }
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/teacher/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentCode: code,
          teacherEditPin: pin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setBatchStudents((prev) => 
        prev.map((s: any) => 
          s.studentCode === code 
            ? { ...s, email: data.student.email, isUnlocked: true, subjects: data.subjects, semesterName: data.semesterName, pin }
            : s
        )
      );
      setSuccess(`Unlocked student ${code} successfully!`);
    } catch (err: any) {
      setError(err.message || `Failed to unlock student ${code}`);
    }
  };

  const handleBatchSubmitAttendance = async () => {
    const unlockedStudents = batchStudents.filter((s: any) => s.isUnlocked);
    if (unlockedStudents.length === 0) {
      setError('Please unlock at least one student first.');
      return;
    }
    if (!batchTargetSubjectName) {
      setError('Please select a subject.');
      return;
    }

    setError('');
    setSuccess('');
    setIsLoading(true);

    let successCount = 0;
    let failCount = 0;

    for (const student of unlockedStudents) {
      const matchingSub = student.subjects.find(
        (sub: any) => sub.name.toLowerCase() === batchTargetSubjectName.toLowerCase()
      );

      if (!matchingSub) {
        failCount++;
        continue;
      }

      try {
        const res = await fetch('/api/attendance/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectId: matchingSub.id,
            date: getLocalDateString(),
            status: batchTargetStatus,
            studentCode: student.studentCode,
            teacherEditPin: student.pin,
          }),
        });

        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }
    }

    for (const student of unlockedStudents) {
      try {
        const res = await fetch('/api/teacher/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentCode: student.studentCode,
            teacherEditPin: student.pin,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setBatchStudents((prev) =>
            prev.map((s: any) =>
              s.studentCode === student.studentCode
                ? { ...s, subjects: data.subjects }
                : s
            )
          );
        }
      } catch (err) {
        console.error(err);
      }
    }
    setIsLoading(false);
    setSuccess(`Logged attendance successfully for ${successCount} student(s). Failed for ${failCount} student(s).`);
  };

  const handleExportCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Subject Name,Subject Type,Status\n";
    
    subjects.forEach((sub: any) => {
      sub.logs?.forEach((log: any) => {
        csvContent += `${log.date.split('T')[0]},"${sub.name}",${sub.type},${log.status}\n`;
      });
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${activeSemesterName || 'Semester'}_attendance_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportPDF = () => {
    const overallStats = getOverallStats(subjects);
    const lectureStats = getTypeStatsFull(subjects, 'LECTURE');
    const labStats = getTypeStatsFull(subjects, 'LAB');

    renderAttendanceReport({
      subjects: subjects as any,
      activeSemesterName,
      currentUser,
      criteriaA,
      overallStats,
      lectureStats,
      labStats,
      calculateAdvice,
    });
  };

  // Manual Add Subject
  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName.trim()) return;

    setIsSubmittingSubject(true);
    setSubjectError('');

    try {
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), type: addType, targetPercentage: addTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create subject');
      }

      setShowAddSubject(false);
      setAddName('');
      setSuccess(`Subject "${addName.trim()}" created successfully!`);
      fetchDashboardData();
    } catch (err: any) {
      console.error('handleAddSubject error:', err);
      setSubjectError(err.message || 'Failed to add subject');
    } finally {
      setIsSubmittingSubject(false);
    }
  };

  // Delete Subject
  const handleDeleteSubject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this subject? All its history will be lost.')) return;
    try {
      const res = await fetch(`/api/subjects?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Manual Add Semester
  const handleAddSemester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addSemName) return;

    try {
      const res = await fetch('/api/semester', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addSemName }),
      });
      if (res.ok) {
        setShowAddSemester(false);
        setAddSemName('');
        fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Rename Active Semester
  const handleRenameSemester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempSemesterName.trim()) return;

    const activeSem = semesters.find(s => s.isActive);
    if (!activeSem) return;

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/semester', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semesterId: activeSem.id, name: tempSemesterName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Semester renamed successfully!');
      setIsEditingSemesterName(false);
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Failed to rename semester.');
    } finally {
      setIsLoading(false);
    }
  };

  // Timetable pre-analysis and wizard trigger
  const handleTimetableUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsOcrLoading(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Analyze structure of the routine
      const res = await fetch('/api/timetable/analyze', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // If routine contains multiple branches/sections or groups
      if ((data.streams && data.streams.length > 0) || (data.groups && data.groups.length > 0)) {
        setPendingTimetableFile(file);
        setDetectedStreams(data.streams || []);
        setDetectedGroups(data.groups || []);
        setSelectedStream(data.streams?.[0] || '');
        setSelectedGroup(data.groups?.[0] || 'None');
        setShowWizardModal(true);
      } else {
        // Fallback: If no structure detected, upload directly
        await executeDirectUpload(file);
      }
    } catch (err: any) {
      setError(err.message || 'Timetable analysis failed. Trying direct upload...');
      await executeDirectUpload(file);
    } finally {
      setIsOcrLoading(false);
      // Reset input element value to allow uploading same file again
      if (e.target) e.target.value = '';
    }
  };

  const executeDirectUpload = async (file: File, stream?: string, group?: string) => {
    setIsOcrLoading(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    if (stream) {
      formData.append('branchSection', stream);
    } else if (uploadFilter) {
      formData.append('branchSection', uploadFilter);
    }
    if (group && group !== 'None') {
      formData.append('labGroup', group);
    } else if (labGroupFilter) {
      formData.append('labGroup', labGroupFilter);
    }

    try {
      const res = await fetch('/api/timetable/parse', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Display the parsed slots in the review editor!
      const slotsWithKeys = (data.classes || []).map((c: any, index: number) => ({
        keyId: `${Date.now()}-${index}`,
        subjectName: c.subjectName,
        type: c.type || 'LECTURE',
        dayOfWeek: c.dayOfWeek || 'MONDAY',
        startTime: c.startTime || '09:30',
        endTime: c.endTime || '10:30',
        isNewSubject: false
      }));

      setReviewSlots(slotsWithKeys);
      setShowReviewModal(true);
      setSuccess('Routine parsed successfully! Please review and verify below.');
    } catch (err: any) {
      setError(err.message || 'Timetable OCR failed. Please verify credentials or enter manually.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleWizardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTimetableFile) return;

    const streamToUse = selectedStream === '__CUSTOM__' ? customStream.trim() : selectedStream;
    const groupToUse = selectedGroup === '__CUSTOM__' ? customGroup.trim() : selectedGroup;

    if (selectedStream === '__CUSTOM__') setSelectedStream(streamToUse);
    if (selectedGroup === '__CUSTOM__') setSelectedGroup(groupToUse);

    setShowWizardModal(false);
    await executeDirectUpload(pendingTimetableFile, streamToUse, groupToUse);
    setPendingTimetableFile(null);
  };

  const handleUpdateReviewSlot = (index: number, field: string, value: any) => {
    setReviewSlots(prev => prev.map((s, idx) => idx === index ? { ...s, [field]: value } : s));
  };

  const handleManualTimetableEdit = () => {
    setReviewSlots([
      {
        keyId: `${Date.now()}-0`,
        subjectName: '',
        type: 'LECTURE',
        dayOfWeek: 'MONDAY',
        startTime: '09:30',
        endTime: '10:30',
        isNewSubject: true
      }
    ]);
    setShowReviewModal(true);
  };

  const handleAddReviewSlot = () => {
    console.log("[DEBUG] handleAddReviewSlot triggered. Current reviewSlots:", reviewSlots);
    
    // Default to the last slot's day, or MONDAY
    let defaultDay = 'MONDAY';
    if (reviewSlots.length > 0) {
      defaultDay = reviewSlots[reviewSlots.length - 1].dayOfWeek.toUpperCase();
    }
    
    // Find all slots on this day in reviewSlots
    const sameDaySlots = reviewSlots.filter(s => s.dayOfWeek.toUpperCase() === defaultDay);
    let defaultStart = '09:30';
    let defaultEnd = '10:30';
    
    if (sameDaySlots.length > 0) {
      // Find the latest endTime
      const sorted = [...sameDaySlots].sort((a, b) => b.endTime.localeCompare(a.endTime));
      defaultStart = sorted[0].endTime;
      
      const [h, m] = defaultStart.split(':').map(Number);
      const nextH = (h + 1) % 24;
      const pad = (num: number) => num.toString().padStart(2, '0');
      defaultEnd = `${pad(nextH)}:${pad(m)}`;
    }
    
    const newSlot = {
      keyId: `new-${Date.now()}-${reviewSlots.length}`,
      subjectName: '',
      type: 'LECTURE',
      dayOfWeek: defaultDay as any,
      startTime: defaultStart,
      endTime: defaultEnd,
      isNewSubject: true
    };
    setReviewSlots(prev => {
      const nextSlots = [...prev, newSlot];
      console.log("[DEBUG] Setting reviewSlots to:", nextSlots);
      return nextSlots;
    });
  };

  const handleDeleteReviewSlot = (index: number) => {
    setReviewSlots(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveVerifiedTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsOcrLoading(true);
    setError('');
    setSuccess('');

    // Validate that startTime is before endTime for all slots
    for (const slot of reviewSlots) {
      if (!slot.startTime || !slot.endTime) {
        setError('Please specify start and end times for all slots.');
        setIsOcrLoading(false);
        return;
      }
      if (slot.startTime >= slot.endTime) {
        setError(`Start time must be before end time for "${slot.subjectName || 'unnamed subject'}".`);
        setIsOcrLoading(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: reviewSlots }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Timetable saved successfully and attendance records mapped!');
      localStorage.setItem('timetable_uploaded_date', getLocalDateString());
      setShowReviewModal(false);
      setReviewSlots([]);
      await fetchDashboardData();
      setActiveTab('timetable');
    } catch (err: any) {
      setError(err.message || 'Failed to save timetable.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleApplyOfficialCse3Routine = async () => {
    setIsApplyingRoutine(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: OFFICIAL_CSE3_SLOTS }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      localStorage.setItem('routine_notice_status_cse3_v5', 'applied_cse3');
      setRoutineNoticeStatus('applied_cse3');
      setShowRoutineNotice(false);
      await fetchDashboardData();
      setActiveTab('timetable');
      setSuccess('🎉 Success! Official CSE 3 timetable applied directly to your account.');
    } catch (err: any) {
      setError(err.message || 'Failed to apply CSE 3 routine.');
    } finally {
      setIsApplyingRoutine(false);
    }
  };

  const handleDismissNoticeOtherBranch = () => {
    localStorage.setItem('routine_notice_status_cse3_v5', 'dismissed_other_branch');
    setRoutineNoticeStatus('dismissed_other_branch');
    setShowRoutineNotice(false);
  };

  const handleCloseNoticeCross = () => {
    // If closed via X without clicking Yes or No, allow persistent pill to stay visible and modal can reopen
    localStorage.setItem('routine_notice_status_cse3_v5', 'temporary_closed');
    setRoutineNoticeStatus('temporary_closed');
    setShowRoutineNotice(false);
  };

  // Archive & Reset Current Semester logs
  const handleSemesterReset = async () => {
    if (!confirm('Warning: This will archive your current overall percentages in history and wipe out all detailed attendance logs for the active subjects. This is ideal for a mid-sem reset. Proceed?')) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/attendance/history', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Current stats archived and attendance logs reset!');
      fetchDashboardData();
      if (viewingHistory) {
        fetchHistoryData();
      }
    } catch (err: any) {
      setError(err.message || 'Reset failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Restore archived semester
  const handleRestoreSemester = async (semesterId: string) => {
    if (!confirm('Reactivating this semester will deactivate your current active semester. Do you want to proceed?')) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/semester', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semesterId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Semester restored successfully!');
      setViewingHistory(false);
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Restoration failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Create manual timetable slot
  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotSubjectId || !slotDay || !slotStartTime || !slotEndTime) {
      setError('Please fill in all slot fields.');
      return;
    }
    if (slotStartTime >= slotEndTime) {
      setError('Start time must be before end time.');
      return;
    }
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/timetable/slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId: slotSubjectId,
          dayOfWeek: slotDay,
          startTime: slotStartTime,
          endTime: slotEndTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Timetable slot scheduled successfully!');
      localStorage.setItem('timetable_uploaded_date', getLocalDateString());
      setShowAddSlot(false);
      setSlotSubjectId('');
      setSlotStartTime('');
      setSlotEndTime('');
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Failed to create slot.');
    }
  };

  // Delete timetable slot
  const handleDeleteSlot = async (slotId: string) => {
    if (!confirm('Are you sure you want to delete this timetable slot?')) return;
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/timetable/slot?slotId=${slotId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Timetable slot removed successfully!');
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete slot.');
    }
  };

  // Copy active timetable share code
  const copyShareCodeToClipboard = () => {
    if (timetableShareCode) {
      navigator.clipboard.writeText(timetableShareCode);
      setCopiedShareCode(true);
      setTimeout(() => setCopiedShareCode(false), 2000);
    }
  };

  // Import timetable using friend's share code
  const handleImportFriendTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendShareCodeInput || friendShareCodeInput.trim().length < 8) {
      setError('Please enter a valid 8-character share code.');
      return;
    }
    if (!confirm("Warning: Importing a friend's routine will overwrite your weekly schedule slots. Your existing subjects and logged attendance history will be preserved. Proceed?")) return;
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/timetable/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: friendShareCodeInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess('Friend\'s routine imported successfully!');
      localStorage.setItem('timetable_uploaded_date', getLocalDateString());
      setShowImportCodeModal(false);
      setFriendShareCodeInput('');
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Failed to import routine.');
    } finally {
      setIsLoading(false);
    }
  };

  // Click empty cell to pre-populate new slot details
  const handleEmptyCellClick = (day: string, time: string) => {
    if (subjects.length === 0) {
      setSubjectError('Please create your first subject before scheduling classes.');
      setShowAddSubject(true);
      return;
    }
    setSlotDay(day);
    setSlotSubjectId(subjects[0]?.id || '');
    setSlotStartTime(time);
    
    const [hourStr, minStr] = time.split(':');
    const endHour = parseInt(hourStr) + 1;
    const endHourStr = endHour.toString().padStart(2, '0');
    setSlotEndTime(`${endHourStr}:${minStr}`);
    
    setShowAddSlot(true);
  };

  // Copy unique code to clipboard
  const copyCodeToClipboard = () => {
    if (currentUser?.uniqueCode) {
      navigator.clipboard.writeText(currentUser.uniqueCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  // Helper: Get overall combined percentage
  const getOverallStats = (subjectsList: Subject[]) => {
    let present = 0;
    let total = 0;
    subjectsList.forEach((s) => {
      present += s.stats.present;
      total += s.stats.total;
    });
    return {
      percentage: total > 0 ? Math.round((present / total) * 1000) / 10 : 100,
      present,
      total,
    };
  };

  // Helper: Get aggregate by type with counts (LECTURE or LAB)
  const getTypeStatsFull = (subjectsList: Subject[], type: 'LECTURE' | 'LAB') => {
    let present = 0;
    let total = 0;
    subjectsList.filter((s) => s.type === type).forEach((s) => {
      present += s.stats.present;
      total += s.stats.total;
    });
    return {
      percentage: total > 0 ? Math.round((present / total) * 100) : 100,
      present,
      total,
    };
  };

  // Helper: Get aggregate by type (LECTURE or LAB)
  const getTypeStats = (subjectsList: Subject[], type: 'LECTURE' | 'LAB') => {
    return getTypeStatsFull(subjectsList, type).percentage;
  };

  // Helper: Retrieve scheduled slots effective for a specific date,
  // respecting the official routine transition on Sept 14, 2026.
  const getEffectiveSlotsForDate = (dateStr: string, dayOfWeekName: string): ScheduleSlot[] => {
    const normalizedDay = dayOfWeekName.toUpperCase();
    const standardSlots = timetable.filter((s) => s.dayOfWeek.toUpperCase() === normalizedDay);

    // If date is on or after the new routine effective date, use the standard active timetable
    if (dateStr >= NEW_ROUTINE_EFFECTIVE_DATE) {
      return standardSlots;
    }

    // Check if user belongs to CSE 3
    const isCse3 = isCse3Student(subjects, timetable, routineNoticeStatus);
    if (!isCse3) {
      return standardSlots;
    }

    // Pre-2026-09-14: Return previous CSE 3 routine slots for this weekday
    const prevSlotsForDay = PREVIOUS_CSE3_SLOTS.filter((s) => s.dayOfWeek === normalizedDay);
    if (prevSlotsForDay.length === 0) {
      return standardSlots;
    }

    return prevSlotsForDay.map((slot) => {
      const matchingSubject = findSubjectForSlot(subjects, slot.subjectName, slot.type, dateStr, slot.startTime);
      return {
        id: `prev-${dateStr}-${matchingSubject ? matchingSubject.id : slot.subjectName}-${slot.startTime}`,
        subjectId: matchingSubject ? matchingSubject.id : '',
        subjectName: matchingSubject ? matchingSubject.name : slot.subjectName,
        type: slot.type as 'LECTURE' | 'LAB',
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
      };
    });
  };

  // =========================================================================
  // LIVE CLASS RADAR: REAL-TIME POLLING & VOTING HANDLERS
  // =========================================================================
  const fetchRadarData = async () => {
    try {
      const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
      const todayDateStr = getLocalDateString();
      const todaySlots = getEffectiveSlotsForDate(todayDateStr, todayDayName)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      const now = new Date();
      const currentMins = now.getHours() * 60 + now.getMinutes();

      let targetSlot = todaySlots.find(slot => {
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        return currentMins >= (sh * 60 + sm) && currentMins <= (eh * 60 + em);
      });

      if (!targetSlot) {
        targetSlot = todaySlots.find(slot => {
          const [sh, sm] = slot.startTime.split(':').map(Number);
          return (sh * 60 + sm) > currentMins;
        }) || todaySlots[0];
      }

      const courseName = targetSlot?.subjectName || subjects[0]?.name || 'General';
      const slotTime = targetSlot?.startTime || '10:00';

      const res = await fetch(`/api/class-poll?course=${encodeURIComponent(courseName)}&date=${todayDateStr}&slotTime=${encodeURIComponent(slotTime)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.poll) setLivePoll(data.poll);
          if (data.allVibes) setLiveAllVibes(data.allVibes);
        }
      }
    } catch (err) {
      console.error('Radar poll fetch error:', err);
    }
  };

  useEffect(() => {
    if (activeTab !== 'radar' && activeTab !== 'faculty') return;

    fetchRadarData();
    const pollInterval = setInterval(fetchRadarData, 3000);

    return () => {
      clearInterval(pollInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, subjects, timetable]);

  const handleVotePoll = async (activeCourseName: string, activeSlotTime: string, choice: 'HAAN' | 'NAHI') => {
    if (isPollSubmitting) return;
    setIsPollSubmitting(true);

    const todayDateStr = getLocalDateString();
    const newChoice = livePoll.myVote === choice ? 'REMOVE' : choice;

    // Optimistic UI update
    setLivePoll(prev => {
      let haan = prev.haanCount;
      let nahi = prev.nahiCount;

      if (prev.myVote === 'HAAN') haan = Math.max(0, haan - 1);
      if (prev.myVote === 'NAHI') nahi = Math.max(0, nahi - 1);

      if (newChoice === 'HAAN') haan++;
      if (newChoice === 'NAHI') nahi++;

      const total = haan + nahi;
      const pct = total > 0 ? Math.round((haan / total) * 100) : 50;

      return {
        haanCount: haan,
        nahiCount: nahi,
        totalVotes: total,
        haanPercent: pct,
        myVote: newChoice === 'REMOVE' ? null : newChoice
      };
    });

    try {
      const res = await fetch('/api/class-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'VOTE_POLL',
          rawCourse: activeCourseName,
          date: todayDateStr,
          slotTime: activeSlotTime,
          choice: newChoice
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.poll) {
          setLivePoll(data.poll);
        }
      }
    } catch (err) {
      console.error('Failed to cast live poll vote:', err);
    } finally {
      setIsPollSubmitting(false);
    }
  };

  const handleVoteVibe = async (courseName: string, vibeChoice: 'STRICT' | 'NEUTRAL' | 'CHILL') => {
    const normCode = normalizeCourseCode(courseName);
    const existing = liveAllVibes[normCode] || {
      strictCount: 0,
      neutralCount: 0,
      chillCount: 0,
      totalVibeVotes: 0,
      dominantVibe: 'NEUTRAL',
      myVibe: null,
    };

    const newVibe = existing.myVibe === vibeChoice ? null : vibeChoice;

    // Optimistic UI update
    setLiveAllVibes(prev => {
      const cur = prev[normCode] || {
        strictCount: 0,
        neutralCount: 0,
        chillCount: 0,
        totalVibeVotes: 0,
        dominantVibe: 'NEUTRAL',
        myVibe: null,
      };

      let s = cur.strictCount;
      let n = cur.neutralCount;
      let c = cur.chillCount;

      if (cur.myVibe === 'STRICT') s = Math.max(0, s - 1);
      if (cur.myVibe === 'NEUTRAL') n = Math.max(0, n - 1);
      if (cur.myVibe === 'CHILL') c = Math.max(0, c - 1);

      if (newVibe === 'STRICT') s++;
      if (newVibe === 'NEUTRAL') n++;
      if (newVibe === 'CHILL') c++;

      let dom: 'STRICT' | 'NEUTRAL' | 'CHILL' = 'NEUTRAL';
      if (s > n && s > c) dom = 'STRICT';
      else if (c > n && c > s) dom = 'CHILL';

      return {
        ...prev,
        [normCode]: {
          strictCount: s,
          neutralCount: n,
          chillCount: c,
          totalVibeVotes: s + n + c,
          dominantVibe: dom,
          myVibe: newVibe
        }
      };
    });

    try {
      const res = await fetch('/api/class-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'VOTE_VIBE',
          rawCourse: courseName,
          vibe: newVibe || 'REMOVE'
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.vibe) {
          setLiveAllVibes(prev => ({
            ...prev,
            [normCode]: data.vibe
          }));
        }
      }
    } catch (err) {
      console.error('Failed to submit faculty vibe:', err);
    }
  };

  const handleSaveFacultyReview = async (courseName: string, vibeChoice: string, reviewText: string) => {
    const normCode = normalizeCourseCode(courseName);
    setIsSavingReview(prev => ({ ...prev, [normCode]: true }));

    try {
      const res = await fetch('/api/class-poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SAVE_FACULTY_REVIEW',
          rawCourse: courseName,
          vibe: vibeChoice,
          reviewText: reviewText.trim()
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.vibe) {
          setLiveAllVibes(prev => ({
            ...prev,
            [normCode]: data.vibe
          }));
          setEditingFacultyReview(prev => ({ ...prev, [normCode]: false }));
          setUnsavedChanges(prev => {
            const next = { ...prev };
            delete next[normCode];
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Failed to save faculty review:', err);
    } finally {
      setIsSavingReview(prev => ({ ...prev, [normCode]: false }));
    }
  };

  const handleSaveAllFacultyReviews = async () => {
    setIsSavingAll(true);
    try {
      const unsavedNormCodes = Object.keys(unsavedChanges).filter(code => unsavedChanges[code]);
      const targets = subjects.filter(sub => {
        const normCode = normalizeCourseCode(sub.name);
        return unsavedNormCodes.includes(normCode) || Boolean(pendingReviewForm[normCode]);
      });

      if (targets.length === 0) {
        setIsSavingAll(false);
        return;
      }

      const promises = targets.map(sub => {
        const normCode = normalizeCourseCode(sub.name);
        const form = pendingReviewForm[normCode] || {
          vibe: liveAllVibes[normCode]?.myVibe || 'STRICT',
          text: liveAllVibes[normCode]?.myReviewText || ''
        };
        return fetch('/api/class-poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SAVE_FACULTY_REVIEW',
            rawCourse: sub.name,
            vibe: form.vibe,
            reviewText: form.text.trim()
          })
        }).then(res => res.json()).then(data => ({ normCode, data }));
      });

      const results = await Promise.allSettled(promises);
      const newVibes = { ...liveAllVibes };
      const newEditing = { ...editingFacultyReview };

      results.forEach(res => {
        if (res.status === 'fulfilled' && (res.value as any)?.data?.success && (res.value as any)?.data?.vibe) {
          newVibes[(res.value as any).normCode] = (res.value as any).data.vibe;
          newEditing[(res.value as any).normCode] = false;
        }
      });

      setLiveAllVibes(newVibes);
      setEditingFacultyReview(newEditing);
      setUnsavedChanges({});
    } catch (err) {
      console.error('Failed to save all faculty reviews:', err);
    } finally {
      setIsSavingAll(false);
    }
  };

  const toggleAutoSave = (enabled: boolean) => {
    setIsAutoSaveEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('faculty_review_autosave', String(enabled));
    }
    if (enabled && Object.values(unsavedChanges).some(Boolean)) {
      handleSaveAllFacultyReviews();
    }
  };

  const handleTabSwitch = (targetTab: 'dashboard' | 'timetable' | 'analytics' | 'calendar' | 'radar' | 'faculty') => {
    if (activeTab === targetTab) return;
    const hasUnsaved = activeTab === 'faculty' && !isAutoSaveEnabled && Object.values(unsavedChanges).some(Boolean);
    if (hasUnsaved) {
      setUnsavedPromptModal({ open: true, targetTab });
      return;
    }
    setActiveTab(targetTab);
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUnsaved = activeTab === 'faculty' && !isAutoSaveEnabled && Object.values(unsavedChanges).some(Boolean);
      if (hasUnsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeTab, isAutoSaveEnabled, unsavedChanges]);

  // Helper: Get dates in the last 14 days where there was a scheduled class but no attendance log was recorded
  const getMissedLogDates = () => {
    if (subjects.length === 0 || timetable.length === 0) return [];

    const missedDates: string[] = [];
    const today = new Date();

    // Limit start date by active semester creation date
    let checkStartDate = new Date();
    checkStartDate.setDate(today.getDate() - 14);

    const activeSem = semesters.find((s) => s.isActive);
    if (activeSem && (activeSem as any).createdAt) {
      const semCreatedDate = new Date((activeSem as any).createdAt);
      if (semCreatedDate > checkStartDate) {
        checkStartDate = semCreatedDate;
      }
    }

    // Also limit by timetable upload date
    const localUploadDateStr = localStorage.getItem('timetable_uploaded_date');
    if (localUploadDateStr) {
      const localUploadDate = new Date(localUploadDateStr);
      if (localUploadDate > checkStartDate) {
        checkStartDate = localUploadDate;
      }
    } else {
      // Fallback: use earliest log date if available, or default to today (meaning no warnings for past dates before they started)
      const allLogs = subjects.flatMap((s) => s.logs || []);
      if (allLogs.length > 0) {
        const sortedLogDates = allLogs
          .map((log) => log.date.split('T')[0])
          .sort();
        const earliestLogDate = new Date(sortedLogDates[0]);
        if (earliestLogDate > checkStartDate) {
          checkStartDate = earliestLogDate;
        }
      } else {
        checkStartDate = today;
      }
    }

    // Set times to midnight for precise date calculations
    checkStartDate.setHours(0, 0, 0, 0);
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const oneDayMs = 24 * 60 * 60 * 1000;
    const diffTime = yesterday.getTime() - checkStartDate.getTime();
    const diffDays = Math.ceil(diffTime / oneDayMs);

    if (diffDays < 0) return [];

    // Loop from diffDays ago up to 1 day ago (yesterday)
    for (let i = diffDays; i >= 1; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const dayOfWeek = dayNames[d.getDay()];

      // Check if there are scheduled classes on this weekday (respecting date-specific routine)
      const slots = getEffectiveSlotsForDate(dateStr, dayOfWeek);
      if (slots.length === 0) continue;

      // Check if any slot is missing an attendance log
      let hasMissedSlot = false;
      for (const slot of slots) {
        if (!slot.subjectId) continue;
        const sub = subjects.find((s) => s.id === slot.subjectId);
        if (!sub) continue;

        const slotsForThisSub = slots.filter((s) => s.subjectId === slot.subjectId);
        const log = getSlotLog(sub, dateStr, slot.startTime, slotsForThisSub);
        if (!log) {
          hasMissedSlot = true;
          break;
        }
      }

      if (hasMissedSlot) {
        missedDates.push(dateStr);
      }
    }

    return missedDates;
  };

  // Bulk Check-in logic for a specific date and list of slots
  const handleBulkCheckIn = async (
    status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' | 'REMOVE',
    dateStr: string,
    slots: any[]
  ) => {
    const eligibleSlots = slots.filter((s) => !!s.subjectId);
    if (eligibleSlots.length === 0) return;

    const previousSubjects = [...subjects];

    // Optimistically update frontend state
    setSubjects((prevSubjects) => {
      return prevSubjects.map((sub) => {
        const slotsForSub = eligibleSlots.filter((slot) => slot.subjectId === sub.id);
        if (slotsForSub.length === 0) return sub;

        let updatedLogs = sub.logs ? [...sub.logs] : [];
        let presentDiff = 0;
        let absentDiff = 0;
        let holidayDiff = 0;

        slotsForSub.forEach((slot) => {
          const slotTime = slot.startTime;
          const slotFullDate = `${dateStr}T${slotTime}:00.000Z`;

          const logIndex = updatedLogs.findIndex((log) => {
            const logDatePart = log.date.split('T')[0];
            if (logDatePart !== dateStr) return false;
            return log.date.includes(`T${slotTime}`) || log.date.includes(`${slotTime}:`);
          });

          const oldLog = logIndex !== -1 ? updatedLogs[logIndex] : undefined;
          const oldStatus = oldLog?.status || 'NONE';

          if (status === 'REMOVE') {
            if (logIndex !== -1) {
              updatedLogs.splice(logIndex, 1);
            }
          } else {
            if (logIndex !== -1) {
              updatedLogs[logIndex] = { ...updatedLogs[logIndex], status };
            } else {
              updatedLogs = [
                {
                  id: `temp-${Date.now()}-${sub.id}-${slotTime}`,
                  date: slotFullDate,
                  status,
                },
                ...updatedLogs,
              ];
            }
          }

          if (oldStatus === 'PRESENT') presentDiff--;
          else if (oldStatus === 'ABSENT') absentDiff--;
          else if (oldStatus === 'HOLIDAY') holidayDiff--;

          if (status === 'PRESENT') presentDiff++;
          else if (status === 'ABSENT') absentDiff++;
          else if (status === 'HOLIDAY') holidayDiff++;
        });

        const newPresent = Math.max(0, sub.stats.present + presentDiff);
        const newAbsent = Math.max(0, sub.stats.absent + absentDiff);
        const newHoliday = Math.max(0, sub.stats.holiday + holidayDiff);
        const newTotal = newPresent + newAbsent;
        const newPercentage = newTotal > 0 ? (newPresent / newTotal) * 100 : 100.0;

        return {
          ...sub,
          logs: updatedLogs,
          stats: {
            ...sub.stats,
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10,
          },
        };
      });
    });

    try {
      const logsToProcess = eligibleSlots.map((slot) => ({
        subjectId: slot.subjectId,
        date: `${dateStr}T${slot.startTime}:00.000Z`,
        status,
      }));

      // Filter for REMOVE: only call for subjects that actually have a log on this date
      const finalLogs = status === 'REMOVE'
        ? logsToProcess.filter((item) => {
            const sub = previousSubjects.find((s) => s.id === item.subjectId);
            return sub?.logs?.some((log) => {
              const logDatePart = log.date.split('T')[0];
              if (logDatePart !== dateStr) return false;
              const slotTime = item.date.split('T')[1]?.substring(0, 5);
              return log.date.includes(`T${slotTime}`) || log.date.includes('00:00');
            });
          })
        : logsToProcess;

      if (finalLogs.length === 0) {
        if (status === 'REMOVE') {
          setSuccess('All class attendance cleared successfully!');
        }
        return;
      }

      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: finalLogs }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || (status === 'REMOVE' ? 'Failed to clear all classes.' : 'Failed to mark all classes.'));
      }

      if (status === 'REMOVE') {
        setSuccess('All class attendance cleared successfully!');
      } else {
        setSuccess(`All classes marked as ${status.toLowerCase()} successfully!`);
      }
    } catch (err: any) {
      console.error('Bulk check-in failed:', err);
      setError(err.message || (status === 'REMOVE' ? 'Failed to clear all classes. Rolling back.' : 'Failed to mark all classes. Rolling back.'));
      setSubjects(previousSubjects);
    }
  };

  // Completely clear all logged classes for a date (routine slots and custom classes)
  const handleClearAllLogsForDate = async (dateStr: string) => {
    const subsWithLogs = subjects.filter((s) => (s.logs || []).some((l) => l.date.split('T')[0] === dateStr));
    if (subsWithLogs.length === 0) return;

    const previousSubjects = [...subjects];

    setSubjects((prev) => {
      return prev.map((sub) => {
        const logsOnDate = (sub.logs || []).filter((l) => l.date.split('T')[0] === dateStr);
        if (logsOnDate.length === 0) return sub;

        let presentDiff = 0;
        let absentDiff = 0;
        let holidayDiff = 0;
        logsOnDate.forEach((l) => {
          if (l.status === 'PRESENT') presentDiff--;
          else if (l.status === 'ABSENT') absentDiff--;
          else if (l.status === 'HOLIDAY') holidayDiff--;
        });

        const newPresent = Math.max(0, sub.stats.present + presentDiff);
        const newAbsent = Math.max(0, sub.stats.absent + absentDiff);
        const newHoliday = Math.max(0, sub.stats.holiday + holidayDiff);
        const newTotal = newPresent + newAbsent;
        const newPercentage = newTotal > 0 ? (newPresent / newTotal) * 100 : 100.0;

        return {
          ...sub,
          logs: (sub.logs || []).filter((l) => l.date.split('T')[0] !== dateStr),
          stats: {
            ...sub.stats,
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10,
          },
        };
      });
    });

    try {
      const logsToProcess = subsWithLogs.map((s) => ({
        subjectId: s.id,
        date: `${dateStr}T00:00:00.000Z`,
        status: 'REMOVE' as const,
      }));

      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: logsToProcess }),
      });

      if (!res.ok) {
        throw new Error('Failed to clear logs');
      }
      setSuccess(`All attendance markings for ${dateStr} cleared successfully!`);
    } catch (err: any) {
      setError('Failed to clear logs for this date. Rolling back.');
      setSubjects(previousSubjects);
    }
  };

  const handleMarkAllUnmarked = async (status: 'PRESENT' | 'ABSENT' | 'HOLIDAY') => {
    const missedDates = getMissedLogDates();
    if (missedDates.length === 0) return;

    const missedOps: Array<{ subjectId: string; date: string; startTime: string }> = [];

    missedDates.forEach((dateStr) => {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const dayOfWeek = dayNames[dateObj.getDay()];

      const slots = getEffectiveSlotsForDate(dateStr, dayOfWeek);
      slots.forEach((slot) => {
        if (!slot.subjectId) return;
        const sub = subjects.find((s) => s.id === slot.subjectId);
        if (!sub) return;

        const slotsForThisSub = slots.filter((s) => s.subjectId === slot.subjectId);
        const log = getSlotLog(sub, dateStr, slot.startTime, slotsForThisSub);
        if (!log) {
          missedOps.push({
            subjectId: slot.subjectId,
            date: `${dateStr}T${slot.startTime}:00.000Z`,
            startTime: slot.startTime,
          });
        }
      });
    });

    if (missedOps.length === 0) return;

    const previousSubjects = [...subjects];

    setSubjects((prevSubjects) => {
      return prevSubjects.map((sub) => {
        const opsForSub = missedOps.filter((op) => op.subjectId === sub.id);
        if (opsForSub.length === 0) return sub;

        let updatedLogs = sub.logs ? [...sub.logs] : [];
        let presentDiff = 0;
        let absentDiff = 0;
        let holidayDiff = 0;

        opsForSub.forEach((op) => {
          updatedLogs = [
            {
              id: `temp-${Date.now()}-${sub.id}-${op.startTime}`,
              date: op.date,
              status,
            },
            ...updatedLogs,
          ];

          if (status === 'PRESENT') presentDiff++;
          else if (status === 'ABSENT') absentDiff++;
          else if (status === 'HOLIDAY') holidayDiff++;
        });

        const newPresent = Math.max(0, sub.stats.present + presentDiff);
        const newAbsent = Math.max(0, sub.stats.absent + absentDiff);
        const newHoliday = Math.max(0, sub.stats.holiday + holidayDiff);
        const newTotal = newPresent + newAbsent;
        const newPercentage = newTotal > 0 ? (newPresent / newTotal) * 100 : 100.0;

        return {
          ...sub,
          logs: updatedLogs,
          stats: {
            ...sub.stats,
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10,
          },
        };
      });
    });

    try {
      const logsToProcess = missedOps.map((op) => ({
        subjectId: op.subjectId,
        date: op.date,
        status,
      }));

      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: logsToProcess }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to mark unmarked classes.');
      }

      setSuccess(`All ${missedOps.length} unmarked classes marked as ${status.toLowerCase()} successfully!`);
    } catch (err: any) {
      console.error('Marking unmarked classes failed:', err);
      setError(err.message || 'Failed to mark all unmarked classes. Rolling back.');
      setSubjects(previousSubjects);
    }
  };

  // Bunk Planner math logic
  const getPredictorResult = () => {
    const sub = subjects.find((s) => s.id === selectedSubjectId);
    if (!sub) return { newPercentage: 100, statusText: 'No class' };

    const newPresent = Math.max(0, sub.stats.present + (bunkCount > 0 ? 0 : bunkCount));
    // If bunkCount > 0, they attend classes (increases both present and total)
    // If bunkCount < 0 (skip), total increases but present stays constant
    const newTotal = sub.stats.total + Math.abs(bunkCount);
    
    let finalPresent = sub.stats.present;
    if (bunkCount > 0) {
      finalPresent += bunkCount; // Attending more
    }
    
    const percentage = newTotal > 0 ? Math.round((finalPresent / newTotal) * 1000) / 10 : 100;
    const meetsTarget = percentage >= sub.targetPercentage;

    return {
      newPercentage: percentage,
      meetsTarget,
      statusText: meetsTarget 
        ? `Keeps you above your ${sub.targetPercentage}% goal.` 
        : `Drops you below your ${sub.targetPercentage}% goal.`
    };
  };

  // "Should I Skip Today?" Advisor logic
  const getAdvisorOutput = () => {
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const todayDateStr = getLocalDateString();
    const todaySlots = getEffectiveSlotsForDate(todayDateStr, todayName);
    
    if (todaySlots.length === 0) {
      return {
        status: 'safe' as const,
        title: 'No Classes Today!',
        description: 'You have no lectures or labs scheduled for today. Enjoy your day off!',
      };
    }

    const skippedSubjects: { name: string; futurePercent: number; target: number }[] = [];
    let criticalCount = 0;

    todaySlots.forEach((slot) => {
      const sub = subjects.find((s) => s.id === slot.subjectId);
      if (!sub) return;

      // Calculate future percentage if skipped (absent + 1)
      const nextTotal = sub.stats.total + 1;
      const nextPercent = nextTotal > 0 ? (sub.stats.present / nextTotal) * 100 : 100;

      if (nextPercent < sub.targetPercentage) {
        criticalCount++;
        skippedSubjects.push({
          name: sub.name,
          futurePercent: Math.round(nextPercent * 10) / 10,
          target: sub.targetPercentage,
        });
      }
    });

    if (criticalCount > 0) {
      return {
        status: 'danger' as const,
        title: 'Avoid Bunking Today!',
        description: `Skipping today will drop you below your targets in: ${skippedSubjects.map((s) => `${s.name} (to ${s.futurePercent}%)`).join(', ')}.`,
      };
    }

    return {
      status: 'safe' as const,
      title: 'Safe to Skip Today!',
      description: 'You are well above your target percentages. Skipping today\'s classes will not drop any subject below your target criteria.',
    };
  };

  // Timetable Slot positioning helpers
  const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  const getDynamicTimes = () => {
    if (timetable.length === 0) {
      return ['09:30', '10:30'];
    }
    
    const startTimes = timetable.map(slot => slot.startTime);
    const endTimes = timetable.map(slot => slot.endTime);
    const allTimes = Array.from(new Set([...startTimes])).sort((a, b) => a.localeCompare(b));
    
    const sortedEndTimes = [...endTimes].sort((a, b) => b.localeCompare(a));
    const latestEndTime = sortedEndTimes[0] || '10:30';
    
    if (!allTimes.includes(latestEndTime)) {
      allTimes.push(latestEndTime);
    } else {
      const [h, m] = latestEndTime.split(':').map(Number);
      const nextH = (h + 1) % 24;
      const pad = (num: number) => num.toString().padStart(2, '0');
      const extraTime = `${pad(nextH)}:${pad(m)}`;
      if (!allTimes.includes(extraTime)) {
        allTimes.push(extraTime);
      }
    }
    
    return allTimes.sort((a, b) => a.localeCompare(b));
  };
  const TIMES = getDynamicTimes();
  
  const sortedTimeSlots: string[] = [];

  const getTimetableSlot = (day: string, time: string) => {
    return timetable.find((slot) => {
      if (slot.dayOfWeek.toUpperCase() !== day.toUpperCase()) return false;
      if (sortedTimeSlots.length > 0) {
        return slot.startTime === time;
      }
      const slotHour = parseInt(slot.startTime.split(':')[0]);
      const hour = parseInt(time.split(':')[0]);
      return slotHour === hour;
    });
  };

  // Render Loader
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-main)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '3px solid var(--border-color)',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>AuraAttend is loading your dashboard...</p>
        <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { to { transform: rotate(360deg); } }` }} />
      </div>
    );
  }

  // =========================================================================
  // RENDER TEACHER DASHBOARD VIEW (READ ONLY VIEWPORT)
  // =========================================================================
  if (teacherViewingData) {
    const { studentEmail, studentCode, semesterName, subjects: teacherSubs } = teacherViewingData;
    const overall = getOverallStats(teacherSubs);
    const lectureStats = getTypeStatsFull(teacherSubs, 'LECTURE');
    const labStats = getTypeStatsFull(teacherSubs, 'LAB');
    const lectureAvg = lectureStats.percentage;
    const labAvg = labStats.percentage;

    if (isBatchModeActive) {
      const allSubjectNames = Array.from(
        new Set(
          batchStudents
            .filter((s: any) => s.isUnlocked)
            .flatMap((s: any) => s.subjects.map((sub: any) => sub.name))
        )
      );

      return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-main)' }}>
          <header className={`dashboard-header ${isHeaderExpanded ? 'header-expanded' : 'header-collapsed'}`}>
            <div className="brand-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Calendar className="text-secondary" size={26} />
                <span className="logo-text">AuraAttend Portal</span>
                <span className="subject-badge" style={{ verticalAlign: 'middle', marginLeft: '10px' }}>Teacher Mode (Batch)</span>
              </div>
              <button 
                type="button"
                className="header-toggle" 
                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                aria-label="Toggle Header Actions"
              >
                {isHeaderExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
            <div className="header-actions-wrapper">
              <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  type="button"
                  className="copy-btn" 
                  onClick={toggleTheme} 
                  title="Toggle Dark/Light Mode" 
                  style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '50%', border: '1px solid var(--border-color)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                </button>
                <button className="btn-logout" onClick={() => {
                  setTeacherViewingData(null);
                  setIsBatchModeActive(false);
                  setBatchStudents([]);
                }}>
                  Exit Batch Mirror
                </button>
              </div>
            </div>
          </header>

          <main className="dashboard-container">
            <div className="glass-card">
              <h2 style={{ fontSize: '1.6rem' }}>Batch Student Mirror</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Manage and log attendance for multiple students simultaneously.
              </p>
            </div>

            {success && <div className="toast toast-success">{success}</div>}
            {error && <div className="toast toast-error">{error}</div>}

            <div className="dashboard-main-split">
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ fontSize: '1.25rem' }}>Student Roster</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {batchStudents.map((student: any) => {
                    const currentPin = batchPins[student.studentCode] || '';
                    return (
                      <div key={student.studentCode} className="glass-card" style={{ padding: '1rem', background: student.isUnlocked ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255,255,255,0.02)', borderLeft: student.isUnlocked ? '4px solid var(--success)' : '1px solid var(--border-color)' }}>
                        <div className="flex-between">
                          <div>
                            <span style={{ fontWeight: 700, fontSize: '1.05rem', display: 'block' }}>
                              Code: {student.studentCode}
                            </span>
                            {student.isUnlocked ? (
                              <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>
                                Unlocked: {student.email}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Locked. Enter student PIN to mirror.
                              </span>
                            )}
                          </div>

                          {!student.isUnlocked ? (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <input
                                type="text"
                                maxLength={4}
                                placeholder="PIN"
                                className="form-input"
                                style={{ width: '80px', padding: '0.4rem 0.5rem', fontSize: '0.9rem', textAlign: 'center' }}
                                value={currentPin}
                                onChange={(e) => setBatchPins(prev => ({ ...prev, [student.studentCode]: e.target.value.replace(/\D/g, '') }))}
                              />
                              <button
                                type="button"
                                className="btn-primary"
                                style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.85rem' }}
                                onClick={() => handleUnlockBatchStudent(student.studentCode, currentPin)}
                              >
                                Unlock
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 'bold' }}>Active</span>
                          )}
                        </div>

                        {student.isUnlocked && student.subjects.length > 0 && (
                          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Active Subject Percentages:</span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
                              {student.subjects.map((sub: any) => (
                                <div key={sub.id} style={{ fontSize: '0.75rem', padding: '0.25rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.name}</span>
                                  <span style={{ fontWeight: 'bold', color: sub.stats.percentage >= sub.targetPercentage ? 'var(--success)' : 'var(--danger)' }}>{sub.stats.percentage}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <h3 style={{ fontSize: '1.25rem' }}>Batch Actions</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Mark attendance for all unlocked students simultaneously.
                </p>

                {allSubjectNames.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Unlock at least one student to view available subjects.
                  </p>
                ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">Select Subject</label>
                      <select
                        className="planner-select"
                        value={batchTargetSubjectName}
                        onChange={(e) => setBatchTargetSubjectName(e.target.value)}
                      >
                        <option value="">-- Choose Subject --</option>
                        {allSubjectNames.map((name: any) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Select Attendance Status</label>
                      <select
                        className="planner-select"
                        value={batchTargetStatus}
                        onChange={(e) => setBatchTargetStatus(e.target.value as any)}
                      >
                        <option value="PRESENT">Present</option>
                        <option value="ABSENT">Absent</option>
                        <option value="HOLIDAY">Holiday</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleBatchSubmitAttendance}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Submitting...' : 'Log Attendance for Unlocked Students'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-main)' }}>
        <header className={`dashboard-header ${isHeaderExpanded ? 'header-expanded' : 'header-collapsed'}`}>
          <div className="brand-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Calendar className="text-secondary" size={26} />
              <span className="logo-text">AuraAttend Portal</span>
              <span className="subject-badge" style={{ verticalAlign: 'middle', marginLeft: '10px' }}>Teacher Mode</span>
            </div>
            <button 
              type="button"
              className="header-toggle" 
              onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
              aria-label="Toggle Header Actions"
            >
              {isHeaderExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          <div className="header-actions-wrapper">
            <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="student-info">
                <span className="student-email">Viewing Student: {studentEmail}</span>
                <span className="student-code">Student Code: {studentCode}</span>
              </div>
              <button 
                type="button"
                className="copy-btn" 
                onClick={toggleTheme} 
                title="Toggle Dark/Light Mode" 
                style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '50%', border: '1px solid var(--border-color)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button className="btn-logout" onClick={() => {
                setTeacherViewingData(null);
                setIsTeacherEditingUnlocked(false);
                setEnteredEditPin('');
              }}>
                Exit Viewer
              </button>
            </div>
          </div>
        </header>

        <main className="dashboard-container">
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.6rem' }}>Student Attendance Mirror</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Active Term: {semesterName || '1st Semester'}</p>
            </div>
            <Award className="text-primary" size={32} />
          </div>

          {/* Teacher Daily Check-in Status Panel */}
          <div className="glass-card flex-between" style={{ padding: '1rem 1.5rem', background: 'rgba(16, 185, 129, 0.04)', borderLeft: '4px solid var(--success)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <ShieldCheck size={24} className="text-success" />
              <div>
                <span style={{ fontWeight: 600, fontSize: '1.05rem', display: 'block' }}>
                  Daily Check-In Editing Enabled
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  You can mark Present, Absent, or Holiday for today&apos;s classes on behalf of the student.
                </span>
              </div>
            </div>
          </div>

          {/* Overall Metrics */}
          <div className="widgets-grid">
            <div className="glass-card progress-widget" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="progress-widget-info">
                  <span className="progress-widget-title">Overall Percentage</span>
                  <span className="progress-widget-value">{overall.percentage}%</span>
                  <span className="progress-widget-sub">{overall.present} of {overall.total} classes attended</span>
                </div>
                <div className="circle-progress-wrapper">
                  <svg width="90" height="90">
                    <circle cx="45" cy="45" r="38" className="circle-progress-bg" />
                    <circle
                      cx="45" cy="45" r="38"
                      className="circle-progress-fg"
                      style={{
                        strokeDasharray: 238,
                        strokeDashoffset: 238 - (238 * overall.percentage) / 100,
                        stroke: 'var(--primary)'
                      }}
                    />
                  </svg>
                  <div className="circle-progress-text">{Math.round(overall.percentage)}%</div>
                </div>
              </div>
              <div className="widget-advice-box">
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaA}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(overall.present, overall.total, criteriaA).status}`}>
                    {calculateAdvice(overall.present, overall.total, criteriaA).text}
                  </span>
                </div>
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaB}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(overall.present, overall.total, criteriaB).status}`}>
                    {calculateAdvice(overall.present, overall.total, criteriaB).text}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card linear-widget" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="linear-widget-header">
                  <span className="progress-widget-title">Lecture Attendance</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{lectureAvg}%</span>
                </div>
                <div className="linear-bar-bg">
                  <div
                    className="linear-bar-fg"
                    style={{ width: `${lectureAvg}%`, background: 'linear-gradient(90deg, var(--primary), var(--secondary))' }}
                  />
                </div>
                <span className="progress-widget-sub">{lectureStats.present} of {lectureStats.total} lecture hours attended</span>
              </div>
              <div className="widget-advice-box">
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaA}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(lectureStats.present, lectureStats.total, criteriaA).status}`}>
                    {calculateAdvice(lectureStats.present, lectureStats.total, criteriaA).text}
                  </span>
                </div>
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaB}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(lectureStats.present, lectureStats.total, criteriaB).status}`}>
                    {calculateAdvice(lectureStats.present, lectureStats.total, criteriaB).text}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-card linear-widget" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="linear-widget-header">
                  <span className="progress-widget-title">Lab Attendance</span>
                  <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{labAvg}%</span>
                </div>
                <div className="linear-bar-bg">
                  <div
                    className="linear-bar-fg"
                    style={{ width: `${labAvg}%`, background: 'var(--secondary)' }}
                  />
                </div>
                <span className="progress-widget-sub">{labStats.present} of {labStats.total} lab sessions attended</span>
              </div>
              <div className="widget-advice-box">
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaA}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(labStats.present, labStats.total, criteriaA).status}`}>
                    {calculateAdvice(labStats.present, labStats.total, criteriaA).text}
                  </span>
                </div>
                <div className="widget-advice-item">
                  <span className="widget-advice-label">{criteriaB}% Goal:</span>
                  <span className={`widget-advice-value ${calculateAdvice(labStats.present, labStats.total, criteriaB).status}`}>
                    {calculateAdvice(labStats.present, labStats.total, criteriaB).text}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Subjects Details */}
          <div>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.4rem' }}>Subject Details</h3>
            <div className="subjects-grid">
              {teacherSubs.map((sub) => {
                const todayLog = sub.logs?.find(
                  (log) => log.date.split('T')[0] === getLocalDateString()
                );

                return (
                  <div 
                    key={sub.id} 
                    className="glass-card subject-card"
                    onClick={() => setSelectedSubjectForHistory(sub)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view full attendance history for this subject"
                  >
                    <div className="subject-card-header">
                      <div className="subject-card-title">
                        <span className={`subject-badge ${sub.type.toLowerCase()}`}>{sub.type}</span>
                        <h3>{sub.name}</h3>
                        <div className="subject-goal-indicator">
                          <span className={`goal-status-dot ${
                            sub.stats.percentage >= sub.targetPercentage ? 'status-dot-green' : 'status-dot-red'
                          }`} />
                          <span>Target: {sub.targetPercentage}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="subject-card-stats">
                      <div>
                        <div className="sub-stat-big">{sub.stats.percentage}%</div>
                        <span className="sub-stat-ratio">{sub.stats.present} of {sub.stats.total} logged</span>
                      </div>
                    </div>
                    <div className="criteria-advice-section">
                      <div className="advice-badge-container">
                        <div className={`advice-badge-item ${calculateAdvice(sub.stats.present, sub.stats.total, criteriaA).status}`}>
                          <span className="advice-target">{criteriaA}% Target:</span>
                          <span className="advice-text">{calculateAdvice(sub.stats.present, sub.stats.total, criteriaA).text}</span>
                        </div>
                        <div className={`advice-badge-item ${calculateAdvice(sub.stats.present, sub.stats.total, criteriaB).status}`}>
                          <span className="advice-target">{criteriaB}% Target:</span>
                          <span className="advice-text">{calculateAdvice(sub.stats.present, sub.stats.total, criteriaB).text}</span>
                        </div>
                      </div>
                    </div>

                    {/* Log attendance today for Teacher (enabled only if unlocked) */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <span className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>Log attendance today:</span>
                      <div className="check-in-actions">
                         <button
                          type="button"
                          className={`check-btn check-btn-present ${todayLog?.status === 'PRESENT' ? 'active' : ''}`}
                          disabled={!isTeacherEditingUnlocked || inFlightChecks[sub.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTeacherCheckIn(sub.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT');
                          }}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                          disabled={!isTeacherEditingUnlocked || inFlightChecks[sub.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTeacherCheckIn(sub.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT');
                          }}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                          disabled={!isTeacherEditingUnlocked || inFlightChecks[sub.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTeacherCheckIn(sub.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY');
                          }}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Holiday
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Calendar Heatmap for Teacher */}
                    <div className="calendar-heatmap-wrapper">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Last 30 Days History:</span>
                        <button
                          type="button"
                          className="view-full-history-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSubjectForHistory(sub);
                          }}
                          style={{
                            background: 'rgba(99, 102, 241, 0.12)',
                            border: '1px solid rgba(99, 102, 241, 0.25)',
                            color: 'var(--primary)',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            padding: '0.2rem 0.55rem',
                            borderRadius: '6px',
                            transition: 'var(--transition-smooth)'
                          }}
                          title="View complete attendance history for this subject"
                        >
                          <History size={11} />
                          <span>Full History →</span>
                        </button>
                      </div>
                      <div className="heatmap-grid">
                        {getLast30Days().map((dateStr) => {
                          const log = sub.logs?.find((l) => l.date.split('T')[0] === dateStr);
                          let statusClass = 'empty';
                          let tooltipText = `${dateStr}: No class`;
                          let statusLabel = 'No class';
                          if (log) {
                            statusClass = log.status.toLowerCase();
                            tooltipText = `${dateStr}: ${log.status}`;
                            statusLabel = log.status;
                          }
                          const isSelected = activeHeatmapCell?.subjectId === sub.id && activeHeatmapCell?.dateStr === dateStr;
                          return (
                            <div 
                              key={dateStr} 
                              className={`heatmap-cell ${statusClass} ${isSelected ? 'active-cell' : ''}`} 
                              title={tooltipText}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isSelected) {
                                  setActiveHeatmapCell(null);
                                } else {
                                  setActiveHeatmapCell({
                                    subjectId: sub.id,
                                    dateStr,
                                    formattedDate: formatFriendlyDate(dateStr),
                                    status: statusLabel,
                                    statusClass
                                  });
                                }
                              }}
                            />
                          );
                        })}
                      </div>
                      {activeHeatmapCell?.subjectId === sub.id && (
                        <div
                          className="heatmap-tap-info"
                          style={{
                            marginTop: '0.45rem',
                            padding: '0.4rem 0.65rem',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                            fontSize: '0.78rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                display: 'inline-block',
                                background:
                                  activeHeatmapCell.statusClass === 'present'
                                    ? 'var(--success)'
                                    : activeHeatmapCell.statusClass === 'absent'
                                    ? 'var(--danger)'
                                    : activeHeatmapCell.statusClass === 'holiday'
                                    ? 'var(--warning)'
                                    : 'var(--text-muted)'
                              }}
                            />
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              {activeHeatmapCell.formattedDate}:
                            </span>
                            <span
                              style={{
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                fontSize: '0.75rem',
                                color:
                                  activeHeatmapCell.statusClass === 'present'
                                    ? 'var(--success)'
                                    : activeHeatmapCell.statusClass === 'absent'
                                    ? 'var(--danger)'
                                    : activeHeatmapCell.statusClass === 'holiday'
                                    ? 'var(--warning)'
                                    : 'var(--text-secondary)'
                              }}
                            >
                              {activeHeatmapCell.status}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveHeatmapCell(null);
                            }}
                            aria-label="Close date info"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // =========================================================================
  // RENDER VISUAL AUTH PANEL (LOGIN & REGISTER)
  // =========================================================================
  if (!isLoggedIn) {
    return (
      <div className="auth-wrapper" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', zIndex: 10 }}>
          {/* Design Version Segmented Switcher */}
          <div 
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              background: designVersion === 'neo' ? 'var(--bg-surface)' : 'rgba(255,255,255,0.06)', 
              borderRadius: '12px', 
              padding: '2.5px', 
              border: designVersion === 'neo' ? '2px solid var(--border-color)' : '1px solid rgba(255,255,255,0.12)',
              boxShadow: designVersion === 'neo' ? '2px 2px 0px var(--card-shadow)' : '0 4px 12px rgba(0,0,0,0.2)',
              gap: '3px'
            }}
          >
            <button
              type="button"
              onClick={() => {
                setDesignVersion('neo');
                localStorage.setItem('aura_design_version', 'neo');
                document.documentElement.classList.add('design-neo');
                document.documentElement.classList.remove('design-classic');
              }}
              title="Switch to Neo-Brutalist Pop Sunburst Design"
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '9px',
                fontWeight: 900,
                fontSize: '0.72rem',
                letterSpacing: '0.03em',
                background: designVersion === 'neo' ? '#FFE600' : 'transparent',
                color: designVersion === 'neo' ? '#18181b' : 'var(--text-muted)',
                border: designVersion === 'neo' ? '1.5px solid #18181b' : '1.5px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                transition: 'all 0.15s ease'
              }}
            >
              <span>⚡</span>
              <span className="font-heading">New Design</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDesignVersion('classic');
                localStorage.setItem('aura_design_version', 'classic');
                document.documentElement.classList.add('design-classic');
                document.documentElement.classList.remove('design-neo');
              }}
              title="Switch to Previous Main Branch Classic Glass Design"
              style={{
                padding: '0.35rem 0.65rem',
                borderRadius: '9px',
                fontWeight: 900,
                fontSize: '0.72rem',
                letterSpacing: '0.03em',
                background: designVersion === 'classic' ? (theme === 'dark' ? '#6366f1' : '#4f46e5') : 'transparent',
                color: designVersion === 'classic' ? '#ffffff' : 'var(--text-muted)',
                border: designVersion === 'classic' ? '1.5px solid rgba(255,255,255,0.25)' : '1.5px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                transition: 'all 0.15s ease'
              }}
            >
              <span>💎</span>
              <span>Classic Glass</span>
            </button>
          </div>

          <button 
            type="button"
            onClick={toggleTheme} 
            className="btn-outline" 
            style={{ width: '38px', height: '38px', padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Toggle Dark/Light Theme"
          >
            {theme === 'dark' ? <Sun size={18} className="text-warning" /> : <Moon size={18} className="text-primary" />}
          </button>
        </div>
        <div className="auth-branding">
          <div className="brand-header">
            <Calendar className="text-secondary" size={32} />
            <span className="logo-text">AuraAttend</span>
          </div>
          
          <div className="branding-content">
            <h2>Elevate Your Presence.<br />Master Your Timetable.</h2>
            <p>
              A clean, secure, and visual attendance tracking tool built specifically for college / school students and faculty. Scan timetables instantly with AI and keep stats safe in semester histories.
            </p>
            
            <div className="auth-features">
              <div className="feature-item">
                <ShieldCheck size={20} />
                <span>Password-hashed secure login authentication</span>
              </div>
              <div className="feature-item">
                <TrendingUp size={20} />
                <span>Smart bunk advisor forecasting skipped days</span>
              </div>
              <div className="feature-item">
                <FileText size={20} />
                <span>Upload image/PDF timetables for instant AI parsing</span>
              </div>
            </div>
          </div>

          <div className="brand-footer">
            &copy; 2026 AuraAttend System. Protected with cryptographical hashing.
          </div>
        </div>

        <div className="auth-panel">
          <div className={designVersion === 'classic' ? 'glass-card auth-card' : 'brutal-card auth-card'}>
            <div className="auth-tabs">
              <button
                className={`auth-tab ${authMode === 'STUDENT' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('STUDENT');
                  setError('');
                  setSuccess('');
                }}
              >
                Student Portal
              </button>
              <button
                className={`auth-tab ${authMode === 'TEACHER' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('TEACHER');
                  setError('');
                  setSuccess('');
                }}
              >
                Teacher Portal
              </button>
            </div>

            <h3 className="auth-title">
              {authMode === 'STUDENT'
                ? studentSubMode === 'LOGIN' ? 'Student Sign In' : 'Create Student Account'
                : 'Teacher Attendance Checker'}
            </h3>
            <p className="auth-subtitle">
              {authMode === 'STUDENT'
                ? studentSubMode === 'LOGIN' ? 'Manage your daily dashboard records' : 'Enter email and password to register'
                : 'Input student code and 4-digit PIN to access mirror'}
            </p>

            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: 'var(--danger)',
                padding: '0.75rem',
                borderRadius: 'var(--border-radius-sm)',
                marginBottom: '1rem',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                color: 'var(--success)',
                padding: '0.75rem',
                borderRadius: 'var(--border-radius-sm)',
                marginBottom: '1rem',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Check size={16} />
                <span>{success}</span>
              </div>
            )}

            {/* Student Auth Form */}
            {authMode === 'STUDENT' ? (
              <form onSubmit={handleStudentAuth}>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    className="form-input"
                    type="email"
                    placeholder="name@university.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder={studentSubMode === 'LOGIN' ? "Enter account password" : "Min 6 characters"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                <button className={designVersion === 'classic' ? 'btn-primary' : 'brutal-btn'} type="submit" disabled={isLoading} style={designVersion === 'classic' ? {} : { width: '100%', padding: '0.85rem', background: '#FFE600', color: '#18181B', fontWeight: 900, border: '2px solid #18181B', boxShadow: '4px 4px 0px #18181B', borderRadius: '12px', fontSize: '1rem' }}>
                  {isLoading ? (
                    <div style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  ) : studentSubMode === 'LOGIN' ? (
                    'Log In'
                  ) : (
                    'Create Account'
                  )}
                </button>

                <div className="auth-switch">
                  {studentSubMode === 'LOGIN' ? (
                    <>
                      Don&apos;t have an account?{' '}
                      <button
                        type="button"
                        className="auth-link"
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--secondary)', textDecoration: 'underline' }}
                        onClick={() => {
                          setStudentSubMode('SIGNUP');
                          setError('');
                          setSuccess('');
                        }}
                      >
                        Sign Up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button
                        type="button"
                        className="auth-link"
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--secondary)', textDecoration: 'underline' }}
                        onClick={() => {
                          setStudentSubMode('LOGIN');
                          setError('');
                          setSuccess('');
                        }}
                      >
                        Log In
                      </button>
                    </>
                  )}
                </div>
              </form>
            ) : (
              /* Teacher Auth Form */
              <form onSubmit={handleTeacherAuth}>
                <div className="form-group">
                  <label className="form-label">Student Unique ID Code</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Enter code(s), e.g. XYZ123"
                    maxLength={200}
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    required
                  />
                </div>
                {!studentCode.includes(',') && (
                  <div className="form-group">
                    <label className="form-label">Teacher Edit PIN (4-Digit)</label>
                    <input
                      className="form-input"
                      type="password"
                      placeholder="Enter 4-digit student PIN"
                      maxLength={4}
                      value={enteredEditPin}
                      onChange={(e) => setEnteredEditPin(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </div>
                )}

                <button className={designVersion === 'classic' ? 'btn-primary' : 'brutal-btn'} type="submit" disabled={isLoading} style={designVersion === 'classic' ? {} : { width: '100%', padding: '0.85rem', background: '#FFE600', color: '#18181B', fontWeight: 900, border: '2px solid #18181B', boxShadow: '4px 4px 0px #18181B', borderRadius: '12px', fontSize: '1rem' }}>
                  {isLoading ? (
                    <div style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    'Access Student Mirror'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RENDER ACTIVE STUDENT DASHBOARD (AUTHENTICATED STUDENT VIEWPORT)
  // =========================================================================
  const overall = getOverallStats(subjects);
  const lectureStats = getTypeStatsFull(subjects, 'LECTURE');
  const labStats = getTypeStatsFull(subjects, 'LAB');
  const lectureAvg = lectureStats.percentage;
  const labAvg = labStats.percentage;
  const advisor = getAdvisorOutput();
  const predictor = getPredictorResult();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-main)' }}>
      {/* Header */}
      <header className={`dashboard-header ${isHeaderExpanded ? 'header-expanded' : 'header-collapsed'}`} style={{ borderBottom: designVersion === 'classic' ? '1px solid var(--border-color)' : '3px solid var(--border-color)', background: 'var(--bg-surface)', backdropFilter: designVersion === 'classic' ? 'blur(12px)' : 'none', WebkitBackdropFilter: designVersion === 'classic' ? 'blur(12px)' : 'none', boxShadow: designVersion === 'classic' ? '0 4px 30px rgba(0, 0, 0, 0.2)' : 'none', padding: '0.85rem 1.5rem' }}>
        <div className="brand-header">
          {designVersion === 'classic' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Calendar className="text-secondary" size={26} />
              <div>
                <span className="logo-text" style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)' }}>AuraAttend</span>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>
                  {activeSemesterName || '5th Semester'} • Classic Glass Edition
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="brutal-card" style={{ width: '42px', height: '42px', background: '#FFE600', borderRadius: '12px', border: '2.5px solid var(--border-color)', boxShadow: '3px 3px 0px var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem', fontWeight: 900, color: '#18181b' }}>
                ⚡
              </div>
              <div>
                <h1 className="font-heading" style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  AURA<span style={{ background: '#FFE600', padding: '0.1rem 0.5rem', border: '2px solid #18181b', borderRadius: '8px', fontSize: '1.2rem', color: '#18181b' }}>ATTEND</span>
                </h1>
                <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0.1rem 0 0' }}>
                  Pop-Sunburst Edition • {activeSemesterName || '5th Semester'}
                </p>
              </div>
            </div>
          )}
          <button 
            type="button"
            className="header-toggle" 
            onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
            aria-label="Toggle Header Actions"
            style={{ color: 'var(--text-primary)' }}
          >
            {isHeaderExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
        </div>
        <div className="header-actions-wrapper">
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Deficit Alert Pill (Neo Design Only) */}
            {designVersion === 'neo' && (() => {
              const totalDeficitClasses = subjects.reduce((acc, sub) => {
                const adv = calculateAdvice(sub.stats.present, sub.stats.total, sub.targetPercentage);
                return adv.status === 'danger' ? acc + adv.classCount : acc;
              }, 0);

              return totalDeficitClasses > 0 ? (
                <div className="brutal-card" style={{ background: '#FF6B6B', color: '#ffffff', padding: '0.4rem 0.8rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '2px solid var(--border-color)', boxShadow: '2px 2px 0px var(--border-color)' }}>
                  <span>🚨 DEFICIT ALERT</span>
                  <span className="font-mono-num" style={{ background: '#000000', color: '#ffffff', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {totalDeficitClasses} Classes Behind
                  </span>
                </div>
              ) : (
                <div className="brutal-card" style={{ background: '#10b981', color: '#ffffff', padding: '0.4rem 0.8rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '2px solid var(--border-color)', boxShadow: '2px 2px 0px var(--border-color)' }}>
                  <span>🎯 ON TRACK</span>
                  <span className="font-mono-num" style={{ background: '#000000', color: '#ffffff', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    0 Deficit
                  </span>
                </div>
              );
            })()}

            {viewingHistory ? (
              <button 
                className={designVersion === 'classic' ? 'btn-outline' : 'brutal-btn'} 
                style={designVersion === 'classic' ? {} : { background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '2px solid var(--border-color)', boxShadow: '2px 2px 0px var(--border-color)', padding: '0.45rem 0.85rem', fontSize: '0.8rem' }} 
                onClick={() => setViewingHistory(false)}
              >
                Back to Dashboard
              </button>
            ) : (
              <button 
                className={designVersion === 'classic' ? 'btn-outline' : 'brutal-btn'} 
                style={designVersion === 'classic' ? { display: 'flex', alignItems: 'center', gap: '0.5rem' } : { background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '2px solid var(--border-color)', boxShadow: '2px 2px 0px var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.85rem', fontSize: '0.8rem' }} 
                onClick={() => {
                  setViewingHistory(true);
                  fetchHistoryData();
                }}
              >
                <History size={designVersion === 'classic' ? 16 : 14} />
                <span>{designVersion === 'classic' ? 'History Archives' : 'History'}</span>
              </button>
            )}

            {/* Student Info (Email & Student Code & Teacher PIN) for both Classic and Neo designs */}
            {designVersion === 'classic' ? (
              <div className="student-info">
                <span className="student-email">{currentUser?.email}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
                  <span className="student-code">
                    Student Code: <span style={{ fontWeight: 'bold', color: 'var(--secondary)' }}>{currentUser?.uniqueCode}</span>
                    <button type="button" className="copy-btn" onClick={copyCodeToClipboard} title="Copy Student Code">
                      <Copy size={12} />
                    </button>
                    {copiedCode && <span style={{ color: 'var(--success)', fontSize: '0.7rem' }}>Copied!</span>}
                  </span>
                  <span className="student-code">
                    Teacher Edit PIN: <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{teacherEditPin || '----'}</span>
                    <button type="button" className="copy-btn" title="Rotate PIN" onClick={rotateTeacherEditPin}>
                      <RefreshCw size={12} />
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div
                className="student-info brutal-card"
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '10px',
                  background: 'var(--bg-surface)',
                  border: '2px solid var(--border-color)',
                  boxShadow: '2px 2px 0px var(--card-shadow)',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: '#FFE600',
                    color: '#18181b',
                    border: '1.5px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '0.78rem',
                    flexShrink: 0,
                  }}
                  title={currentUser?.email}
                >
                  {currentUser?.email ? currentUser.email.substring(0, 2).toUpperCase() : 'JD'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.15rem' }}>
                  <span className="student-email font-heading" style={{ fontWeight: 800, fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {currentUser?.email}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                    <span className="student-code" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)' }}>
                      Code: <span className="font-mono-num" style={{ fontWeight: 800, color: theme === 'dark' ? '#FF6B6B' : '#E11D48' }}>{currentUser?.uniqueCode}</span>
                      <button 
                        type="button" 
                        className="copy-btn" 
                        onClick={copyCodeToClipboard} 
                        title="Copy Student Code"
                        style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: theme === 'dark' ? '#FF6B6B' : '#E11D48', display: 'inline-flex', alignItems: 'center', padding: '1px' }}
                      >
                        <Copy size={11} />
                      </button>
                      {copiedCode && <span style={{ color: 'var(--success)', fontSize: '0.68rem', fontWeight: 800 }}>Copied!</span>}
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>•</span>
                    <span className="student-code" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)' }}>
                      PIN: <span className="font-mono-num" style={{ fontWeight: 800, color: theme === 'dark' ? '#FFE600' : '#D97706' }}>{teacherEditPin || '----'}</span>
                      <button 
                        type="button" 
                        className="copy-btn" 
                        title="Rotate PIN" 
                        onClick={rotateTeacherEditPin}
                        style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: theme === 'dark' ? '#FFE600' : '#D97706', display: 'inline-flex', alignItems: 'center', padding: '1px' }}
                      >
                        <RefreshCw size={11} />
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            )}

            <button 
              type="button"
              className={designVersion === 'classic' ? 'copy-btn' : 'brutal-btn'} 
              onClick={toggleTheme} 
              title="Switch Theme (Light / Dark)" 
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: designVersion === 'classic' ? '1px solid var(--border-color)' : '2px solid var(--border-color)',
                boxShadow: designVersion === 'classic' ? 'none' : '3px 3px 0px var(--card-shadow)',
                borderRadius: '12px',
                padding: '0.35rem 0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer'
              }}
            >
              <div style={{ width: '38px', height: '22px', background: theme === 'dark' ? '#27272a' : '#e4e4e7', border: '1.5px solid var(--border-color)', borderRadius: '9999px', padding: '1.5px', display: 'flex', alignItems: 'center', position: 'relative' }}>
                <div style={{ width: '15px', height: '15px', background: designVersion === 'classic' ? 'var(--primary)' : '#FFE600', border: '1.5px solid #18181b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', transform: theme === 'dark' ? 'translateX(17px)' : 'translateX(0px)', transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                  {theme === 'dark' ? '🌙' : '☀️'}
                </div>
              </div>
              <span className={designVersion === 'classic' ? '' : 'font-heading'} style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme === 'dark' ? (designVersion === 'classic' ? 'var(--primary)' : '#FFE600') : 'var(--text-primary)' }}>
                {theme === 'dark' ? 'Dark' : 'Light'}
              </span>
            </button>

            {/* Design Version Switcher (Segmented Neo vs Classic Glass) */}
            <div 
              style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                background: designVersion === 'neo' ? 'var(--bg-surface)' : 'rgba(255,255,255,0.06)', 
                borderRadius: '12px', 
                padding: '2.5px', 
                border: designVersion === 'neo' ? '2px solid var(--border-color)' : '1px solid rgba(255,255,255,0.12)',
                boxShadow: designVersion === 'neo' ? '2px 2px 0px var(--card-shadow)' : '0 4px 12px rgba(0,0,0,0.2)',
                gap: '3px'
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setDesignVersion('neo');
                  localStorage.setItem('aura_design_version', 'neo');
                  document.documentElement.classList.add('design-neo');
                  document.documentElement.classList.remove('design-classic');
                }}
                title="Switch to Neo-Brutalist Pop Sunburst Design"
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '9px',
                  fontWeight: 900,
                  fontSize: '0.72rem',
                  letterSpacing: '0.03em',
                  background: designVersion === 'neo' ? '#FFE600' : 'transparent',
                  color: designVersion === 'neo' ? '#18181b' : 'var(--text-muted)',
                  border: designVersion === 'neo' ? '1.5px solid #18181b' : '1.5px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>⚡</span>
                <span className="font-heading">New Design</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDesignVersion('classic');
                  localStorage.setItem('aura_design_version', 'classic');
                  document.documentElement.classList.add('design-classic');
                  document.documentElement.classList.remove('design-neo');
                }}
                title="Switch to Previous Main Branch Classic Glass Design"
                style={{
                  padding: '0.35rem 0.65rem',
                  borderRadius: '9px',
                  fontWeight: 900,
                  fontSize: '0.72rem',
                  letterSpacing: '0.03em',
                  background: designVersion === 'classic' ? (theme === 'dark' ? '#6366f1' : '#4f46e5') : 'transparent',
                  color: designVersion === 'classic' ? '#ffffff' : 'var(--text-muted)',
                  border: designVersion === 'classic' ? '1.5px solid rgba(255,255,255,0.25)' : '1.5px solid transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>💎</span>
                <span>Classic Glass</span>
              </button>
            </div>

            {/* Classroom Offline Mode Indicator */}
            {isBrowserOffline && (
              <div 
                className="brutal-card" 
                style={{ 
                  background: '#F59E0B', 
                  color: '#000000', 
                  padding: '0.35rem 0.65rem', 
                  borderRadius: '10px', 
                  fontSize: '0.72rem', 
                  fontWeight: 900, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.35rem', 
                  border: '2px solid #000000',
                  boxShadow: '2px 2px 0px #000000'
                }}
                title="Classroom Offline Mode active - marks are saved locally and will auto-sync"
              >
                <WifiOff size={13} />
                <span>OFFLINE {isOfflineSyncPending ? '(QUEUED)' : ''}</span>
              </div>
            )}
            {!isBrowserOffline && isOfflineSyncPending && (
              <div 
                className="brutal-card" 
                style={{ 
                  background: '#10B981', 
                  color: '#ffffff', 
                  padding: '0.35rem 0.65rem', 
                  borderRadius: '10px', 
                  fontSize: '0.72rem', 
                  fontWeight: 900, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.35rem', 
                  border: '2px solid var(--border-color)',
                  boxShadow: '2px 2px 0px var(--card-shadow)'
                }}
                title="Syncing pending offline attendance logs to cloud"
              >
                <RefreshCw size={13} className="animate-spin" />
                <span>SYNCING...</span>
              </div>
            )}

            <button 
              className={designVersion === 'classic' ? 'btn-logout' : 'brutal-btn'} 
              style={designVersion === 'classic' ? { display: 'inline-flex', alignItems: 'center', gap: '0.4rem' } : { background: '#FF6B6B', color: '#fff', border: '2px solid var(--border-color)', boxShadow: '2px 2px 0px var(--border-color)', padding: '0.45rem 0.85rem', fontSize: '0.8rem' }} 
              onClick={handleLogout}
            >
              <LogOut size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
              Log Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="dashboard-container">
        {/* Render History Page */}
        {viewingHistory ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="history-header">
              <div>
                <h2 style={{ fontSize: '2rem' }}>Semester History Archives</h2>
                <p style={{ color: 'var(--text-secondary)' }}>View and audit archived snapshots and past semester logs</p>
              </div>
              <button className="btn-logout" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', color: 'var(--primary)' }} onClick={handleSemesterReset}>
                Archive & Reset Active Semester
              </button>
            </div>

            <div className="history-grid">
              {/* Dynamic Inactive Semesters */}
              {inactiveSemesters.map((sem) => (
                <div key={sem.id} className="glass-card history-card">
                  <div className="history-card-header">
                    <div>
                      <h4 style={{ fontSize: '1.2rem' }}>{sem.name}</h4>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Archived: {new Date(sem.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <BookOpen size={24} className="text-secondary" />
                  </div>
                  <div className="history-card-body">
                    <div className="history-stat-row">
                      <span>Overall Percentage:</span>
                      <span className="history-stat-val text-success">{sem.stats.overallPercentage}%</span>
                    </div>
                    <div className="history-stat-row">
                      <span>Lecture Percentage:</span>
                      <span>{sem.stats.lecturePercentage}%</span>
                    </div>
                    <div className="history-stat-row">
                      <span>Lab Percentage:</span>
                      <span>{sem.stats.labPercentage}%</span>
                    </div>
                    <div className="history-stat-row">
                      <span>Total Classes:</span>
                      <span>{sem.stats.totalClasses} classes</span>
                    </div>
                    
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ 
                        marginTop: '0.75rem', 
                        padding: '0.5rem 0.75rem', 
                        fontSize: '0.8rem', 
                        width: '100%', 
                        background: 'rgba(99, 102, 241, 0.08)', 
                        color: 'var(--primary)', 
                        border: '1px solid rgba(99, 102, 241, 0.2)',
                        borderRadius: 'var(--border-radius-sm)',
                        cursor: 'pointer',
                        transition: 'var(--transition-smooth)'
                      }}
                      onClick={() => handleRestoreSemester(sem.id)}
                    >
                      Restore Semester
                    </button>
                  </div>
                </div>
              ))}

              {/* Reset snapshots */}
              {archivedSummaries.map((snap) => (
                <div key={snap.id} className="glass-card history-card" style={{ borderColor: 'rgba(6, 182, 212, 0.2)' }}>
                  <div className="history-card-header">
                    <div>
                      <h4 style={{ fontSize: '1.2rem' }}>{snap.semesterName}</h4>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Wiped: {new Date(snap.archivedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <RefreshCw size={24} className="text-secondary" />
                  </div>
                  <div className="history-card-body">
                    <div className="history-stat-row">
                      <span>Overall Percentage:</span>
                      <span className="history-stat-val text-success">{snap.overallPercentage}%</span>
                    </div>
                    <div className="history-stat-row">
                      <span>Lecture Percentage:</span>
                      <span>{snap.lecturePercentage}%</span>
                    </div>
                    <div className="history-stat-row">
                      <span>Lab Percentage:</span>
                      <span>{snap.labPercentage}%</span>
                    </div>
                  </div>
                </div>
              ))}

              {inactiveSemesters.length === 0 && archivedSummaries.length === 0 && (
                <div className="glass-card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem' }}>
                  <History size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                  <h4>No History Found</h4>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>You have not archived or reset any semesters yet.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Render Active Dashboard */
          <>
            {/* Semester selector banner */}
            <div className="glass-card flex-between" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <BookOpen size={20} className="text-primary" />
                {isEditingSemesterName ? (
                  <form onSubmit={handleRenameSemester} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={tempSemesterName}
                      onChange={(e) => setTempSemesterName(e.target.value)}
                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.95rem', width: '180px' }}
                      required
                    />
                    <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>Save</button>
                    <button type="button" className="btn-outline" onClick={() => setIsEditingSemesterName(false)} style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>Cancel</button>
                  </form>
                ) : (
                  <span style={{ fontWeight: 600, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    Active Term: {activeSemesterName || 'No active semester'}
                    <button 
                      className="copy-btn" 
                      title="Rename Semester" 
                      onClick={() => {
                        const activeSem = semesters.find(s => s.isActive);
                        if (activeSem) {
                          setTempSemesterName(activeSemesterName);
                          setIsEditingSemesterName(true);
                        }
                      }}
                      style={{ padding: '0.2rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Edit size={14} style={{ color: 'var(--text-secondary)' }} />
                    </button>
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button 
                  className="btn-outline" 
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} 
                  onClick={handleExportPDF}
                  title="Export all active semester logs to PDF Report"
                >
                  <FileText size={14} />
                  <span>Export PDF Report</span>
                </button>
                <button className="btn-outline" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setShowAddSemester(true)}>
                  New Semester
                </button>
              </div>
            </div>

            {/* Navigation Tabs Bar */}
            <div className={`${designVersion === 'classic' ? 'glass-card' : 'brutal-card'} nav-tabs-bar`} style={{ display: 'flex', gap: '0.45rem', padding: '0.5rem', marginBottom: '1.5rem', borderRadius: '16px', background: 'var(--bg-surface)', border: designVersion === 'classic' ? '1px solid var(--border-color)' : '3px solid var(--border-color)', boxShadow: designVersion === 'classic' ? 'var(--shadow-main)' : 'var(--card-shadow)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'dashboard' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('dashboard')}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'dashboard' ? (designVersion === 'classic' ? 'rgba(99, 102, 241, 0.25)' : '#FFE600') : 'transparent',
                  color: activeTab === 'dashboard' ? (designVersion === 'classic' ? 'var(--text-primary)' : '#18181b') : 'var(--text-secondary)',
                  border: activeTab === 'dashboard' ? (designVersion === 'classic' ? '1px solid var(--border-color-glow)' : '2px solid var(--border-color)') : '1px solid transparent',
                  boxShadow: activeTab === 'dashboard' ? (designVersion === 'classic' ? '0 0 15px rgba(99, 102, 241, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <BookOpen size={16} />
                <span>Dashboard</span>
              </button>
              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'timetable' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('timetable')}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'timetable' ? (designVersion === 'classic' ? 'rgba(99, 102, 241, 0.25)' : '#FFE600') : 'transparent',
                  color: activeTab === 'timetable' ? (designVersion === 'classic' ? 'var(--text-primary)' : '#18181b') : 'var(--text-secondary)',
                  border: activeTab === 'timetable' ? (designVersion === 'classic' ? '1px solid var(--border-color-glow)' : '2px solid var(--border-color)') : '1px solid transparent',
                  boxShadow: activeTab === 'timetable' ? (designVersion === 'classic' ? '0 0 15px rgba(99, 102, 241, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Calendar size={16} />
                <span>Weekly Schedule</span>
              </button>
              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'analytics' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('analytics')}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'analytics' ? (designVersion === 'classic' ? 'rgba(99, 102, 241, 0.25)' : '#FFE600') : 'transparent',
                  color: activeTab === 'analytics' ? (designVersion === 'classic' ? 'var(--text-primary)' : '#18181b') : 'var(--text-secondary)',
                  border: activeTab === 'analytics' ? (designVersion === 'classic' ? '1px solid var(--border-color-glow)' : '2px solid var(--border-color)') : '1px solid transparent',
                  boxShadow: activeTab === 'analytics' ? (designVersion === 'classic' ? '0 0 15px rgba(99, 102, 241, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <TrendingUp size={16} />
                <span>Analytics & Predictors</span>
              </button>
              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'calendar' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('calendar')}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'calendar' ? (designVersion === 'classic' ? 'rgba(99, 102, 241, 0.25)' : '#FFE600') : 'transparent',
                  color: activeTab === 'calendar' ? (designVersion === 'classic' ? 'var(--text-primary)' : '#18181b') : 'var(--text-secondary)',
                  border: activeTab === 'calendar' ? (designVersion === 'classic' ? '1px solid var(--border-color-glow)' : '2px solid var(--border-color)') : '1px solid transparent',
                  boxShadow: activeTab === 'calendar' ? (designVersion === 'classic' ? '0 0 15px rgba(99, 102, 241, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Clock size={16} />
                <span>Calendar Logger</span>
              </button>
              
              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'radar' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('radar')}
                title="Live Classroom Consensus Radar ('Sir / Mam aa gaye kya?')"
                style={{
                  flex: 1,
                  minWidth: '150px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'radar' ? (designVersion === 'classic' ? 'rgba(239, 68, 68, 0.25)' : '#FFE600') : (designVersion === 'classic' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.1)'),
                  color: activeTab === 'radar' ? (designVersion === 'classic' ? '#fca5a5' : '#18181b') : '#f87171',
                  border: activeTab === 'radar' ? (designVersion === 'classic' ? '1px solid rgba(239, 68, 68, 0.5)' : '2px solid var(--border-color)') : '1px solid rgba(239, 68, 68, 0.3)',
                  boxShadow: activeTab === 'radar' ? (designVersion === 'classic' ? '0 0 15px rgba(239, 68, 68, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Radio size={15} className="animate-pulse" />
                <span>Live Class Radar</span>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              </button>

              <button
                type="button"
                className={designVersion === 'classic' ? `tab-btn ${activeTab === 'faculty' ? 'active' : ''}` : 'brutal-btn'}
                onClick={() => handleTabSwitch('faculty')}
                style={{
                  flex: 1,
                  minWidth: '130px',
                  padding: '0.65rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: designVersion === 'classic' ? 700 : 800,
                  borderRadius: '10px',
                  background: activeTab === 'faculty' ? (designVersion === 'classic' ? 'rgba(99, 102, 241, 0.25)' : '#FFE600') : 'transparent',
                  color: activeTab === 'faculty' ? (designVersion === 'classic' ? 'var(--text-primary)' : '#18181b') : 'var(--text-secondary)',
                  border: activeTab === 'faculty' ? (designVersion === 'classic' ? '1px solid var(--border-color-glow)' : '2px solid var(--border-color)') : '1px solid transparent',
                  boxShadow: activeTab === 'faculty' ? (designVersion === 'classic' ? '0 0 15px rgba(99, 102, 241, 0.2)' : '2px 2px 0px var(--border-color)') : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Award size={16} />
                <span>Faculty Reviews</span>
              </button>
            </div>

            {/* Beautiful Toast Error/Success Banners for active student view */}
            {error && (
              <div className="toast toast-error" style={{ marginBottom: '1.5rem' }}>
                <AlertCircle className="toast-icon" size={18} />
                <div>
                  <strong>Error:</strong> {error}
                </div>
              </div>
            )}
            {success && (
              <div className="toast toast-success" style={{ marginBottom: '1.5rem' }}>
                <Check className="toast-icon" size={18} />
                <div>
                  <strong>Operation Successful:</strong> {success}
                </div>
              </div>
            )}

            {/* TAB CONTENT 1: DASHBOARD */}
            {activeTab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Routine Update Banner for CSE 3 */}
                {isLoggedIn && isUserEligibleForRoutineNotice(currentUser) && routineNoticeStatus !== 'applied_cse3' && routineNoticeStatus !== 'dismissed_other_branch' && (
                  <div 
                    className="glass-card" 
                    style={{ 
                      margin: 0, 
                      border: '1px solid rgba(99, 102, 241, 0.45)', 
                      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.14), rgba(168, 85, 247, 0.14))',
                      boxShadow: '0 10px 30px rgba(99, 102, 241, 0.15)',
                      padding: '1.15rem 1.4rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      borderRadius: 'var(--border-radius-lg)',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: 1, minWidth: '240px' }}>
                      <div style={{
                        width: '38px',
                        height: '38px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        flexShrink: 0
                      }}>
                        <Bell size={20} />
                      </div>
                      <div>
                        <h4 style={{ fontSize: '0.98rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                          CSE 3 Routine Changed (Effective Monday, Sep 14)
                        </h4>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0', lineHeight: 1.4 }}>
                          New routine starts this Monday, Sep 14. Past attendance accurately keeps your previous schedule. Are you in CSE 3? Apply now in 1 click.
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={handleDismissNoticeOtherBranch}
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.78rem', width: 'auto' }}
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setShowRoutineNotice(true)}
                        style={{
                          padding: '0.45rem 1.2rem',
                          fontSize: '0.8rem',
                          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                          boxShadow: '0 4px 15px rgba(99, 102, 241, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          fontWeight: 600,
                          width: 'auto'
                        }}
                      >
                        <Sparkles size={14} />
                        View &amp; Apply Routine
                      </button>
                    </div>
                  </div>
                )}

                {/* Missing Attendance Warning Alert */}
                {(() => {
                  const missedDates = getMissedLogDates();
                  if (missedDates.length === 0) return null;

                  return (
                    <div 
                      className={designVersion === 'classic' ? 'glass-card' : 'brutal-card'} 
                      style={{ 
                        margin: 0, 
                        border: designVersion === 'classic' ? '1px solid rgba(244, 63, 94, 0.25)' : '2px solid var(--border-color)', 
                        background: designVersion === 'classic' ? 'rgba(244, 63, 94, 0.08)' : 'var(--bg-surface)',
                        boxShadow: designVersion === 'classic' ? '0 10px 30px rgba(244, 63, 94, 0.05)' : '4px 4px 0px var(--card-shadow)',
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        borderRadius: designVersion === 'classic' ? 'var(--border-radius-lg)' : '16px',
                        transition: 'var(--transition-smooth)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--secondary)' }}>
                        <AlertCircle size={20} style={{ flexShrink: 0 }} />
                        <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                          Unmarked Attendance Detected
                        </h4>
                      </div>
                      <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.45' }}>
                        You missed logging attendance for scheduled classes on the following dates. Select a date to mark it in the Calendar Logger:
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                        {missedDates.map((dateStr) => {
                          const [y, m, d] = dateStr.split('-').map(Number);
                          const dateObj = new Date(y, m - 1, d);
                          const formattedDate = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
                          return (
                            <button
                              key={dateStr}
                              onClick={() => {
                                setSelectedDate(dateStr);
                                setCurrentCalendarMonth(new Date(y, m - 1, 1));
                                setActiveTab('calendar');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className={designVersion === 'classic' ? 'missed-date-btn' : 'missed-date-btn brutal-btn'}
                              style={designVersion === 'classic' ? {
                                padding: '0.4rem 0.8rem',
                                background: 'rgba(20, 26, 42, 0.75)',
                                border: '1px solid rgba(244, 63, 94, 0.25)',
                                borderRadius: '20px',
                                color: 'var(--text-primary)',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'var(--transition-smooth)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              } : {
                                padding: '0.4rem 0.8rem',
                                background: 'var(--bg-surface)',
                                border: '2px solid var(--border-color)',
                                boxShadow: '2px 2px 0px var(--card-shadow)',
                                borderRadius: '8px',
                                color: 'var(--text-primary)',
                                fontSize: '0.8rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                              onMouseEnter={(e) => {
                                if (designVersion === 'classic') {
                                  e.currentTarget.style.borderColor = 'var(--secondary)';
                                  e.currentTarget.style.background = 'rgba(244, 63, 94, 0.15)';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (designVersion === 'classic') {
                                  e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.25)';
                                  e.currentTarget.style.background = 'rgba(20, 26, 42, 0.75)';
                                }
                              }}
                            >
                              <Calendar size={12} style={{ color: 'var(--secondary)' }} />
                              <span>{formattedDate}</span>
                            </button>
                          );
                        })}
                      </div>
                      
                      <div style={{ marginTop: '0.25rem', borderTop: '1px dashed rgba(244, 63, 94, 0.2)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                          Or bulk mark all unmarked classes as:
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Are you sure you want to mark all unmarked classes as PRESENT?')) {
                                handleMarkAllUnmarked('PRESENT');
                              }
                            }}
                            className="check-btn check-btn-present"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: '1px solid rgba(16, 185, 129, 0.3)', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}
                          >
                            ✓ Present
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Are you sure you want to mark all unmarked classes as ABSENT?')) {
                                handleMarkAllUnmarked('ABSENT');
                              }
                            }}
                            className="check-btn check-btn-absent"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--secondary)' }}
                          >
                            ✗ Absent
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Are you sure you want to mark all unmarked classes as HOLIDAY?')) {
                                handleMarkAllUnmarked('HOLIDAY');
                              }
                            }}
                            className="check-btn check-btn-holiday"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }}
                          >
                            📅 Holiday
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                
                {/* Hero Metrics Banner: Classic Glass (Main Branch) vs Neo-Brutalist (Theme Adaptive) */}
                {designVersion === 'classic' ? (
                  <div className="widgets-grid" style={{ marginBottom: 0 }}>
                    {/* Widget 1: Overall combined with circular SVG progress */}
                    <div className="glass-card progress-widget" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="progress-widget-info">
                          <span className="progress-widget-title">Overall Attendance</span>
                          <span className="progress-widget-value">{overall.percentage}%</span>
                          <span className="progress-widget-sub">{overall.present} of {overall.total} classes attended</span>
                        </div>
                        <div className="circle-progress-wrapper">
                          <svg width="90" height="90">
                            <circle cx="45" cy="45" r="38" className="circle-progress-bg" />
                            <circle
                              cx="45" cy="45" r="38"
                              className="circle-progress-fg"
                              style={{
                                strokeDasharray: 238,
                                strokeDashoffset: 238 - (238 * overall.percentage) / 100,
                                stroke: 'var(--primary)'
                              }}
                            />
                          </svg>
                          <div className="circle-progress-text">{Math.round(overall.percentage)}%</div>
                        </div>
                      </div>
                      <div className="widget-advice-box">
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaA}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(overall.present, overall.total, criteriaA).status}`}>
                            {calculateAdvice(overall.present, overall.total, criteriaA).text}
                          </span>
                        </div>
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaB}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(overall.present, overall.total, criteriaB).status}`}>
                            {calculateAdvice(overall.present, overall.total, criteriaB).text}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Widget 2: Lecture averages */}
                    <div className="glass-card linear-widget" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <div className="linear-widget-header">
                          <span className="progress-widget-title">Lecture Aggregate</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{lectureAvg}%</span>
                        </div>
                        <div className="linear-bar-bg">
                          <div
                            className="linear-bar-fg"
                            style={{ width: `${lectureAvg}%`, background: 'linear-gradient(90deg, var(--primary), var(--secondary))' }}
                          />
                        </div>
                        <span className="progress-widget-sub">{lectureStats.present} of {lectureStats.total} lecture hours attended</span>
                      </div>
                      <div className="widget-advice-box">
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaA}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(lectureStats.present, lectureStats.total, criteriaA).status}`}>
                            {calculateAdvice(lectureStats.present, lectureStats.total, criteriaA).text}
                          </span>
                        </div>
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaB}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(lectureStats.present, lectureStats.total, criteriaB).status}`}>
                            {calculateAdvice(lectureStats.present, lectureStats.total, criteriaB).text}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Widget 3: Lab averages */}
                    <div className="glass-card linear-widget" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <div className="linear-widget-header">
                          <span className="progress-widget-title">Lab Aggregate</span>
                          <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{labAvg}%</span>
                        </div>
                        <div className="linear-bar-bg">
                          <div
                            className="linear-bar-fg"
                            style={{ width: `${labAvg}%`, background: 'var(--secondary)' }}
                          />
                        </div>
                        <span className="progress-widget-sub">{labStats.present} of {labStats.total} lab sessions attended</span>
                      </div>
                      <div className="widget-advice-box">
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaA}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(labStats.present, labStats.total, criteriaA).status}`}>
                            {calculateAdvice(labStats.present, labStats.total, criteriaA).text}
                          </span>
                        </div>
                        <div className="widget-advice-item">
                          <span className="widget-advice-label">{criteriaB}% Goal:</span>
                          <span className={`widget-advice-value ${calculateAdvice(labStats.present, labStats.total, criteriaB).status}`}>
                            {calculateAdvice(labStats.present, labStats.total, criteriaB).text}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Hero Metrics Banner: Neo-Brutalist Color Blocks (Theme Adaptive) */
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: 0 }}>
                    {/* Overall / Gross Standing */}
                    <div className="brutal-card hero-card-gross" style={{ borderRadius: '18px', padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', background: '#000000', color: '#ffffff', padding: '0.25rem 0.65rem', borderRadius: '6px' }}>
                        Gross Standing
                      </span>
                      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div>
                          <div className="font-mono-num hero-card-num" style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>
                            {overall.percentage}%
                          </div>
                          <p className="hero-card-sub" style={{ fontSize: '0.86rem', fontWeight: 700, marginTop: '0.35rem' }}>
                            {overall.present} of {overall.total} Mandatory Logged
                          </p>
                        </div>
                        <div style={{ fontSize: '2.5rem', opacity: 0.85 }}>🎯</div>
                      </div>
                      <div style={{ marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '2px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem', fontWeight: 800 }}>
                        <span className="hero-chip" style={{ padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          Target {criteriaA}%: {calculateAdvice(overall.present, overall.total, criteriaA).text}
                        </span>
                        <span style={{ background: '#FF6B6B', color: '#ffffff', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                          Min {criteriaB}%: {calculateAdvice(overall.present, overall.total, criteriaB).text}
                        </span>
                      </div>
                    </div>

                    {/* Lecture Theory */}
                    <div className="brutal-card hero-card-theory" style={{ borderRadius: '18px', padding: '1.5rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', background: '#000000', color: '#ffffff', padding: '0.25rem 0.65rem', borderRadius: '6px' }}>
                        Lecture Theory
                      </span>
                      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div>
                          <div className="font-mono-num hero-card-num" style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>
                            {lectureAvg}%
                          </div>
                          <p className="hero-card-sub" style={{ fontSize: '0.86rem', fontWeight: 700, marginTop: '0.35rem' }}>
                            {lectureStats.present} / {lectureStats.total} Theory Hours
                          </p>
                        </div>
                        <div style={{ fontSize: '2.5rem' }}>📚</div>
                      </div>
                      <div style={{ marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '2px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem', fontWeight: 800 }}>
                        <span className="hero-chip" style={{ padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          {calculateAdvice(lectureStats.present, lectureStats.total, criteriaA).text}
                        </span>
                        <span className="font-mono-num" style={{ background: '#000000', color: lectureStats.percentage < criteriaA ? '#fde047' : '#86efac', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          {lectureStats.percentage < criteriaA 
                            ? `Deficit -${Math.round(criteriaA - lectureStats.percentage)}%` 
                            : `Buffer +${Math.round(lectureStats.percentage - criteriaA)}%`}
                        </span>
                      </div>
                    </div>

                    {/* Practical Labs */}
                    <div className="brutal-card hero-card-lab" style={{ borderRadius: '18px', padding: '1.5rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 900, textTransform: 'uppercase', background: '#000000', color: '#ffffff', padding: '0.25rem 0.65rem', borderRadius: '6px' }}>
                        Practical Labs
                      </span>
                      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <div>
                          <div className="font-mono-num hero-card-num" style={{ fontSize: '3rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>
                            {labAvg}%
                          </div>
                          <p className="hero-card-sub" style={{ fontSize: '0.86rem', fontWeight: 700, marginTop: '0.35rem' }}>
                            {labStats.present} / {labStats.total} Practicals Attended
                          </p>
                        </div>
                        <div style={{ fontSize: '2.5rem' }}>🧪</div>
                      </div>
                      <div style={{ marginTop: '1.25rem', paddingTop: '0.85rem', borderTop: '2px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.72rem', fontWeight: 800 }}>
                        <span className="hero-chip" style={{ padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          {labAvg >= criteriaA 
                            ? `Safe Margin: Skip ${calculateAdvice(labStats.present, labStats.total, criteriaA).classCount} Allowed` 
                            : `Need ${calculateAdvice(labStats.present, labStats.total, criteriaA).classCount} Practicals`}
                        </span>
                        <span style={{ background: '#ffffff', color: labAvg >= criteriaA ? '#047857' : '#b91c1c', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                          {labAvg >= criteriaA ? 'Zero Risk' : 'Action Required'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Today's Checklist Widget */}
                {(() => {
                  const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
                  const todayDateStr = getLocalDateString();
                  const todaySlots = getEffectiveSlotsForDate(todayDateStr, todayDayName)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  
                  if (todaySlots.length === 0) return null;

                  // Group slots by subjectId
                  const groupedTodaySlots: Record<string, ScheduleSlot[]> = {};
                  for (const slot of todaySlots) {
                    if (!slot.subjectId) continue;
                    if (!groupedTodaySlots[slot.subjectId]) {
                      groupedTodaySlots[slot.subjectId] = [];
                    }
                    groupedTodaySlots[slot.subjectId].push(slot);
                  }

                  return (
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                        <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                          <Calendar size={20} className="text-secondary" />
                          <span>Today&apos;s Class Checklist ({new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })})</span>
                        </h3>
                        
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => handleBulkCheckIn('PRESENT', todayDateStr, todaySlots)}
                            style={{
                              padding: '0.35rem 0.7rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(16, 185, 129, 0.1)',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              borderRadius: '20px',
                              color: 'var(--success)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--success)';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                              e.currentTarget.style.color = 'var(--success)';
                            }}
                          >
                            ✓ All Present
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkCheckIn('ABSENT', todayDateStr, todaySlots)}
                            style={{
                              padding: '0.35rem 0.7rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(244, 63, 94, 0.1)',
                              border: '1px solid rgba(244, 63, 94, 0.3)',
                              borderRadius: '20px',
                              color: 'var(--secondary)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--secondary)';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)';
                              e.currentTarget.style.color = 'var(--secondary)';
                            }}
                          >
                            ✗ All Absent
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkCheckIn('HOLIDAY', todayDateStr, todaySlots)}
                            style={{
                              padding: '0.35rem 0.7rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(245, 158, 11, 0.1)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              borderRadius: '20px',
                              color: 'var(--warning)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--warning)';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                              e.currentTarget.style.color = 'var(--warning)';
                            }}
                          >
                            📅 All Holiday
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm('Are you sure you want to clear all attendance markings for today?')) {
                                handleBulkCheckIn('REMOVE', todayDateStr, todaySlots);
                              }
                            }}
                            style={{
                              padding: '0.35rem 0.7rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: 'rgba(148, 163, 184, 0.1)',
                              border: '1px solid rgba(148, 163, 184, 0.3)',
                              borderRadius: '20px',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--text-muted)';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                              e.currentTarget.style.color = 'var(--text-muted)';
                            }}
                          >
                            🧹 Clear All
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                        {todaySlots.map((slot, index) => {
                          const matchingSubject = subjects.find((s) => s.id === slot.subjectId);
                          if (!matchingSubject) return null;

                          const slotsForThisSubject = todaySlots.filter((s) => s.subjectId === slot.subjectId);
                          const todayLog = getSlotLog(matchingSubject, todayDateStr, slot.startTime, slotsForThisSubject);
                          const slotKey = `${matchingSubject.id}_${slot.startTime}`;

                          return (
                            <div key={`${slot.id || slot.subjectId}-${slot.startTime}-${index}`} className="glass-card" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)' }}>
                              <div className="flex-between">
                                <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{matchingSubject.name}</span>
                                <span className={`subject-badge ${matchingSubject.type.toLowerCase()}`} style={{ scale: '0.85', transformOrigin: 'right center' }}>{matchingSubject.type}</span>
                              </div>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                Period Time: <strong>{slot.startTime} - {slot.endTime}</strong>
                              </span>
                              
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem', marginTop: '0.25rem' }}>
                                <button
                                  type="button"
                                  className={`check-btn check-btn-present ${todayLog?.status === 'PRESENT' ? 'active' : ''}`}
                                  style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                  disabled={inFlightChecks[slotKey]}
                                  onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT', undefined, slot.startTime)}
                                >
                                  Present
                                </button>
                                <button
                                  type="button"
                                  className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                                  style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                  disabled={inFlightChecks[slotKey]}
                                  onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT', undefined, slot.startTime)}
                                >
                                  Absent
                                </button>
                                <button
                                  type="button"
                                  className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                                  style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                  disabled={inFlightChecks[slotKey]}
                                  onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY', undefined, slot.startTime)}
                                >
                                  Holiday
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Subjects Grid & Quick Actions */}
                <div>
                  {designVersion === 'classic' ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                      <h3 style={{ fontSize: '1.4rem' }}>Subject Details</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', padding: '0.25rem', borderRadius: 'var(--border-radius-md)' }}>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('ALL')}
                            style={{
                              padding: '0.35rem 0.75rem',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              border: 'none',
                              background: subjectFilter === 'ALL' ? 'var(--primary)' : 'transparent',
                              color: subjectFilter === 'ALL' ? '#fff' : 'var(--text-secondary)',
                              borderRadius: 'var(--border-radius-sm)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                          >
                            All ({subjects.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('LECTURE')}
                            style={{
                              padding: '0.35rem 0.75rem',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              border: 'none',
                              background: subjectFilter === 'LECTURE' ? 'var(--primary)' : 'transparent',
                              color: subjectFilter === 'LECTURE' ? '#fff' : 'var(--text-secondary)',
                              borderRadius: 'var(--border-radius-sm)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                          >
                            Lectures ({subjects.filter(s => s.type === 'LECTURE').length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('LAB')}
                            style={{
                              padding: '0.35rem 0.75rem',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              border: 'none',
                              background: subjectFilter === 'LAB' ? 'var(--primary)' : 'transparent',
                              color: subjectFilter === 'LAB' ? '#fff' : 'var(--text-secondary)',
                              borderRadius: 'var(--border-radius-sm)',
                              cursor: 'pointer',
                              transition: 'var(--transition-smooth)'
                            }}
                          >
                            Labs ({subjects.filter(s => s.type === 'LAB').length})
                          </button>
                        </div>
                        <button className="btn-primary" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setShowAddSubject(true)}>
                          <Plus size={16} />
                          <span>Add Subject</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Neo-Brutalist Academic Registry Header & Filter Tabs */
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', paddingTop: '0.25rem', marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <h2 className="font-heading" style={{ fontSize: '1.65rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
                          Active Academic Registry
                        </h2>
                        <span className="font-mono-num" style={{ background: '#FFE600', color: '#18181b', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.65rem', borderRadius: '9999px', border: '1.5px solid var(--border-color)', boxShadow: '2px 2px 0px var(--card-shadow)' }}>
                          {subjects.length} Units
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                        {/* Responsive Brutal Filter Tabs */}
                        <div className="brutal-card" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'var(--bg-surface)', padding: '0.35rem', borderRadius: '12px' }}>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('ALL')}
                            style={{
                              padding: '0.35rem 0.85rem',
                              borderRadius: '8px',
                              fontWeight: 800,
                              fontSize: '0.78rem',
                              border: subjectFilter === 'ALL' ? '1.5px solid var(--border-color)' : '1.5px solid transparent',
                              background: subjectFilter === 'ALL' ? '#FFE600' : 'transparent',
                              color: subjectFilter === 'ALL' ? '#18181b' : 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            All ({subjects.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('LECTURE')}
                            style={{
                              padding: '0.35rem 0.85rem',
                              borderRadius: '8px',
                              fontWeight: 800,
                              fontSize: '0.78rem',
                              border: subjectFilter === 'LECTURE' ? '1.5px solid var(--border-color)' : '1.5px solid transparent',
                              background: subjectFilter === 'LECTURE' ? '#FFE600' : 'transparent',
                              color: subjectFilter === 'LECTURE' ? '#18181b' : 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            Lectures ({subjects.filter(s => s.type === 'LECTURE').length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubjectFilter('LAB')}
                            style={{
                              padding: '0.35rem 0.85rem',
                              borderRadius: '8px',
                              fontWeight: 800,
                              fontSize: '0.78rem',
                              border: subjectFilter === 'LAB' ? '1.5px solid var(--border-color)' : '1.5px solid transparent',
                              background: subjectFilter === 'LAB' ? '#FFE600' : 'transparent',
                              color: subjectFilter === 'LAB' ? '#18181b' : 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            Labs ({subjects.filter(s => s.type === 'LAB').length})
                          </button>
                        </div>

                        <button
                          type="button"
                          className="brutal-btn"
                          onClick={() => setShowAddSubject(true)}
                          style={{
                            background: '#4D96FF',
                            color: '#ffffff',
                            fontWeight: 900,
                            padding: '0.45rem 1rem',
                            borderRadius: '10px',
                            fontSize: '0.82rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                        >
                          <Plus size={15} />
                          <span>Add Subject</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {(() => {
                    const filteredSubjects = subjects.filter((sub) => {
                      if (subjectFilter === 'ALL') return true;
                      return sub.type === subjectFilter;
                    });

                    if (filteredSubjects.length === 0) {
                      return (
                        <div className={designVersion === 'classic' ? 'glass-card' : 'brutal-card'} style={{ background: 'var(--bg-surface)', borderRadius: '18px', textAlign: 'center', padding: '3.5rem 1.5rem', border: designVersion === 'classic' ? '1px solid var(--border-color)' : '3px solid var(--border-color)', boxShadow: 'var(--card-shadow)' }}>
                          <BookOpen size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
                          <h4 className={designVersion === 'classic' ? '' : 'font-heading'} style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                            No {subjectFilter === 'ALL' ? '' : subjectFilter === 'LECTURE' ? 'Lectures' : 'Labs'} Configured
                          </h4>
                          <p style={{ color: 'var(--text-muted)', marginTop: '0.35rem', fontSize: '0.88rem' }}>
                            No subjects of this type are currently configured in this term.
                          </p>
                        </div>
                      );
                    }

                    if (designVersion === 'classic') {
                      return (
                        <div className="subjects-grid">
                          {filteredSubjects.map((sub) => {
                            const todayLog = sub.logs.find(
                              (log) => log.date.split('T')[0] === getLocalDateString()
                            );
                            const advice = calculateAdvice(sub.stats.present, sub.stats.total, sub.targetPercentage);

                            return (
                              <div 
                                key={sub.id} 
                                className="glass-card subject-card"
                                onClick={() => setSelectedSubjectForHistory(sub)}
                                style={{ cursor: 'pointer' }}
                                title="Click subject card to view full attendance history"
                              >
                                <div className="subject-card-header">
                                  <div className="subject-card-title">
                                    <span className={`subject-badge ${sub.type.toLowerCase()}`}>{sub.type}</span>
                                    <h3>{sub.name}</h3>
                                    <div className="subject-goal-indicator">
                                      <span className={`goal-status-dot ${
                                        sub.stats.percentage >= sub.targetPercentage ? 'status-dot-green' : 'status-dot-red'
                                      }`} />
                                      <span>Target Goal: {sub.targetPercentage}%</span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteSubject(sub.id);
                                    }}
                                  >
                                    <Trash size={16} />
                                  </button>
                                </div>

                                <div className="subject-card-stats" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <div>
                                    <div className="sub-stat-big">{sub.stats.percentage}%</div>
                                    <span className="sub-stat-ratio">
                                      {sub.stats.present} / {sub.stats.total} logged classes
                                    </span>
                                  </div>
                                  <div className={`bunk-budget-badge ${advice.status}`}>
                                    {advice.status === 'safe' ? (
                                      <span>Can skip: <strong>{advice.classCount}</strong></span>
                                    ) : advice.status === 'warning' ? (
                                      <span>Can skip: <strong>0</strong></span>
                                    ) : (
                                      <span>Attend: <strong>+{advice.classCount}</strong></span>
                                    )}
                                  </div>
                                </div>

                                <div className="linear-bar-bg" style={{ height: '6px' }}>
                                  <div
                                    className="linear-bar-fg"
                                    style={{
                                      width: `${sub.stats.percentage}%`,
                                      background: sub.stats.percentage >= sub.targetPercentage ? 'var(--success)' : 'var(--danger)'
                                    }}
                                  />
                                </div>

                                {/* Attendance Criteria Advice */}
                                <div className="criteria-advice-section">
                                  <div className="advice-badge-container">
                                    <div className={`advice-badge-item ${calculateAdvice(sub.stats.present, sub.stats.total, criteriaA).status}`}>
                                      <span className="advice-target">{criteriaA}% Target:</span>
                                      <span className="advice-text">{calculateAdvice(sub.stats.present, sub.stats.total, criteriaA).text}</span>
                                    </div>
                                    <div className={`advice-badge-item ${calculateAdvice(sub.stats.present, sub.stats.total, criteriaB).status}`}>
                                      <span className="advice-target">{criteriaB}% Target:</span>
                                      <span className="advice-text">{calculateAdvice(sub.stats.present, sub.stats.total, criteriaB).text}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Quick Attendance Check-in */}
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                  <span className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
                                    {new Date().getDay() === 0 ? "Sunday (No Routine Classes):" : "Log attendance today:"}
                                  </span>
                                  <div className="check-in-actions">
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-present ${todayLog?.status === 'PRESENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT');
                                      }}
                                      style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Present
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT');
                                      }}
                                      style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Absent
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY');
                                      }}
                                      style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Holiday
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                        {filteredSubjects.map((sub) => {
                          const todayLog = sub.logs.find(
                            (log) => log.date.split('T')[0] === getLocalDateString()
                          );
                          const isCritical = sub.stats.percentage < criteriaB;
                          const isWarning = !isCritical && sub.stats.percentage < sub.targetPercentage;
                          const advice = calculateAdvice(sub.stats.present, sub.stats.total, sub.targetPercentage);

                          return (
                            <div 
                              key={sub.id} 
                              className="brutal-card course-card"
                              onClick={() => setSelectedSubjectForHistory(sub)}
                              style={{ 
                                borderRadius: '18px', 
                                padding: '1.35rem', 
                                display: 'flex', 
                                flexDirection: 'column', 
                                justifyContent: 'space-between',
                                cursor: 'pointer' 
                              }}
                              title="Click card to view complete attendance history"
                            >
                              <div>
                                {/* Card Top Row: Dynamic Badge + Sessions Count + Delete */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <span 
                                    style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 900,
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.04em',
                                      padding: '0.2rem 0.6rem',
                                      borderRadius: '6px',
                                      border: '1.5px solid var(--border-color)',
                                      background: isCritical ? '#FF6B6B' : isWarning ? '#FFD93D' : '#6BCB77',
                                      color: isWarning ? '#18181b' : '#ffffff'
                                    }}
                                  >
                                    {sub.type === 'LAB' ? 'Practical Lab' : 'Lecture'} • {isCritical ? 'Critical' : isWarning ? 'Warning' : 'Safe'}
                                  </span>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span 
                                      className="font-mono-num"
                                      style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 800,
                                        background: 'var(--bg-surface-hover)',
                                        color: 'var(--text-primary)',
                                        padding: '0.15rem 0.5rem',
                                        borderRadius: '5px',
                                        border: '1px solid var(--border-color)'
                                      }}
                                    >
                                      {sub.stats.present}/{sub.stats.total} Sessions
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSubject(sub.id);
                                      }}
                                      title="Delete Subject"
                                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                                    >
                                      <Trash size={14} />
                                    </button>
                                  </div>
                                </div>

                                {/* Subject Name & Target Rule */}
                                <h3 className="font-heading" style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.75rem', lineHeight: 1.25 }}>
                                  {sub.name}
                                </h3>
                                <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  Target {sub.targetPercentage}% Statutory Rule
                                </p>

                                {/* Big Percentage & Advice Pill */}
                                <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                                  <span 
                                    className="font-mono-num"
                                    style={{
                                      fontSize: '2.4rem',
                                      fontWeight: 900,
                                      lineHeight: 1,
                                      letterSpacing: '-0.03em',
                                      color: isCritical ? '#FF6B6B' : isWarning ? '#f59e0b' : '#10b981'
                                    }}
                                  >
                                    {sub.stats.percentage}%
                                  </span>

                                  {advice.status === 'safe' ? (
                                    <span style={{ background: '#dcfce7', color: '#14532d', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #86efac' }}>
                                      Can Skip {advice.classCount} Safely
                                    </span>
                                  ) : advice.status === 'warning' ? (
                                    <span style={{ background: '#fef3c7', color: '#78350f', fontSize: '0.75rem', fontWeight: 800, padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1px solid #fcd34d' }}>
                                      Need Next {advice.classCount || 1} Class
                                    </span>
                                  ) : (
                                    <span style={{ background: '#FFE600', color: '#18181b', fontSize: '0.75rem', fontWeight: 900, padding: '0.25rem 0.6rem', borderRadius: '6px', border: '1.5px solid var(--border-color)' }}>
                                      Need +{advice.classCount} Consecutive
                                    </span>
                                  )}
                                </div>

                                {/* Neo-Brutalist Progress Bar */}
                                <div style={{ width: '100%', background: 'var(--bg-surface-hover)', height: '9px', borderRadius: '9999px', border: '2px solid var(--border-color)', overflow: 'hidden', marginTop: '0.85rem' }}>
                                  <div
                                    style={{
                                      height: '100%',
                                      width: `${Math.min(100, Math.max(0, sub.stats.percentage))}%`,
                                      background: sub.stats.percentage >= sub.targetPercentage ? '#6BCB77' : sub.stats.percentage >= criteriaB ? '#FFD93D' : '#FF6B6B',
                                      transition: 'width 0.3s ease'
                                    }}
                                  />
                                </div>
                              </div>

                              {/* Card Bottom: Mark Today's Period */}
                              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '2px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                                    {new Date().getDay() === 0 ? "Sunday (No Routine Classes):" : "Mark Today's Period:"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSubjectForHistory(sub);
                                    }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'var(--primary)',
                                      fontSize: '0.72rem',
                                      fontWeight: 800,
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      textDecoration: 'underline'
                                    }}
                                  >
                                    <History size={12} />
                                    <span>History →</span>
                                  </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                                    <button
                                      type="button"
                                      className="brutal-btn"
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT');
                                      }}
                                      style={{
                                        padding: '0.55rem 0.25rem',
                                        borderRadius: '8px',
                                        fontSize: '0.78rem',
                                        fontWeight: 900,
                                        background: todayLog?.status === 'PRESENT' ? '#22c55e' : 'var(--bg-surface-hover)',
                                        color: todayLog?.status === 'PRESENT' ? '#ffffff' : 'var(--text-secondary)',
                                        border: todayLog?.status === 'PRESENT' ? '2px solid #15803d' : '2px solid var(--border-color)',
                                        boxShadow: todayLog?.status === 'PRESENT' ? '1px 1px 0px var(--card-shadow)' : '3px 3px 0px var(--card-shadow)',
                                        transform: todayLog?.status === 'PRESENT' ? 'translate(2px, 2px)' : 'none',
                                        opacity: inFlightChecks[sub.id] ? 0.6 : 1,
                                        cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      {todayLog?.status === 'PRESENT' ? '✓ Present' : 'Present'}
                                    </button>

                                    <button
                                      type="button"
                                      className="brutal-btn"
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT');
                                      }}
                                      style={{
                                        padding: '0.55rem 0.25rem',
                                        borderRadius: '8px',
                                        fontSize: '0.78rem',
                                        fontWeight: 900,
                                        background: todayLog?.status === 'ABSENT' ? '#ef4444' : 'var(--bg-surface-hover)',
                                        color: todayLog?.status === 'ABSENT' ? '#ffffff' : 'var(--text-secondary)',
                                        border: todayLog?.status === 'ABSENT' ? '2px solid #b91c1c' : '2px solid var(--border-color)',
                                        boxShadow: todayLog?.status === 'ABSENT' ? '1px 1px 0px var(--card-shadow)' : '3px 3px 0px var(--card-shadow)',
                                        transform: todayLog?.status === 'ABSENT' ? 'translate(2px, 2px)' : 'none',
                                        opacity: inFlightChecks[sub.id] ? 0.6 : 1,
                                        cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      {todayLog?.status === 'ABSENT' ? '✗ Absent' : 'Absent'}
                                    </button>

                                    <button
                                      type="button"
                                      className="brutal-btn"
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCheckIn(sub.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY');
                                      }}
                                      style={{
                                        padding: '0.55rem 0.25rem',
                                        borderRadius: '8px',
                                        fontSize: '0.78rem',
                                        fontWeight: 900,
                                        background: todayLog?.status === 'HOLIDAY' ? '#f59e0b' : 'var(--bg-surface-hover)',
                                        color: todayLog?.status === 'HOLIDAY' ? '#000000' : 'var(--text-secondary)',
                                        border: todayLog?.status === 'HOLIDAY' ? '2px solid #b45309' : '2px solid var(--border-color)',
                                        boxShadow: todayLog?.status === 'HOLIDAY' ? '1px 1px 0px var(--card-shadow)' : '3px 3px 0px var(--card-shadow)',
                                        transform: todayLog?.status === 'HOLIDAY' ? 'translate(2px, 2px)' : 'none',
                                        opacity: inFlightChecks[sub.id] ? 0.6 : 1,
                                        cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      {todayLog?.status === 'HOLIDAY' ? '📅 Holiday' : 'Holiday'}
                                    </button>
                                  </div>

                                {/* Compact 30-Day Trail Indicator */}
                                <div style={{ marginTop: '0.85rem', paddingTop: '0.65rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                  <span className="font-mono-num" style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                                    30D Trail:
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                    {getLast30Days().slice(-14).map((dateStr) => {
                                      const log = sub.logs?.find((l) => l.date.split('T')[0] === dateStr);
                                      const cellColor = log?.status === 'PRESENT' ? '#6BCB77' : log?.status === 'ABSENT' ? '#FF6B6B' : log?.status === 'HOLIDAY' ? '#FFD93D' : 'var(--bg-surface-hover)';
                                      return (
                                        <span
                                          key={dateStr}
                                          title={`${dateStr}: ${log ? log.status : 'No record'}`}
                                          style={{
                                            width: '9px',
                                            height: '9px',
                                            borderRadius: '2px',
                                            background: cellColor,
                                            border: '1px solid var(--border-color)',
                                            display: 'inline-block'
                                          }}
                                        />
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

              </div>
            )}

            {/* TAB CONTENT 2: TIMETABLE */}
            {activeTab === 'timetable' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Timetable Grid Card (full width!) */}
                <div className="glass-card timetable-card" style={{ margin: 0 }}>
                  <div className="timetable-header-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.4rem' }}>Timetable Schedule</h3>
                    
                    <div className="timetable-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                      {timetableShareCode && (
                        <div 
                          className="share-code-pill" 
                          onClick={copyShareCodeToClipboard}
                          title="Click to copy your timetable share code to clipboard"
                          style={{ 
                            cursor: 'pointer', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.35rem', 
                            fontSize: '0.8rem', 
                            padding: '0.4rem 0.65rem', 
                            background: 'rgba(99, 102, 241, 0.08)', 
                            border: '1px solid rgba(99, 102, 241, 0.15)', 
                            borderRadius: 'var(--border-radius-sm)', 
                            color: 'var(--primary)',
                            fontWeight: 'bold',
                            transition: 'var(--transition-smooth)'
                          }}
                        >
                          <span>Share Code: <strong>{timetableShareCode}</strong></span>
                          {copiedShareCode ? <Check size={12} /> : <Copy size={12} />}
                        </div>
                      )}

                      <button 
                        className="btn-primary" 
                        style={{ 
                          padding: '0.4rem 0.85rem', 
                          fontSize: '0.8rem', 
                          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                          boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontWeight: 600,
                          width: 'auto'
                        }} 
                        onClick={() => setShowRoutineNotice(true)}
                        title="Click to preview & apply official CSE 3 timetable"
                      >
                        <Sparkles size={14} />
                        Apply CSE 3 Routine
                      </button>

                      <button className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setShowImportCodeModal(true)}>
                        <Copy size={14} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
                        Import Friend&apos;s Code
                      </button>

                      <input
                        type="text"
                        placeholder="Branch/Sec (e.g. cseI)"
                        value={uploadFilter}
                        onChange={(e) => setUploadFilter(e.target.value)}
                        className="form-input"
                        style={{
                          width: '150px',
                          padding: '0.4rem 0.75rem',
                          fontSize: '0.8rem',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--border-radius-sm)',
                          color: 'var(--text-primary)'
                        }}
                      />

                      <input
                        type="text"
                        placeholder="Lab Group (e.g. Grp A)"
                        value={labGroupFilter}
                        onChange={(e) => setLabGroupFilter(e.target.value)}
                        className="form-input"
                        style={{
                          width: '150px',
                          padding: '0.4rem 0.75rem',
                          fontSize: '0.8rem',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--border-radius-sm)',
                          color: 'var(--text-primary)'
                        }}
                      />

                      <button className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
                        Upload Image/PDF Timetable
                      </button>

                      <button className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={handleManualTimetableEdit}>
                        <Edit size={14} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
                        Enter Manually
                      </button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      className="file-input-hidden"
                      accept="image/*,application/pdf"
                      onChange={handleTimetableUpload}
                    />
                  </div>

                  {isCse3Student(subjects, timetable, routineNoticeStatus) && (
                    <div style={{
                      marginTop: '1rem',
                      marginBottom: '1rem',
                      padding: '0.75rem 1rem',
                      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08))',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: 'var(--border-radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      fontSize: '0.82rem',
                      color: 'var(--text-secondary)'
                    }}>
                      <Sparkles size={16} style={{ color: 'var(--secondary)', flexShrink: 0 }} />
                      <span>
                        <strong>CSE 3 Routine Notice:</strong> This revised weekly routine is in effect starting <strong>Monday, September 14, 2026</strong>. All attendance history prior to Sep 14 (including yesterday Friday, Sep 11) retains your previous routine schedule.
                      </span>
                    </div>
                  )}

                  {isOcrLoading ? (
                    <div className="scanning-container" style={{ position: 'relative', overflow: 'hidden', padding: '3rem 2rem', background: 'rgba(255,255,255,0.01)', borderRadius: 'var(--border-radius-md)', border: '1px dashed var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                      <div className="scanning-line" style={{ position: 'absolute', left: 0, right: 0, height: '4px', background: 'linear-gradient(90deg, transparent, var(--secondary), transparent)', top: 0, animation: 'scan 2s linear infinite', boxShadow: '0 0 12px var(--secondary)' }} />
                      <div style={{ display: 'inline-flex', position: 'relative', padding: '1rem', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '50%', color: 'var(--primary)', animation: 'pulse 1.5s infinite alternate' }}>
                        <Calendar size={36} />
                      </div>
                      <h4 style={{ fontSize: '1.2rem', fontWeight: 600, background: 'linear-gradient(135deg, var(--text-primary), var(--secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        {pendingTimetableFile ? "Importing Schedule Slots..." : "AI Vision Scanner Active..."}
                      </h4>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '320px', margin: '0 auto', lineHeight: 1.5, textAlign: 'center' }}>
                        {pendingTimetableFile 
                          ? `Extracting slots for stream "${selectedStream === '__CUSTOM__' ? customStream : selectedStream}" and group "${selectedGroup === '__CUSTOM__' ? customGroup : selectedGroup}"...`
                          : "Pre-scanning routine layout for streams, branches, and lab groups..."}
                      </p>
                    </div>
                  ) : timetable.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
                        <Calendar size={42} />
                        <div>
                          <h4>No timetable schedule defined yet</h4>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            Drag and drop your class timetable image/PDF here, or click to upload.
                          </p>
                          <span style={{ color: 'var(--secondary)', fontSize: '0.8rem', display: 'block', marginTop: '0.5rem' }}>
                            *AuraAttend Neural Vision Scanner Active
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.05em' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                        <span>OR USE FRIEND&apos;S CODE</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                      </div>

                      <form onSubmit={handleImportFriendTimetable} className="glass-card" style={{ padding: '1rem', display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', margin: 0 }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Paste Friend's Alphanumeric Code (e.g. 4A2E5D9C)"
                          value={friendShareCodeInput}
                          onChange={(e) => setFriendShareCodeInput(e.target.value)}
                          style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                          required
                        />
                        <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '0 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                          Load Routine
                        </button>
                      </form>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.05em' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                        <span>OR ENTER MANUALLY</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                      </div>

                      <button
                        type="button"
                        className="btn-outline"
                        onClick={handleManualTimetableEdit}
                        style={{ width: '100%', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.9rem' }}
                      >
                        <Edit size={16} />
                        <span>Enter Routine Schedule Manually</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* View Mode Toggle Switch */}
                      <div className="timetable-view-toggle-bar" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem',
                        flexWrap: 'wrap',
                        marginBottom: '1rem',
                        paddingBottom: '0.75rem',
                        borderBottom: '1px solid var(--border-color)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            View:
                          </span>
                          <div style={{
                            display: 'inline-flex',
                            background: 'rgba(0, 0, 0, 0.35)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '999px',
                            padding: '3px'
                          }}>
                            <button
                              type="button"
                              onClick={() => setTimetableMobileView('day')}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.35rem 0.85rem',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                borderRadius: '999px',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'var(--transition-smooth)',
                                background: timetableMobileView === 'day' ? 'var(--primary)' : 'transparent',
                                color: timetableMobileView === 'day' ? '#ffffff' : 'var(--text-secondary)',
                                boxShadow: timetableMobileView === 'day' ? '0 2px 8px rgba(99, 102, 241, 0.4)' : 'none'
                              }}
                            >
                              <Calendar size={13} />
                              <span>Day by Day</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setTimetableMobileView('grid')}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.35rem 0.85rem',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                borderRadius: '999px',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'var(--transition-smooth)',
                                background: timetableMobileView === 'grid' ? 'var(--primary)' : 'transparent',
                                color: timetableMobileView === 'grid' ? '#ffffff' : 'var(--text-secondary)',
                                boxShadow: timetableMobileView === 'grid' ? '0 2px 8px rgba(99, 102, 241, 0.4)' : 'none'
                              }}
                            >
                              <Clock size={13} />
                              <span>Full Week</span>
                            </button>
                          </div>
                        </div>

                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {timetableMobileView === 'day' ? 'Tap any day to view classes' : 'Complete weekly schedule'}
                        </span>
                      </div>

                      {timetableMobileView === 'day' ? (
                        <div className="timetable-day-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
                          {/* 7-Day Grid Strip (100% width, zero horizontal scroll) */}
                          <div className="mobile-day-strip" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(7, 1fr)',
                            gap: '0.25rem',
                            width: '100%',
                            paddingBottom: '0.25rem'
                          }}>
                            {DAYS.map((day) => {
                              const isSelected = mobileSelectedDay.toUpperCase() === day.toUpperCase();
                              const countForDay = timetable.filter(s => s.dayOfWeek.toUpperCase() === day.toUpperCase()).length;
                              const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
                              const isToday = todayDayName === day;

                              return (
                                <button
                                  key={day}
                                  type="button"
                                  onClick={() => setMobileSelectedDay(day)}
                                  className="day-strip-btn"
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem 0.15rem',
                                    borderRadius: 'var(--border-radius-sm)',
                                    border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                                    background: isSelected 
                                      ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.28), rgba(168, 85, 247, 0.18))' 
                                      : 'rgba(255, 255, 255, 0.02)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.15rem',
                                    transition: 'var(--transition-smooth)',
                                    boxShadow: isSelected ? '0 0 10px rgba(99, 102, 241, 0.35)' : 'none'
                                  }}
                                >
                                  <span style={{ 
                                    fontSize: '0.74rem', 
                                    fontWeight: isSelected ? 700 : 600,
                                    color: isSelected ? '#ffffff' : 'var(--text-primary)'
                                  }}>
                                    {day.substring(0, 3)}
                                  </span>
                                  <span style={{ 
                                    fontSize: '0.65rem', 
                                    color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                                    fontWeight: 600
                                  }}>
                                    {countForDay}
                                  </span>
                                  {isToday && (
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--secondary)' }} title="Today" />
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {/* Classes list for selected day */}
                          {(() => {
                            const selectedDaySlots = timetable
                              .filter(slot => slot.dayOfWeek.toUpperCase() === mobileSelectedDay.toUpperCase())
                              .sort((a, b) => a.startTime.localeCompare(b.startTime));

                            if (selectedDaySlots.length === 0) {
                              return (
                                <div className="glass-card" style={{
                                  padding: '2.5rem 1.5rem',
                                  textAlign: 'center',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: '0.75rem',
                                  background: 'rgba(255, 255, 255, 0.01)',
                                  border: '1px dashed var(--border-color)'
                                }}>
                                  <div style={{
                                    width: '46px',
                                    height: '46px',
                                    borderRadius: '50%',
                                    background: 'rgba(99, 102, 241, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--primary)'
                                  }}>
                                    <Calendar size={22} />
                                  </div>
                                  <h4 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>
                                    No classes on {mobileSelectedDay}
                                  </h4>
                                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, maxWidth: '280px' }}>
                                    Enjoy your free time, or tap below to manually add a class for {mobileSelectedDay}.
                                  </p>
                                  <button
                                    type="button"
                                    className="btn-outline"
                                    onClick={handleManualTimetableEdit}
                                    style={{ marginTop: '0.5rem', padding: '0.45rem 1rem', fontSize: '0.8rem', width: 'auto' }}
                                  >
                                    <Edit size={13} style={{ marginRight: '4px' }} />
                                    <span>Add Class Slot</span>
                                  </button>
                                </div>
                              );
                            }

                            const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
                            const isToday = todayDayName === mobileSelectedDay.toUpperCase();
                            const now = new Date();
                            const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
                                {selectedDaySlots.map((slot) => {
                                  const isOngoing = isToday && nowTimeStr >= slot.startTime && nowTimeStr < slot.endTime;
                                  const isLecture = slot.type === 'LECTURE';

                                  return (
                                    <div
                                      key={slot.id}
                                      className="glass-card class-slot-box"
                                      style={{
                                        margin: 0,
                                        padding: '0.9rem 1.1rem',
                                        borderLeft: isLecture ? '4px solid var(--primary)' : '4px solid var(--secondary)',
                                        background: isOngoing 
                                          ? (isLecture ? 'rgba(99, 102, 241, 0.14)' : 'rgba(244, 63, 94, 0.14)')
                                          : 'linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
                                        boxShadow: isOngoing ? (isLecture ? '0 0 20px rgba(99, 102, 241, 0.25)' : '0 0 20px rgba(244, 63, 94, 0.25)') : 'none',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem',
                                        width: '100%'
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                          <div style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.3rem',
                                            fontSize: '0.78rem',
                                            fontWeight: 600,
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '6px',
                                            background: 'rgba(255, 255, 255, 0.06)',
                                            color: 'var(--text-primary)'
                                          }}>
                                            <Clock size={12} className="text-secondary" />
                                            <span>{slot.startTime} - {slot.endTime}</span>
                                          </div>
                                          <span className={`subject-badge ${slot.type.toLowerCase()}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>
                                            {slot.type}
                                          </span>
                                          {isOngoing && (
                                            <span style={{
                                              fontSize: '0.7rem',
                                              fontWeight: 700,
                                              padding: '0.15rem 0.5rem',
                                              borderRadius: '999px',
                                              background: 'rgba(239, 68, 68, 0.2)',
                                              color: '#ef4444',
                                              border: '1px solid rgba(239, 68, 68, 0.4)',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '0.25rem'
                                            }}>
                                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
                                              LIVE NOW
                                            </span>
                                          )}
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => handleDeleteSlot(slot.id)}
                                          title="Delete slot"
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            color: 'var(--danger)',
                                            cursor: 'pointer',
                                            padding: '0.25rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            opacity: 0.7,
                                            transition: 'opacity 0.2s'
                                          }}
                                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                                          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>

                                      <div style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {slot.subjectName}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        /* Full Week View (Responsive: Vertical Agenda on mobile, Grid on desktop) */
                        <>
                          {/* Desktop Grid View */}
                          <div className="timetable-grid-desktop timetable-grid-wrapper">
                            <div className="timetable-grid" style={{ gridTemplateColumns: `80px repeat(${DAYS.length}, 1fr)` }}>
                              {/* Blank top left cell */}
                              <div className="grid-cell grid-header-cell" style={{ minHeight: '40px' }}>Time</div>
                              {DAYS.map((day, idx) => (
                                <div 
                                  key={day} 
                                  className="grid-cell grid-header-cell" 
                                  style={{ minHeight: '40px', borderRight: idx === DAYS.length - 1 ? 'none' : '' }}
                                >
                                  {day.substring(0, 3)}
                                </div>
                              ))}

                              {/* RENDER ROW FOR EACH HOUR */}
                              {TIMES.map((time) => {
                                const formattedTime = time.substring(0, 5);
                                return (
                                  <Fragment key={time}>
                                    <div className="grid-cell grid-time-cell" style={{ minHeight: '40px' }}>
                                      {formattedTime}
                                    </div>
                                    {DAYS.map((day, idx) => {
                                      const matchingSlots = timetable.filter(
                                        (slot) =>
                                          slot.dayOfWeek.toUpperCase() === day &&
                                          slot.startTime <= time &&
                                          slot.endTime > time
                                      );

                                      const borderRightStyle = idx === DAYS.length - 1 ? 'none' : '';

                                      if (matchingSlots.length === 0) {
                                        return (
                                          <div
                                            key={day}
                                            className="grid-cell grid-body-cell clickable-grid-cell"
                                            onClick={() => handleEmptyCellClick(day, time)}
                                            style={{ minHeight: '40px', borderRight: borderRightStyle }}
                                          />
                                        );
                                      }

                                      return (
                                        <div
                                          key={day}
                                          className="grid-cell grid-body-cell active-grid-cell"
                                          style={{
                                            minHeight: '40px',
                                            background: matchingSlots[0].type === 'LECTURE' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(6, 182, 212, 0.15)',
                                            borderLeft: matchingSlots[0].type === 'LECTURE' ? '3px solid var(--primary)' : '3px solid var(--secondary)',
                                            position: 'relative',
                                            borderRight: borderRightStyle
                                          }}
                                        >
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.25rem' }}>
                                            <div className="timetable-slot-name" title={matchingSlots[0].subjectName} style={{ fontWeight: 600 }}>
                                              {matchingSlots[0].subjectName}
                                            </div>
                                            <button 
                                              type="button"
                                              onClick={() => handleDeleteSlot(matchingSlots[0].id)}
                                              style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: 'var(--danger)',
                                                cursor: 'pointer',
                                                padding: '0.1rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                opacity: 0.7,
                                                transition: 'opacity 0.2s'
                                              }}
                                              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                                              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
                                              title="Delete Slot"
                                            >
                                              <X size={12} />
                                            </button>
                                          </div>
                                          <div className="timetable-slot-time">
                                            {matchingSlots[0].startTime}-{matchingSlots[0].endTime}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                            </div>
                          </div>

                          {/* Mobile Vertical Week Agenda (Zero Horizontal Scroll!) */}
                          <div className="timetable-agenda-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
                            {DAYS.map((day) => {
                              const slotsForDay = timetable
                                .filter((slot) => slot.dayOfWeek.toUpperCase() === day.toUpperCase())
                                .sort((a, b) => a.startTime.localeCompare(b.startTime));
                              const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
                              const isToday = todayDayName === day;

                              return (
                                <div 
                                  key={day} 
                                  className="glass-card" 
                                  style={{
                                    margin: 0,
                                    padding: '0.85rem 1rem',
                                    background: isToday ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.015)',
                                    border: isToday ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-color)',
                                    borderRadius: 'var(--border-radius-md)',
                                    width: '100%'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: slotsForDay.length > 0 ? '0.6rem' : 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{ fontSize: '0.92rem', fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--text-primary)' }}>
                                        {day}
                                      </span>
                                      {isToday && (
                                        <span style={{
                                          fontSize: '0.65rem',
                                          fontWeight: 700,
                                          padding: '0.1rem 0.4rem',
                                          borderRadius: '999px',
                                          background: 'var(--secondary)',
                                          color: '#fff'
                                        }}>
                                          TODAY
                                        </span>
                                      )}
                                    </div>
                                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                                      {slotsForDay.length} {slotsForDay.length === 1 ? 'class' : 'classes'}
                                    </span>
                                  </div>

                                  {slotsForDay.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                      {slotsForDay.map((slot) => {
                                        const isLecture = slot.type === 'LECTURE';
                                        return (
                                          <div
                                            key={slot.id}
                                            style={{
                                              padding: '0.55rem 0.75rem',
                                              borderRadius: 'var(--border-radius-sm)',
                                              background: isLecture ? 'rgba(99, 102, 241, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                                              borderLeft: isLecture ? '3px solid var(--primary)' : '3px solid var(--secondary)',
                                              display: 'flex',
                                              justifyContent: 'space-between',
                                              alignItems: 'center',
                                              gap: '0.5rem',
                                              width: '100%'
                                            }}
                                          >
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {slot.subjectName}
                                              </div>
                                              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                                                {slot.startTime} - {slot.endTime} • <span style={{ fontWeight: 600, color: isLecture ? 'var(--primary)' : 'var(--secondary)' }}>{slot.type}</span>
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteSlot(slot.id)}
                                              style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: 'var(--danger)',
                                                cursor: 'pointer',
                                                padding: '0.2rem',
                                                opacity: 0.7
                                              }}
                                              title="Delete Slot"
                                            >
                                              <X size={13} />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>

              </div>
            )}

            {/* TAB CONTENT 3: ANALYTICS */}
            {activeTab === 'analytics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                
                {/* Attendance Analytics Visual Chart */}
                <div className="glass-card" style={{ padding: '1.5rem', margin: 0 }}>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <TrendingUp size={20} className="text-primary" />
                    <span>Attendance Performance Visualizer</span>
                  </h3>
                  <AttendanceChart subjects={subjects} criteriaA={criteriaA} criteriaB={criteriaB} />
                </div>

                {/* Advisor, Predictors, Settings Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                  
                  {/* Skip Advisor Card */}
                  <div className="glass-card advisor-card">
                    <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <ShieldCheck size={20} className="text-secondary" />
                      <span>Skip-Day Advisor</span>
                    </h3>
                    
                    <div className={`advisor-status ${advisor.status}`}>
                      <AlertCircle size={24} style={{ flexShrink: 0 }} />
                      <div className="advisor-text">
                        <h4>{advisor.title}</h4>
                        <p>{advisor.description}</p>
                      </div>
                    </div>
                  </div>

                  {/* Bunk Predictor Slider Widget */}
                  <div className="glass-card planner-widget">
                    <h3 style={{ fontSize: '1.25rem' }}>Bunk Planner Predictor</h3>
                    
                    {subjects.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Add subjects to plan attendances.</p>
                    ) : (
                      <>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label className="form-label">Plan Subject</label>
                          <select
                            className="planner-select"
                            value={selectedSubjectId}
                            onChange={(e) => {
                              setSelectedSubjectId(e.target.value);
                              setBunkCount(0);
                            }}
                          >
                            {subjects.map((sub) => (
                              <option key={sub.id} value={sub.id}>
                                {sub.name} ({sub.type})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="slider-container">
                          <div className="slider-labels">
                            <span>Actions:</span>
                            <span className="slider-value-glowing">
                              {bunkCount === 0
                                ? 'No change'
                                : bunkCount > 0
                                ? `Attend next ${bunkCount} classes`
                                : `Skip next ${Math.abs(bunkCount)} classes`}
                            </span>
                          </div>
                          <input
                            type="range"
                            className="custom-range-input"
                            min="-10"
                            max="10"
                            step="1"
                            value={bunkCount}
                            onChange={(e) => setBunkCount(parseInt(e.target.value))}
                          />
                        </div>

                        <div className="planner-results">
                          <div>
                            <div className="result-stat-label">Predicted %</div>
                            <div className="result-stat-value" style={{ color: predictor.meetsTarget ? 'var(--success)' : 'var(--danger)' }}>
                              {predictor.newPercentage}%
                            </div>
                          </div>
                          <div>
                            <div className="result-stat-label">Target Goal</div>
                            <div className="result-stat-value">
                              {subjects.find((s) => s.id === selectedSubjectId)?.targetPercentage}%
                            </div>
                          </div>
                          <p style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                            {predictor.statusText}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Multi-Day Bunk Simulator Card */}
                  <div className="glass-card planner-widget">
                    <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <TrendingUp size={20} className="text-primary" />
                      <span>Multi-Day Bunk Simulator</span>
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                      Simulate skipping the next N consecutive calendar days.
                    </p>
                    
                    {timetable.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.75rem' }}>
                        Please upload a timetable to simulate multi-day skipping.
                      </p>
                    ) : (
                      <>
                        <div className="slider-container" style={{ marginTop: '1rem' }}>
                          <div className="slider-labels">
                            <span>Skip Consecutive Days:</span>
                            <span className="slider-value-glowing">{bunkProjectionDays} Days</span>
                          </div>
                          <input
                            type="range"
                            className="custom-range-input"
                            min="1"
                            max="14"
                            step="1"
                            value={bunkProjectionDays}
                            onChange={(e) => setBunkProjectionDays(parseInt(e.target.value))}
                          />
                        </div>

                        <div className="planner-results" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', padding: '0.5rem' }}>
                          {subjects.map(sub => {
                            const projectedAbsents = getProjectedMissCount(sub.id, bunkProjectionDays);
                            const newTotal = sub.stats.total + projectedAbsents;
                            const newPct = newTotal > 0 ? Math.round((sub.stats.present / newTotal) * 100) : 100;
                            const meetsTarget = newPct >= sub.targetPercentage;
                            
                            if (projectedAbsents === 0) return null;

                            return (
                              <div key={sub.id} className="flex-between" style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                                <span>{sub.name} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({projectedAbsents} missed)</span></span>
                                <span style={{ fontWeight: 700, color: meetsTarget ? 'var(--success)' : 'var(--danger)' }}>
                                  {sub.stats.percentage}% → {newPct}%
                                </span>
                              </div>
                            );
                          })}
                          {subjects.every(sub => getProjectedMissCount(sub.id, bunkProjectionDays) === 0) && (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>No classes scheduled for the selected duration.</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Attendance Criteria Threshold Settings Card */}
                  <div className="glass-card settings-card">
                    <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Sliders size={20} className="text-secondary" />
                      <span>Target Criteria Settings</span>
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                      Adjust the custom percentage thresholds used across the dashboard.
                    </p>
                    
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600 }}>Primary Criteria Target:</span>
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{criteriaA}%</span>
                        </div>
                        <input
                          type="range"
                          className="custom-range-input"
                          min="50"
                          max="100"
                          step="5"
                          value={criteriaA}
                          onChange={(e) => handleUpdateCriteriaA(parseInt(e.target.value))}
                        />
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontWeight: 600 }}>Secondary Criteria Target:</span>
                          <span style={{ color: 'var(--secondary)', fontWeight: 700 }}>{criteriaB}%</span>
                        </div>
                        <input
                          type="range"
                          className="custom-range-input"
                          min="40"
                          max="95"
                          step="5"
                          value={criteriaB}
                          onChange={(e) => handleUpdateCriteriaB(parseInt(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB CONTENT 4: CALENDAR LOGGER */}
            {activeTab === 'calendar' && (() => {
              const year = currentCalendarMonth.getFullYear();
              const monthIndex = currentCalendarMonth.getMonth();
              const monthNames = [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"
              ];
              const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
              const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
              const firstDayIndex = new Date(year, monthIndex, 1).getDay();

              const daysOfWeekMap = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
              const [sYear, sMonth, sDay] = selectedDate.split('-').map(Number);
              const selectedDateObj = new Date(sYear, sMonth - 1, sDay);
              const selectedDayOfWeekName = daysOfWeekMap[selectedDateObj.getDay()];

              const scheduledSlotsForDay = getEffectiveSlotsForDate(
                selectedDate,
                selectedDayOfWeekName
              );

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="calendar-wrapper-grid">
                    
                    {/* Left Column: Interactive Month Calendar */}
                    <div className="glass-card calendar-card" style={{ margin: 0 }}>
                      <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Calendar className="text-primary" size={20} />
                          <span>Attendance History Calendar</span>
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="copy-btn"
                            style={{ padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)' }}
                            onClick={() => {
                              setCurrentCalendarMonth(new Date(year, monthIndex - 1, 1));
                            }}
                          >
                            &larr;
                          </button>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem', minWidth: '110px', textAlign: 'center' }}>
                            {monthNames[monthIndex]} {year}
                          </span>
                          <button
                            type="button"
                            className="copy-btn"
                            style={{ padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-sm)' }}
                            onClick={() => {
                              setCurrentCalendarMonth(new Date(year, monthIndex + 1, 1));
                            }}
                          >
                            &rarr;
                          </button>
                        </div>
                      </div>

                      {/* Weekday Labels */}
                      <div className="calendar-grid weekday-labels">
                        {weekdayNames.map(name => (
                          <div key={name}>
                            <span className="weekday-desktop">{name}</span>
                            <span className="weekday-mobile">{name.substring(0, 2)}</span>
                          </div>
                        ))}
                      </div>

                      {/* Calendar Days Grid */}
                      <div className="calendar-grid">
                        {/* Empty padding cells for first day of the week */}
                        {Array(firstDayIndex).fill(null).map((_, idx) => (
                          <div key={`pad-${idx}`} style={{ aspectRatio: '1/1' }} />
                        ))}

                        {/* Day Cells */}
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((dayNum) => {
                          const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                          const isSelected = selectedDate === dateStr;
                          const isToday = getLocalDateString() === dateStr;
                          
                          // Find logs for this day
                          const dayLogs = subjects.flatMap(sub => 
                            (sub.logs || [])
                              .filter(log => log.date.split('T')[0] === dateStr)
                              .map(log => ({ ...log, subjectName: sub.name, type: sub.type }))
                          );

                          return (
                            <button
                              key={dayNum}
                              type="button"
                              onClick={() => setSelectedDate(dateStr)}
                              style={{
                                aspectRatio: '1/1',
                                background: isSelected 
                                  ? 'var(--primary)' 
                                  : isToday 
                                    ? 'rgba(99, 102, 241, 0.15)' 
                                    : 'rgba(255, 255, 255, 0.02)',
                                border: isSelected 
                                  ? '1px solid var(--primary)' 
                                  : isToday 
                                    ? '1px solid var(--primary)' 
                                    : '1px solid var(--border-color)',
                                borderRadius: 'var(--border-radius-sm)',
                                color: isSelected ? '#ffffff' : 'var(--text-primary)',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.15rem',
                                transition: 'var(--transition-smooth)',
                                position: 'relative',
                                padding: 'var(--calendar-day-padding, 0.2rem)'
                              }}
                              className={`calendar-day-btn ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                            >
                              <span style={{ fontSize: 'var(--calendar-day-font-size, 0.9rem)', fontWeight: (isSelected || isToday) ? 700 : 500 }}>{dayNum}</span>
                              
                              {/* Tiny dots representing logs */}
                              {dayLogs.length > 0 && (
                                <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%' }}>
                                  {dayLogs.slice(0, 3).map((log, idx) => (
                                    <span
                                      key={idx}
                                      className="calendar-dot"
                                      style={{
                                        backgroundColor: log.status === 'PRESENT' 
                                          ? 'var(--success)' 
                                          : log.status === 'ABSENT' 
                                            ? 'var(--secondary)' 
                                            : 'var(--warning)',
                                      }}
                                    />
                                  ))}
                                  {dayLogs.length > 3 && (
                                    <span style={{ fontSize: '0.55rem', color: isSelected ? '#fff' : 'var(--text-muted)', lineHeight: 1 }}>+</span>
                                  )}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Legend */}
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.25rem', fontSize: '0.75rem', justifyContent: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
                          <span>Present</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--secondary)' }} />
                          <span>Absent</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--warning)' }} />
                          <span>Holiday</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Attendance Logger Panel */}
                    <div className="glass-card logger-card" style={{ margin: 0 }}>
                      <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          {selectedDayOfWeekName}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.15rem' }}>
                          <h3 style={{ fontSize: '1.4rem', margin: 0 }}>
                            {selectedDateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          </h3>
                          {selectedDate < NEW_ROUTINE_EFFECTIVE_DATE && isCse3Student(subjects, timetable, routineNoticeStatus) && (
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              padding: '0.2rem 0.55rem',
                              borderRadius: '4px',
                              background: 'rgba(99, 102, 241, 0.12)',
                              color: 'var(--secondary)',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                            }}>
                              Previous Routine (in effect till Sep 11)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* SECTION 1: TIMETABLE SCHEDULE FOR THIS DAY */}
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <Clock size={16} className="text-primary" />
                            <span>Routine Scheduled Classes ({scheduledSlotsForDay.length})</span>
                          </h4>
                          
                          {scheduledSlotsForDay.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() => handleBulkCheckIn('PRESENT', selectedDate, scheduledSlotsForDay)}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  background: 'rgba(16, 185, 129, 0.1)',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  borderRadius: '20px',
                                  color: 'var(--success)',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--success)';
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                                  e.currentTarget.style.color = 'var(--success)';
                                }}
                              >
                                ✓ All Present
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBulkCheckIn('ABSENT', selectedDate, scheduledSlotsForDay)}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  background: 'rgba(244, 63, 94, 0.1)',
                                  border: '1px solid rgba(244, 63, 94, 0.3)',
                                  borderRadius: '20px',
                                  color: 'var(--secondary)',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--secondary)';
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)';
                                  e.currentTarget.style.color = 'var(--secondary)';
                                }}
                              >
                                ✗ All Absent
                              </button>
                              <button
                                type="button"
                                onClick={() => handleBulkCheckIn('HOLIDAY', selectedDate, scheduledSlotsForDay)}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  background: 'rgba(245, 158, 11, 0.1)',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: '20px',
                                  color: 'var(--warning)',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--warning)';
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                                  e.currentTarget.style.color = 'var(--warning)';
                                }}
                              >
                                📅 All Holiday
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Are you sure you want to clear all attendance markings for ${selectedDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}?`)) {
                                    handleClearAllLogsForDate(selectedDate);
                                  }
                                }}
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  background: 'rgba(148, 163, 184, 0.1)',
                                  border: '1px solid rgba(148, 163, 184, 0.3)',
                                  borderRadius: '20px',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--text-muted)';
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
                                  e.currentTarget.style.color = 'var(--text-muted)';
                                }}
                              >
                                🧹 Clear All
                              </button>
                            </div>
                          )}
                        </div>

                        {scheduledSlotsForDay.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.75rem', background: 'rgba(255,255,255,0.01)', borderRadius: 'var(--border-radius-sm)', border: '1px dashed var(--border-color)' }}>
                            No classes are scheduled in your routine for this weekday.
                          </p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {scheduledSlotsForDay.map((slot) => {
                              const sub = subjects.find(s => s.id === slot.subjectId);
                              const slotsForThisSub = scheduledSlotsForDay.filter(s => s.subjectId === slot.subjectId);
                              const slotLog = getSlotLog(sub, selectedDate, slot.startTime, slotsForThisSub);
                              const status = slotLog?.status;
                              const slotKey = `${slot.subjectId}_${slot.startTime}`;

                              return (
                                <div 
                                  key={slot.id} 
                                  className="class-slot-box"
                                  style={{ 
                                    padding: '1rem', 
                                    background: 'rgba(255,255,255,0.02)', 
                                    border: '1px solid var(--border-color)', 
                                    borderRadius: 'var(--border-radius-sm)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.75rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                      <span style={{ fontSize: '0.75rem', fontWeight: 700 }} className={`subject-badge ${slot.type.toLowerCase()}`}>
                                        {slot.type}
                                      </span>
                                      <h5 style={{ fontSize: '1rem', marginTop: '0.2rem', fontWeight: 600 }}>{slot.subjectName}</h5>
                                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.1rem' }}>
                                        Time: {slot.startTime} - {slot.endTime}
                                      </span>
                                    </div>

                                    {status && (
                                      <span className={`status-badge status-${status.toLowerCase()}`} style={{ fontSize: '0.75rem' }}>
                                        {status}
                                      </span>
                                    )}
                                  </div>

                                  <div className="check-in-actions" style={{ marginTop: '0.25rem' }}>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-present ${status === 'PRESENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[slotKey]}
                                      onClick={() => handleCheckIn(slot.subjectId, status === 'PRESENT' ? 'REMOVE' : 'PRESENT', selectedDate, slot.startTime)}
                                      style={{ opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Present
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-absent ${status === 'ABSENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[slotKey]}
                                      onClick={() => handleCheckIn(slot.subjectId, status === 'ABSENT' ? 'REMOVE' : 'ABSENT', selectedDate, slot.startTime)}
                                      style={{ opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Absent
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-holiday ${status === 'HOLIDAY' ? 'active' : ''}`}
                                      disabled={inFlightChecks[slotKey]}
                                      onClick={() => handleCheckIn(slot.subjectId, status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY', selectedDate, slot.startTime)}
                                      style={{ opacity: inFlightChecks[slotKey] ? 0.5 : 1, cursor: inFlightChecks[slotKey] ? 'not-allowed' : 'pointer' }}
                                    >
                                      Holiday
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* SECTION 2: LOG OTHER SUBJECTS */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <BookOpen size={16} className="text-secondary" />
                            <span>Log Other Classes on this Date</span>
                          </h4>
                          {scheduledSlotsForDay.length === 0 && subjects.some(s => (s.logs || []).some(l => l.date.split('T')[0] === selectedDate)) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Are you sure you want to clear all attendance markings for ${selectedDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}?`)) {
                                  handleClearAllLogsForDate(selectedDate);
                                }
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                borderRadius: '20px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                cursor: 'pointer',
                                transition: 'var(--transition-smooth)'
                              }}
                            >
                              🧹 Clear All Markings
                            </button>
                          )}
                        </div>

                        {subjects.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No subjects configured in this semester.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                            {subjects.map((sub) => {
                              const slotLog = sub.logs?.find(log => log.date.split('T')[0] === selectedDate);
                              const status = slotLog?.status;

                              return (
                                <div 
                                  key={sub.id} 
                                  className="class-slot-box"
                                  style={{ 
                                    padding: '0.75rem', 
                                    background: 'rgba(255,255,255,0.01)', 
                                    border: '1px solid var(--border-color)', 
                                    borderRadius: 'var(--border-radius-sm)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }} className={`subject-badge ${sub.type.toLowerCase()}`}>
                                        {sub.type}
                                      </span>
                                      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{sub.name}</span>
                                    </div>
                                    {status && (
                                      <span className={`status-badge status-${status.toLowerCase()}`} style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                                        {status}
                                      </span>
                                    )}
                                  </div>

                                  <div className="check-in-actions" style={{ marginTop: '0.15rem' }}>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-present ${status === 'PRESENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={() => handleCheckIn(sub.id, status === 'PRESENT' ? 'REMOVE' : 'PRESENT', selectedDate)}
                                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', opacity: inFlightChecks[sub.id] ? 0.5 : 1 }}
                                    >
                                      Present
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-absent ${status === 'ABSENT' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={() => handleCheckIn(sub.id, status === 'ABSENT' ? 'REMOVE' : 'ABSENT', selectedDate)}
                                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', opacity: inFlightChecks[sub.id] ? 0.5 : 1 }}
                                    >
                                      Absent
                                    </button>
                                    <button
                                      type="button"
                                      className={`check-btn check-btn-holiday ${status === 'HOLIDAY' ? 'active' : ''}`}
                                      disabled={inFlightChecks[sub.id]}
                                      onClick={() => handleCheckIn(sub.id, status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY', selectedDate)}
                                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', opacity: inFlightChecks[sub.id] ? 0.5 : 1 }}
                                    >
                                      Holiday
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              );
            })()}

            {/* TAB CONTENT 5: LIVE CLASS RADAR ("Sir aa gaye kya?") */}
            {activeTab === 'radar' && (() => {
              const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
              const todayDayName = dayNames[currentTime.getDay()];
              const todayDateStr = getLocalDateString();
              const todaySlots = getEffectiveSlotsForDate(todayDateStr, todayDayName)
                .sort((a, b) => a.startTime.localeCompare(b.startTime));

              const currentHours = currentTime.getHours();
              const currentMins = currentTime.getMinutes();
              const currentSecs = currentTime.getSeconds();
              const nowTotalSecs = (currentHours * 60 + currentMins) * 60 + currentSecs;

              // Strictly find slot that is active RIGHT NOW (nowTotalSecs >= startSecs && nowTotalSecs < endSecs)
              const activeSlot = todaySlots.find(slot => {
                const [sh, sm] = slot.startTime.split(':').map(Number);
                const [eh, em] = slot.endTime.split(':').map(Number);
                const sSecs = (sh * 60 + sm) * 60;
                const eSecs = (eh * 60 + em) * 60;
                return nowTotalSecs >= sSecs && nowTotalSecs < eSecs;
              }) || null;

              // Find next upcoming slot today if any
              const nextSlot = todaySlots.find(slot => {
                const [sh, sm] = slot.startTime.split(':').map(Number);
                const sSecs = (sh * 60 + sm) * 60;
                return sSecs > nowTotalSecs;
              }) || null;

              // If NO class is currently ongoing, display the clean, high-tech idle standby screen
              if (!activeSlot) {
                let nextSlotCountdown = '';
                if (nextSlot) {
                  const [nsh, nsm] = nextSlot.startTime.split(':').map(Number);
                  const diffSecs = (nsh * 60 + nsm) * 60 - nowTotalSecs;
                  const diffH = Math.floor(diffSecs / 3600);
                  const diffM = Math.floor((diffSecs % 3600) / 60);
                  const diffS = diffSecs % 60;
                  nextSlotCountdown = diffH > 0 
                    ? `${diffH}h ${diffM}m ${diffS}s` 
                    : `${diffM}m ${diffS.toString().padStart(2, '0')}s`;
                }

                const friendlyTime = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div 
                      className="glass-card" 
                      style={{ 
                        padding: '3rem 2rem', 
                        borderRadius: 'var(--border-radius-lg)', 
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(16, 185, 129, 0.03))',
                        boxShadow: '0 15px 35px rgba(0, 0, 0, 0.3)',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1.25rem'
                      }}
                    >
                      {/* Ambient Indicator Pill */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-color)', padding: '0.4rem 1rem', borderRadius: '25px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
                        <span>Radar Standby • Live Clock: <strong style={{ color: 'var(--text-primary)' }}>{friendlyTime}</strong></span>
                      </div>

                      {/* Animated Orb Icon */}
                      <div style={{
                        width: '74px',
                        height: '74px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, rgba(99, 102, 241, 0.04) 70%)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary)',
                        boxShadow: '0 0 30px rgba(99, 102, 241, 0.25)'
                      }}>
                        {currentHours >= 19 || currentHours < 6 ? <Moon size={34} /> : <Clock size={34} />}
                      </div>

                      <div style={{ maxWidth: '600px' }}>
                        <h2 style={{ fontSize: '1.95rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                          No Active Class Right Now
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
                          {nextSlot ? (
                            <>
                              You have a break right now! Your next class today is <strong style={{ color: 'var(--text-primary)' }}>{nextSlot.subjectName}</strong> at <strong>{nextSlot.startTime}</strong> (starts in ~{nextSlotCountdown}).
                            </>
                          ) : todaySlots.length > 0 ? (
                            <>
                              All scheduled classes for today ({todayDayName}) are completed. Rest up, plan your bunk runway, or review faculty intel!
                            </>
                          ) : (
                            <>
                              No classes are scheduled on your routine for {todayDayName}. Enjoy your day off or configure your timetable schedule!
                            </>
                          )}
                        </p>
                      </div>

                      {/* Helpful Quick Navigation Actions */}
                      <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => handleTabSwitch('timetable')}
                          className="btn-outline"
                          style={{ padding: '0.6rem 1.25rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <Calendar size={15} />
                          <span>View Weekly Schedule</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTabSwitch('faculty')}
                          className="btn-primary"
                          style={{ padding: '0.6rem 1.25rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                          <Award size={15} />
                          <span>Check Faculty Reviews</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Active slot exists: compute remaining seconds
              const [eh, em] = activeSlot.endTime.split(':').map(Number);
              const eSecs = (eh * 60 + em) * 60;
              const remainingSecs = Math.max(0, eSecs - nowTotalSecs);

              const mins = Math.floor(remainingSecs / 60);
              const secs = remainingSecs % 60;
              const formattedTimer = `${mins}m ${secs.toString().padStart(2, '0')}s remaining`;

              const activeCourseName = activeSlot.subjectName;
              const activeSlotTime = activeSlot.startTime;

              const totalVotes = livePoll.totalVotes;
              const haanPct = totalVotes > 0 ? livePoll.haanPercent : 50;
              const isProfIn = livePoll.haanCount > livePoll.nahiCount && totalVotes > 0;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                  {/* Hero Radar Box: "Sir aa gaye kya?" */}
                  <div 
                    className="glass-card" 
                    style={{ 
                      padding: '1.75rem', 
                      borderRadius: 'var(--border-radius-lg)', 
                      border: '1px solid rgba(244, 63, 94, 0.35)',
                      background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.08), rgba(99, 102, 241, 0.08))',
                      boxShadow: '0 15px 35px rgba(0, 0, 0, 0.3)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 10px #ef4444' }} />
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f43f5e' }}>
                          Live Classroom Consensus Radar
                        </span>
                        <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', padding: '0.15rem 0.55rem', borderRadius: '12px', color: 'var(--text-muted)' }}>
                          Auto-sync 3s
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.1)', padding: '0.35rem 0.8rem', borderRadius: '20px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                        <Clock size={14} />
                        <span>{formattedTimer}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem' }}>
                      <div style={{ flex: 1, minWidth: '280px' }}>
                        <h2 style={{ fontSize: '1.85rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.2 }}>
                          Sir / Mam aa gaye kya?
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.4rem', marginBottom: 0 }}>
                          Real-time 1-tap peer status for <strong style={{ color: 'var(--text-primary)' }}>{activeCourseName}</strong>
                          {` (${activeSlot.startTime} - ${activeSlot.endTime})`}
                        </p>

                        {/* Dual Vote Buttons */}
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.35rem', maxWidth: '420px' }}>
                          <div 
                            className="glow-vote-wrap" 
                            onClick={() => handleVotePoll(activeCourseName, activeSlotTime, 'HAAN')}
                          >
                            <div className="glow-orbit-filament" />
                            <button
                              type="button"
                              disabled={isPollSubmitting}
                              className={`glow-vote-btn ${livePoll.myVote === 'HAAN' ? 'active' : ''}`}
                            >
                              <span>HAAN (IN CLASS)</span>
                              <span style={{ 
                                fontSize: '0.8rem', 
                                padding: '0.15rem 0.5rem', 
                                borderRadius: '10px', 
                                background: livePoll.myVote === 'HAAN' ? 'rgba(0,0,0,0.3)' : 'rgba(239,68,68,0.2)', 
                                fontWeight: 800,
                                color: '#ffffff'
                              }}>
                                {livePoll.haanCount}
                              </span>
                            </button>
                          </div>

                          <button
                            type="button"
                            disabled={isPollSubmitting}
                            onClick={() => handleVotePoll(activeCourseName, activeSlotTime, 'NAHI')}
                            style={{
                              flex: 1,
                              padding: '0.85rem 1.25rem',
                              borderRadius: '10px',
                              fontWeight: 700,
                              fontSize: '0.92rem',
                              cursor: isPollSubmitting ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.6rem',
                              border: '1px solid',
                              transition: 'var(--transition-smooth)',
                              background: livePoll.myVote === 'NAHI' ? '#10b981' : '#111726',
                              color: livePoll.myVote === 'NAHI' ? '#ffffff' : '#34d399',
                              borderColor: livePoll.myVote === 'NAHI' ? '#10b981' : 'var(--border-color)',
                              boxShadow: livePoll.myVote === 'NAHI' ? '0 0 22px rgba(16, 185, 129, 0.45)' : 'none'
                            }}
                          >
                            <span>NAHI (VACANT)</span>
                            <span style={{ 
                              fontSize: '0.8rem', 
                              padding: '0.15rem 0.5rem', 
                              borderRadius: '10px', 
                              background: livePoll.myVote === 'NAHI' ? 'rgba(0,0,0,0.3)' : 'rgba(16,185,129,0.2)', 
                              fontWeight: 800,
                              color: '#ffffff'
                            }}>
                              {livePoll.nahiCount}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Peer Consensus Intel Card */}
                      <div 
                        style={{ 
                          width: '320px', 
                          padding: '1.25rem', 
                          borderRadius: 'var(--border-radius-md)', 
                          background: 'rgba(0, 0, 0, 0.3)', 
                          border: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontFamily: 'var(--font-mono, monospace)' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>PEER CONSENSUS</span>
                          <strong style={{ color: totalVotes === 0 ? 'var(--text-muted)' : isProfIn ? '#f87171' : '#34d399' }}>
                            {totalVotes === 0 ? 'No Reports Yet' : `${haanPct}% In Room`}
                          </strong>
                        </div>

                        <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', display: 'flex' }}>
                          <div style={{ width: `${totalVotes === 0 ? 50 : haanPct}%`, background: '#ef4444', transition: 'width 0.4s ease' }} />
                          <div style={{ width: `${totalVotes === 0 ? 50 : (100 - haanPct)}%`, background: '#10b981', transition: 'width 0.4s ease' }} />
                        </div>

                        <div style={{ fontSize: '0.85rem', color: totalVotes === 0 ? 'var(--text-secondary)' : isProfIn ? '#fca5a5' : '#86efac', background: totalVotes === 0 ? 'rgba(255,255,255,0.04)' : isProfIn ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', padding: '0.65rem 0.85rem', borderRadius: 'var(--border-radius-sm)', border: `1px solid ${totalVotes === 0 ? 'var(--border-color)' : isProfIn ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}` }}>
                          {totalVotes === 0 ? (
                            <span>💬 <strong>Waiting for first report.</strong> Be the first in class to tap HAAN or NAHI!</span>
                          ) : isProfIn ? (
                            <span>🚨 <strong>Professor is inside!</strong> Roll call active — enter quietly or prepare excuse.</span>
                          ) : (
                            <span>🟢 <strong>Room currently clear.</strong> You have time to grab a coffee and walk in.</span>
                          )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <Users size={13} /> {totalVotes} batchmates reported
                          </span>
                          <span>{livePoll.myVote ? `You voted: ${livePoll.myVote}` : 'Tap above to vote'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              );
            })()}

            {/* TAB CONTENT 6: DEDICATED FACULTY REVIEWS */}
            {activeTab === 'faculty' && (() => {
              const reviewedCount = subjects.filter(s => {
                const normCode = normalizeCourseCode(s.name);
                return Boolean(liveAllVibes[normCode]?.myVibe);
              }).length;

              const unsavedCount = Object.keys(unsavedChanges).filter(k => unsavedChanges[k]).length;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', position: 'relative' }}>
                  {/* Hero Header */}
                  <div 
                    className="glass-card" 
                    style={{ 
                      padding: '1.75rem', 
                      borderRadius: 'var(--border-radius-lg)', 
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(244, 63, 94, 0.06))',
                      boxShadow: '0 15px 35px rgba(0, 0, 0, 0.3)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 10px #6366f1' }} />
                        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#818cf8' }}>
                          Official Faculty Intel & Review Hub
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem', color: 'var(--success)', background: 'rgba(16, 185, 129, 0.1)', padding: '0.35rem 0.8rem', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                        <ShieldCheck size={14} />
                        <span>{reviewedCount} / {subjects.length} Faculty Reviewed by You</span>
                      </div>
                    </div>

                    <h2 style={{ fontSize: '1.85rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                      Faculty Strictness & Policy Reviews
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.4rem', maxWidth: '750px', lineHeight: 1.5 }}>
                      Submit your review once per subject. Your honest assessment calibrates attendance risk algorithms, roll-call timing intel, and helps batchmates plan their bunk runway safely.
                    </p>
                  </div>

                  {/* Auto-Save Configuration Bar */}
                  <div 
                    className="glass-card" 
                    style={{ 
                      padding: '1.1rem 1.5rem', 
                      borderRadius: 'var(--border-radius-md)', 
                      border: `1px solid ${!isAutoSaveEnabled && unsavedCount > 0 ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-color)'}`,
                      background: !isAutoSaveEnabled && unsavedCount > 0 ? 'rgba(245, 158, 11, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      flexWrap: 'wrap', 
                      gap: '1rem',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={isAutoSaveEnabled}
                        onChange={(e) => toggleAutoSave(e.target.checked)}
                        style={{ width: '18px', height: '18px', accentColor: '#6366f1', cursor: 'pointer' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>Auto-save reviews immediately</span>
                          {isAutoSaveEnabled ? (
                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#34d399', background: 'rgba(16, 185, 129, 0.15)', padding: '0.15rem 0.55rem', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              ✨ Live Auto-Save Active
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.15)', padding: '0.15rem 0.55rem', borderRadius: '12px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                              Manual Batch Mode
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {isAutoSaveEnabled 
                            ? 'Ratings and advice sync automatically to the batch as you tap, without manual saving.'
                            : 'Auto-save is OFF. Edit multiple classes freely, then save all with one click or review before exiting.'}
                        </span>
                      </div>
                    </label>

                    {/* Batch Actions when Auto-Save is OFF */}
                    {!isAutoSaveEnabled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {unsavedCount > 0 ? (
                          <>
                            <span style={{ fontSize: '0.8rem', color: 'var(--warning)', background: 'rgba(245, 158, 11, 0.15)', padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.3)', fontWeight: 600 }}>
                              ⚠️ {unsavedCount} Unsaved Class Review{unsavedCount > 1 ? 's' : ''}
                            </span>
                            <button
                              type="button"
                              disabled={isSavingAll}
                              onClick={handleSaveAllFacultyReviews}
                              className="btn-primary"
                              style={{ padding: '0.45rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                            >
                              <Save size={14} />
                              <span>{isSavingAll ? 'Saving All...' : `Save All Classes (${unsavedCount})`}</span>
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            ✓ All classes in sync
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Faculty Review Cards Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
                    {subjects.map((sub) => {
                      const normCode = normalizeCourseCode(sub.name);
                      const vibeData = liveAllVibes[normCode] || {
                        strictCount: 0,
                        neutralCount: 0,
                        chillCount: 0,
                        totalVibeVotes: 0,
                        dominantVibe: 'NEUTRAL',
                        myVibe: null,
                        myReviewText: null,
                        myUpdatedAt: null,
                        recentNotes: []
                      };

                      const hasSavedReview = Boolean(vibeData.myVibe);
                      const isEditing = editingFacultyReview[normCode] ?? !hasSavedReview;
                      const isSaving = isSavingReview[normCode] || false;
                      const hasUnsavedCardEdits = Boolean(unsavedChanges[normCode]);

                      // Local form state
                      const curForm = pendingReviewForm[normCode] || {
                        vibe: vibeData.myVibe || 'STRICT',
                        text: vibeData.myReviewText || ''
                      };

                      const strictnessTiers = [
                        { key: 'VERY_STRICT', label: '⚡ Very Strict', shortLabel: '⚡ V. Strict', pct: 90, color: '#ef4444' },
                        { key: 'STRICT', label: '⚠️ Strict', shortLabel: '⚠️ Strict', pct: 75, color: '#f87171' },
                        { key: 'NEUTRAL', label: '⚖️ Neutral', shortLabel: '⚖️ Neutral', pct: 50, color: '#f59e0b' },
                        { key: 'LENIENT', label: '🌿 Lenient', shortLabel: '🌿 Lenient', pct: 30, color: '#38bdf8' },
                        { key: 'CHILL', label: '☕ Chill', shortLabel: '☕ Chill', pct: 15, color: '#10b981' },
                      ];

                      const selectedTier = strictnessTiers.find(t => t.key === curForm.vibe) || strictnessTiers[1];
                      const savedTier = strictnessTiers.find(t => t.key === vibeData.myVibe) || strictnessTiers[1];

                      return (
                        <div 
                          key={sub.id} 
                          className="glass-card" 
                          style={{ 
                            padding: '1.5rem', 
                            borderRadius: 'var(--border-radius-md)', 
                            border: `1px solid ${
                              hasUnsavedCardEdits
                                ? 'rgba(245, 158, 11, 0.45)'
                                : hasSavedReview && !isEditing 
                                  ? 'rgba(16, 185, 129, 0.25)' 
                                  : 'var(--border-color)'
                            }`,
                            background: hasUnsavedCardEdits 
                              ? 'rgba(245, 158, 11, 0.03)' 
                              : hasSavedReview && !isEditing 
                                ? 'rgba(16, 185, 129, 0.02)' 
                                : 'var(--bg-surface)',
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '1.1rem',
                            transition: 'var(--transition-smooth)'
                          }}
                        >
                          {/* Card Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                                <span className={`subject-badge ${sub.type.toLowerCase()}`} style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                                  {sub.type}
                                </span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  Target {sub.targetPercentage}%
                                </span>
                              </div>
                              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                                {sub.name}
                              </h3>
                            </div>

                            {/* Saved / Unsaved Pill */}
                            <div>
                              {hasUnsavedCardEdits ? (
                                <span style={{ 
                                  display: 'inline-flex', 
                                  alignItems: 'center', 
                                  gap: '0.35rem', 
                                  fontSize: '0.74rem', 
                                  fontWeight: 700, 
                                  color: 'var(--warning)', 
                                  background: 'rgba(245, 158, 11, 0.15)', 
                                  padding: '0.25rem 0.65rem', 
                                  borderRadius: '12px',
                                  border: '1px solid rgba(245, 158, 11, 0.35)'
                                }}>
                                  ⚠️ Unsaved Changes
                                </span>
                              ) : hasSavedReview && !isEditing ? (
                                <span style={{ 
                                  display: 'inline-flex', 
                                  alignItems: 'center', 
                                  gap: '0.35rem', 
                                  fontSize: '0.74rem', 
                                  fontWeight: 700, 
                                  color: '#34d399', 
                                  background: 'rgba(16, 185, 129, 0.12)', 
                                  padding: '0.25rem 0.65rem', 
                                  borderRadius: '12px',
                                  border: '1px solid rgba(16, 185, 129, 0.3)'
                                }}>
                                  <Check size={12} /> {isAutoSaveEnabled ? 'Auto-Saved' : 'Saved'}
                                </span>
                              ) : (
                                <span style={{ 
                                  fontSize: '0.74rem', 
                                  color: 'var(--warning)', 
                                  background: 'rgba(245, 158, 11, 0.12)', 
                                  padding: '0.25rem 0.65rem', 
                                  borderRadius: '12px',
                                  border: '1px solid rgba(245, 158, 11, 0.3)'
                                }}>
                                  {isEditing && hasSavedReview ? 'Editing Review' : 'Needs Review'}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Crowd Consensus Bar from All Classmates */}
                          <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Batch Consensus:</span>
                              <strong style={{ color: vibeData.dominantVibe === 'STRICT' ? '#f87171' : vibeData.dominantVibe === 'CHILL' ? '#34d399' : 'var(--warning)' }}>
                                {vibeData.dominantVibe === 'STRICT' ? '⚡ Strict Faculty' : vibeData.dominantVibe === 'CHILL' ? '☕ Chill / Relaxed' : '⚖️ Normal Attendance'}
                              </strong>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              <span>Strict: {vibeData.strictCount}</span>
                              <span>•</span>
                              <span>Normal: {vibeData.neutralCount}</span>
                              <span>•</span>
                              <span>Chill: {vibeData.chillCount}</span>
                              <span>({vibeData.totalVibeVotes} classmates)</span>
                            </div>
                          </div>

                          {/* CONDITIONAL RENDER: SAVED VIEW vs EDIT VIEW */}
                          {!isEditing && hasSavedReview ? (
                            /* ================= SAVED (LOCKED) MODE ================= */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Your Rating:</span>
                                  <strong style={{ color: savedTier.color }}>{savedTier.label} ({savedTier.pct}%)</strong>
                                </div>
                                <div style={{ height: '7px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                  <div style={{ width: `${savedTier.pct}%`, height: '100%', background: savedTier.color, borderRadius: '4px' }} />
                                </div>
                              </div>

                              {vibeData.myReviewText ? (
                                <div style={{ 
                                  padding: '0.75rem 0.85rem', 
                                  borderRadius: '8px', 
                                  background: 'rgba(255,255,255,0.03)', 
                                  borderLeft: `3px solid ${savedTier.color}`,
                                  fontSize: '0.82rem',
                                  color: 'var(--text-primary)',
                                  lineHeight: 1.5,
                                  fontStyle: 'italic'
                                }}>
                                  &ldquo;{vibeData.myReviewText}&rdquo;
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                                  No written advice or policy note added.
                                </span>
                              )}

                              {/* Action Button: EDIT REVIEW ONLY (Save button is NOT shown here) */}
                              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingReviewForm(prev => ({
                                      ...prev,
                                      [normCode]: {
                                        vibe: vibeData.myVibe || 'STRICT',
                                        text: vibeData.myReviewText || ''
                                      }
                                    }));
                                    setEditingFacultyReview(prev => ({ ...prev, [normCode]: true }));
                                  }}
                                  style={{
                                    padding: '0.45rem 1rem',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'rgba(255,255,255,0.06)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.82rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    transition: 'var(--transition-smooth)'
                                  }}
                                >
                                  <Edit size={13} />
                                  <span>Edit Review</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ================= EDIT / SUBMIT MODE ================= */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              {/* 5 Strictness Tier Selector with Emojis */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>Select Strictness:</span>
                                  <strong style={{ color: selectedTier.color }}>{selectedTier.label} ({selectedTier.pct}%)</strong>
                                </div>

                                <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                  <div style={{ width: `${selectedTier.pct}%`, height: '100%', background: selectedTier.color, borderRadius: '3px', transition: 'width 0.25s ease' }} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.35rem', marginTop: '0.25rem' }}>
                                  {strictnessTiers.map((tier) => {
                                    const isChosen = curForm.vibe === tier.key;
                                    const [emoji, ...wordParts] = tier.label.split(' ');
                                    const textPart = wordParts.join(' ');

                                    return (
                                      <button
                                        key={tier.key}
                                        type="button"
                                        onClick={() => {
                                          setPendingReviewForm(prev => ({
                                            ...prev,
                                            [normCode]: { ...curForm, vibe: tier.key }
                                          }));
                                          if (isAutoSaveEnabled) {
                                            handleSaveFacultyReview(sub.name, tier.key, curForm.text);
                                          } else {
                                            setUnsavedChanges(prev => ({ ...prev, [normCode]: true }));
                                          }
                                        }}
                                        style={{
                                          padding: '0.5rem 0.2rem',
                                          borderRadius: '6px',
                                          border: `1px solid ${isChosen ? tier.color : 'var(--border-color)'}`,
                                          background: isChosen ? `${tier.color}25` : 'rgba(255,255,255,0.03)',
                                          color: isChosen ? tier.color : 'var(--text-secondary)',
                                          cursor: 'pointer',
                                          transition: 'all 0.15s ease',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          gap: '0.15rem'
                                        }}
                                      >
                                        <span style={{ fontSize: '1rem' }}>{emoji}</span>
                                        <span style={{ fontSize: '0.67rem', fontWeight: isChosen ? 800 : 500, whiteSpace: 'nowrap' }}>
                                          {textPart}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Written Advice Textarea */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  Attendance Policy & Classroom Intel:
                                </label>
                                <textarea
                                  rows={2}
                                  placeholder="e.g. Roll call in first 5 mins, strict about latecomers, allows genuine proxy..."
                                  value={curForm.text}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPendingReviewForm(prev => ({
                                      ...prev,
                                      [normCode]: { ...curForm, text: val }
                                    }));
                                    if (!isAutoSaveEnabled) {
                                      setUnsavedChanges(prev => ({ ...prev, [normCode]: true }));
                                    }
                                  }}
                                  onBlur={() => {
                                    if (isAutoSaveEnabled && curForm.text !== (vibeData.myReviewText || '')) {
                                      handleSaveFacultyReview(sub.name, curForm.vibe, curForm.text);
                                    }
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '0.6rem 0.75rem',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'rgba(0,0,0,0.25)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.82rem',
                                    resize: 'vertical',
                                    fontFamily: 'inherit'
                                  }}
                                />
                              </div>

                              {/* Action Buttons */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                                  {isAutoSaveEnabled ? (
                                    <span style={{ color: '#34d399' }}>✨ Changes auto-save live</span>
                                  ) : hasUnsavedCardEdits ? (
                                    <span style={{ color: 'var(--warning)' }}>⚠️ Unsaved edits in this card</span>
                                  ) : (
                                    <span>All edits saved</span>
                                  )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  {hasSavedReview && (
                                    <button
                                      type="button"
                                      disabled={isSaving}
                                      onClick={() => {
                                        setEditingFacultyReview(prev => ({ ...prev, [normCode]: false }));
                                        setUnsavedChanges(prev => {
                                          const next = { ...prev };
                                          delete next[normCode];
                                          return next;
                                        });
                                      }}
                                      style={{
                                        padding: '0.45rem 0.9rem',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        background: 'transparent',
                                        color: 'var(--text-secondary)',
                                        fontSize: '0.8rem',
                                        cursor: isSaving ? 'not-allowed' : 'pointer'
                                      }}
                                    >
                                      {isAutoSaveEnabled ? 'Done' : 'Cancel'}
                                    </button>
                                  )}

                                  {!isAutoSaveEnabled && (
                                    <button
                                      type="button"
                                      disabled={isSaving}
                                      onClick={() => handleSaveFacultyReview(sub.name, curForm.vibe, curForm.text)}
                                      style={{
                                        padding: '0.5rem 1.1rem',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: 'var(--primary)',
                                        color: '#ffffff',
                                        fontSize: '0.82rem',
                                        fontWeight: 700,
                                        cursor: isSaving ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                        boxShadow: '0 0 15px var(--primary-glow)'
                                      }}
                                    >
                                      {isSaving ? (
                                        <span>Saving...</span>
                                      ) : (
                                        <>
                                          <Check size={14} />
                                          <span>{hasSavedReview ? 'Save Class' : 'Save Class'}</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Recent Anonymous Batchmate Tips (if any) */}
                          {vibeData.recentNotes && vibeData.recentNotes.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                                Batchmate Intel ({vibeData.recentNotes.length})
                              </span>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.4rem' }}>
                                {vibeData.recentNotes.slice(0, 2).map((note, idx) => (
                                  <div key={idx} style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: '0.4rem 0.6rem', borderRadius: '5px' }}>
                                    &bull; {note.text}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Floating Action Bar when Auto-Save is OFF and Unsaved Changes exist */}
                  {!isAutoSaveEnabled && unsavedCount > 0 && (
                    <div 
                      style={{
                        position: 'sticky',
                        bottom: '1.25rem',
                        alignSelf: 'center',
                        zIndex: 100,
                        background: 'rgba(17, 23, 38, 0.95)',
                        backdropFilter: 'blur(16px)',
                        border: '1px solid rgba(245, 158, 11, 0.45)',
                        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(245, 158, 11, 0.2)',
                        borderRadius: '30px',
                        padding: '0.65rem 1.4rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1.25rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--warning)', fontWeight: 600 }}>
                        <AlertCircle size={16} />
                        <span>You have <strong>{unsavedCount}</strong> unsaved class review{unsavedCount > 1 ? 's' : ''}</span>
                      </div>
                      <button
                        type="button"
                        disabled={isSavingAll}
                        onClick={handleSaveAllFacultyReviews}
                        className="btn-primary"
                        style={{ padding: '0.45rem 1.25rem', fontSize: '0.82rem', fontWeight: 700, borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                      >
                        <Save size={14} />
                        <span>{isSavingAll ? 'Saving All...' : 'Save All Classes Now'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </main>

      {/* =========================================================================
         UI MODALS
         ========================================================================= */}
      {/* Modal 0: Unsaved Faculty Reviews Prompt */}
      {unsavedPromptModal.open && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="glass-card modal-card" style={{ maxWidth: '460px', border: '1px solid rgba(245, 158, 11, 0.45)', boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 25px rgba(245, 158, 11, 0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.15rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--warning)', flexShrink: 0 }}>
                <AlertCircle size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>Save Reviews Before Leaving?</h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Auto-save is currently turned off</span>
              </div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 1.35rem 0' }}>
              You have unsaved changes in your faculty ratings or classroom intel. Would you like to save all your changes across all classes before switching tabs?
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <button
                type="button"
                disabled={isSavingAll}
                onClick={async () => {
                  await handleSaveAllFacultyReviews();
                  if (unsavedPromptModal.targetTab) {
                    setActiveTab(unsavedPromptModal.targetTab);
                  }
                  setUnsavedPromptModal({ open: false, targetTab: null });
                }}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Save size={16} />
                <span>{isSavingAll ? 'Saving All Classes...' : 'Save All & Switch Tab'}</span>
              </button>

              <button
                type="button"
                disabled={isSavingAll}
                onClick={() => {
                  setUnsavedChanges({});
                  if (unsavedPromptModal.targetTab) {
                    setActiveTab(unsavedPromptModal.targetTab);
                  }
                  setUnsavedPromptModal({ open: false, targetTab: null });
                }}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: 'var(--border-radius-sm)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  background: 'rgba(239, 68, 68, 0.08)',
                  color: '#f87171',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'var(--transition-smooth)'
                }}
              >
                Discard Changes & Leave
              </button>

              <button
                type="button"
                disabled={isSavingAll}
                onClick={() => setUnsavedPromptModal({ open: false, targetTab: null })}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: 'var(--border-radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                Keep Editing (Stay Here)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 1: Add Subject */}
      {showAddSubject && (
        <div className="modal-overlay">
          <div className="glass-card modal-card">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem' }}>Add Subject</h3>
              <button style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }} onClick={() => setShowAddSubject(false)}>
                <X size={20} />
              </button>
            </div>
            
            {subjectError && (
              <div className="toast toast-error" style={{ marginBottom: '1rem' }}>
                {subjectError}
              </div>
            )}

            <form onSubmit={handleAddSubject}>
              <div className="form-group">
                <label className="form-label">Subject Name</label>
                <input
                  className="form-input"
                  type="text"
                  list="subject-names-list"
                  placeholder="e.g. Mathematics III"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="planner-select"
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as any)}
                >
                  <option value="LECTURE">Lecture</option>
                  <option value="LAB">Lab</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Target Goal Percentage ({addTarget}%)</label>
                <input
                  type="range"
                  className="custom-range-input"
                  min="50"
                  max="100"
                  step="5"
                  value={addTarget}
                  onChange={(e) => setAddTarget(parseInt(e.target.value))}
                />
              </div>

              <button className="btn-primary" type="submit" disabled={isSubmittingSubject} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                {isSubmittingSubject ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Creating Subject...</span>
                  </>
                ) : (
                  <span>Create Subject</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add Semester */}
      {showAddSemester && (
        <div className="modal-overlay">
          <div className="glass-card modal-card">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem' }}>Create New Semester</h3>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => setShowAddSemester(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddSemester}>
              <div className="form-group">
                <label className="form-label">Semester / Term Name</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g., 2nd Semester, Fall 2026"
                  value={addSemName}
                  onChange={(e) => setAddSemName(e.target.value)}
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>
                  *Note: Creating a new semester will set the current one to inactive. Your past records are saved in the History Archives.
                </span>
              </div>

              <button className="btn-primary" type="submit">
                Create Semester
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Add Timetable Slot manually */}
      {showAddSlot && (
        <div className="modal-overlay">
          <div className="glass-card modal-card">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem' }}>Schedule Class ({slotDay})</h3>
              <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => setShowAddSlot(false)}>
                <X size={20} />
              </button>
            </div>
            
            {error && (
              <div className="toast toast-error" style={{ marginBottom: '1rem' }}>
                {error}
              </div>
            )}
            
            <form onSubmit={handleCreateSlot}>
              <div className="form-group">
                <div className="flex-between" style={{ marginBottom: '0.4rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Subject</label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSlot(false);
                      setShowAddSubject(true);
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--secondary)', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: 0 }}
                  >
                    <Plus size={13} /> Add New Subject
                  </button>
                </div>
                <select
                  className="planner-select"
                  value={slotSubjectId}
                  onChange={(e) => setSlotSubjectId(e.target.value)}
                  required
                >
                  {subjects.map((sub: any) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name} ({sub.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="form-label">Start Time</label>
                  <input
                    className="form-input"
                    type="time"
                    value={slotStartTime}
                    onChange={(e) => setSlotStartTime(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="form-label">End Time</label>
                  <input
                    className="form-input"
                    type="time"
                    value={slotEndTime}
                    onChange={(e) => setSlotEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button className="btn-primary" type="submit" style={{ marginTop: '0.5rem' }}>
                Schedule Class
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Import Friend's Timetable */}
      {showImportCodeModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem' }}>Import Friend&apos;s Routine</h3>
              <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => setShowImportCodeModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleImportFriendTimetable}>
              <div className="form-group">
                <label className="form-label">Friend&apos;s Share Code</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 4A2E5D9C"
                  value={friendShareCodeInput}
                  onChange={(e) => setFriendShareCodeInput(e.target.value)}
                  style={{ textTransform: 'uppercase' }}
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>
                  *Note: Importing a friend&apos;s routine will update your weekly class schedule slots. Your existing subjects and logged attendance history will be preserved.
                </span>
              </div>

              <button
                className="btn-primary"
                type="submit"
                disabled={isLoading}
                style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {isLoading ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Importing...</span>
                  </>
                ) : (
                  <span>Import Timetable</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Timetable Upload Wizard */}
      {showWizardModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-card">
            <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.3rem' }}>Timetable Scan Wizard</h3>
              <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => {
                setShowWizardModal(false);
                setPendingTimetableFile(null);
              }}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleWizardSubmit}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>
                We analyzed your routine and detected multiple streams or lab groups. Please select your configuration to filter the import:
              </p>

              <div className="form-group">
                <label className="form-label">Select Stream / Branch / Class / Section</label>
                <select
                  className="planner-select"
                  value={selectedStream}
                  onChange={(e) => setSelectedStream(e.target.value)}
                  required
                >
                  {detectedStreams.map((stream) => (
                    <option key={stream} value={stream}>{stream}</option>
                  ))}
                  <option value="__CUSTOM__">Other (Enter your branch/class manually...)</option>
                </select>
                {selectedStream === '__CUSTOM__' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. BCA, CSE 3, AIML, IT, ECE..."
                    value={customStream}
                    onChange={(e) => setCustomStream(e.target.value)}
                    style={{ marginTop: '0.5rem' }}
                    required
                  />
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Select Lab Group / Batch</label>
                <select
                  className="planner-select"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  required
                >
                  <option value="None">None (Import all labs or no group split)</option>
                  {detectedGroups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                  <option value="__CUSTOM__">Other (Enter lab group/batch manually...)</option>
                </select>
                {selectedGroup === '__CUSTOM__' && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Group A, Grp B, Batch 1..."
                    value={customGroup}
                    onChange={(e) => setCustomGroup(e.target.value)}
                    style={{ marginTop: '0.5rem' }}
                    required
                  />
                )}
              </div>

              <button className="btn-primary" type="submit" style={{ marginTop: '0.5rem' }}>
                Confirm & Import Routine
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 6: Review Extracted Routine */}
      {showReviewModal && (() => {
        return (
          <div className="modal-overlay">
            <div className="glass-card modal-card" style={{ maxWidth: '750px', width: '90%' }}>
              <div className="flex-between" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.3rem' }}>Verify Routine Schedule</h3>
                <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }} onClick={() => {
                  setShowReviewModal(false);
                  setReviewSlots([]);
                }}>
                  <X size={20} />
                </button>
              </div>
              
              <form onSubmit={handleSaveVerifiedTimetable}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', lineHeight: 1.5 }}>
                  Review and verify your routine schedule below. You can select existing subjects or type in your own (autocomplete suggestions will appear as you type). All days and times are fully editable.
                </p>

                {error && (
                  <div className="toast toast-error" style={{ marginBottom: '1rem' }}>
                    {error}
                  </div>
                )}

                <div style={{ maxHeight: '380px', overflowY: 'auto', overflowX: 'auto', marginBottom: '1rem', paddingRight: '0.5rem' }}>
                  <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Day</th>
                        <th style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Subject Name</th>
                        <th style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Type</th>
                        <th style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Start</th>
                        <th style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>End</th>
                        <th style={{ padding: '0.5rem', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewSlots.map((slot, index) => (
                        <tr key={slot.keyId} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '0.25rem' }}>
                            <select
                               className="planner-select"
                              value={slot.dayOfWeek}
                              onChange={(e) => handleUpdateReviewSlot(index, 'dayOfWeek', e.target.value)}
                              style={{ padding: '0.3rem', fontSize: '0.75rem', minWidth: '100px' }}
                              required
                            >
                              <option value="MONDAY">Mon</option>
                              <option value="TUESDAY">Tue</option>
                              <option value="WEDNESDAY">Wed</option>
                              <option value="THURSDAY">Thu</option>
                              <option value="FRIDAY">Fri</option>
                              <option value="SATURDAY">Sat</option>
                              <option value="SUNDAY">Sun</option>
                            </select>
                          </td>
                          <td style={{ padding: '0.25rem' }}>
                            <input
                              type="text"
                              list="subject-names-list"
                              className="form-input"
                              value={slot.subjectName}
                              onChange={(e) => handleUpdateReviewSlot(index, 'subjectName', e.target.value)}
                              placeholder="e.g. Computer Architecture"
                              style={{
                                padding: '0.3rem 0.5rem',
                                fontSize: '0.75rem',
                                width: '100%',
                                minWidth: '150px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--border-radius-sm)',
                                color: 'var(--text-primary)'
                              }}
                              required
                            />
                          </td>
                          <td style={{ padding: '0.25rem' }}>
                            <select
                               className="planner-select"
                              value={slot.type}
                              onChange={(e) => handleUpdateReviewSlot(index, 'type', e.target.value)}
                              style={{ padding: '0.3rem', fontSize: '0.75rem' }}
                              required
                            >
                              <option value="LECTURE">Lecture</option>
                              <option value="LAB">Lab</option>
                            </select>
                          </td>
                          <td style={{ padding: '0.25rem' }}>
                            <input
                              type="time"
                              className="form-input"
                              value={slot.startTime}
                              onChange={(e) => handleUpdateReviewSlot(index, 'startTime', e.target.value)}
                              style={{
                                padding: '0.3rem',
                                fontSize: '0.75rem',
                                width: '90px',
                                textAlign: 'center',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--border-radius-sm)',
                                color: 'var(--text-primary)'
                              }}
                              required
                            />
                          </td>
                          <td style={{ padding: '0.25rem' }}>
                            <input
                              type="time"
                              className="form-input"
                              value={slot.endTime}
                              onChange={(e) => handleUpdateReviewSlot(index, 'endTime', e.target.value)}
                              style={{
                                padding: '0.3rem',
                                fontSize: '0.75rem',
                                width: '90px',
                                textAlign: 'center',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--border-radius-sm)',
                                color: 'var(--text-primary)'
                              }}
                              required
                            />
                          </td>
                          <td style={{ padding: '0.25rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteReviewSlot(index)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.25rem' }}
                              title="Delete Slot"
                            >
                              <Trash size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={handleAddReviewSlot}
                    style={{ width: 'auto', padding: '0.5rem 1.25rem', fontSize: '0.8rem' }}
                  >
                    + Add Class Slot
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={isOcrLoading}
                    style={{ width: 'auto', padding: '0.5rem 1.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    {isOcrLoading ? (
                      <>
                        <div style={{ width: '14px', height: '14px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Timetable & Apply</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal 7: Routine Update Notice for CAC 3 / CSE 3 */}
      {showRoutineNotice && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div 
            className="glass-card modal-card" 
            style={{ 
              maxWidth: '560px', 
              width: '94%', 
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 'clamp(1.2rem, 3.5vw, 2rem)',
              position: 'relative',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 35px rgba(99, 102, 241, 0.25)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              animation: 'fadeIn 0.25s ease'
            }}
          >
            <button 
              type="button" 
              onClick={handleCloseNoticeCross}
              style={{ 
                position: 'absolute', 
                top: '1.25rem', 
                right: '1.25rem', 
                background: 'transparent', 
                border: 'none', 
                color: 'var(--text-secondary)', 
                cursor: 'pointer',
                padding: '0.25rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition-smooth)'
              }}
              title="Close notice"
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.25rem' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--secondary)',
                boxShadow: '0 0 15px rgba(99, 102, 241, 0.3)'
              }}>
                <Bell size={22} />
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--secondary)' }}>
                  Semester Schedule Notice
                </span>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Class Routine Changed (Effective Monday, Sep 14)
                </h3>
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.08))',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              borderRadius: 'var(--border-radius-md)',
              padding: '1.15rem',
              marginBottom: '1.25rem'
            }}>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.35rem' }}>
                Are you in <span style={{ color: 'var(--secondary)' }}>CSE 3</span>?
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
                Our college class timetable has been officially revised and takes effect from <strong>Monday, September 14, 2026</strong>. Past attendance dates (including yesterday Friday, Sep 11) retain your previous schedule. If you are in <strong>CSE 3</strong>, you can apply your full verified schedule in 1 click.
              </p>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--border-radius-sm)',
              padding: '0.9rem',
              marginBottom: '1.5rem',
              fontSize: '0.78rem'
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Calendar size={14} style={{ color: 'var(--secondary)' }} />
                <span>Verified CSE 3 Highlights:</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <li><strong>Effective From:</strong> Monday, September 14, 2026</li>
                <li><strong>Mon:</strong> OS, CG/AI, SE + OOP Lab (12:45 – 17:30)</li>
                <li><strong>Tue:</strong> OS Lab (09:30 – 13:45) + Compiler, CG/AI, OOP</li>
                <li><strong>Wed:</strong> 4 Morning Lectures • Afternoon Campus Drive Free</li>
                <li><strong>Thu:</strong> IM, OOP, Constitution + S/W Engg Lab</li>
                <li><strong>Fri (Sep 18+):</strong> Full 7-period schedule (Previous 4-period schedule preserved for Sep 11)</li>
              </ul>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-outline"
                onClick={handleDismissNoticeOtherBranch}
                style={{ width: 'auto', padding: '0.55rem 1.2rem', fontSize: '0.82rem' }}
              >
                No, I&apos;m from another branch
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={isApplyingRoutine}
                onClick={handleApplyOfficialCse3Routine}
                style={{
                  width: 'auto',
                  padding: '0.55rem 1.4rem',
                  fontSize: '0.82rem',
                  background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                  boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontWeight: 600
                }}
              >
                {isApplyingRoutine ? (
                  <>
                    <div style={{ width: '13px', height: '13px', border: '2px solid transparent', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Applying...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Yes, Apply CSE 3 Routine</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sticky Routine Notice Badge */}
      {isLoggedIn && isUserEligibleForRoutineNotice(currentUser) && routineNoticeStatus !== 'dismissed_other_branch' && routineNoticeStatus !== 'applied_cse3' && routineNoticeStatus !== 'new_account' && (
        <div 
          onClick={() => setShowRoutineNotice(true)}
          title="Click to view & apply new CSE 3 timetable notice"
          style={{
            position: 'fixed',
            bottom: 'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.8rem))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9980,
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(99, 102, 241, 0.45)',
            borderRadius: '30px',
            padding: '0.5rem 1.15rem',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 16px rgba(99, 102, 241, 0.25)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            maxWidth: 'calc(100vw - 1.5rem)',
            width: 'max-content',
          }}
        >
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10b981',
            boxShadow: '0 0 8px #10b981',
            animation: 'pulse 1.5s infinite'
          }} />
          <span style={{ fontSize: '0.8rem', color: '#f1f5f9', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Notice: CSE 3 Routine (Effective Sep 14)
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--secondary)', fontWeight: 600, textDecoration: 'underline' }}>
            View &amp; Apply &rarr;
          </span>
        </div>
      )}

      {/* Modal 8: Subject Full Attendance History */}
      {selectedSubjectForHistory && (() => {
        // Find subject reactively in case attendance was updated
        const activeSub: Subject =
          subjects.find((s: Subject) => s.id === selectedSubjectForHistory.id) ||
          ((teacherViewingData as any)?.subjects?.find((s: any) => s.id === selectedSubjectForHistory.id)) ||
          selectedSubjectForHistory;

        const rawLogs: Array<{ id: string; date: string; status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' }> = activeSub.logs || [];
        const presentCount = rawLogs.filter((l) => l.status === 'PRESENT').length;
        const absentCount = rawLogs.filter((l) => l.status === 'ABSENT').length;
        const holidayCount = rawLogs.filter((l) => l.status === 'HOLIDAY').length;
        const totalCount = rawLogs.length;

        const filteredLogs = rawLogs.filter((l) => {
          if (historyStatusFilter === 'ALL') return true;
          return l.status === historyStatusFilter;
        });

        // Default sort: Chronological from start of semester to present (asc: oldest first)
        const sortedLogs = [...filteredLogs].sort((a, b) => {
          const timeA = new Date(a.date).getTime() || 0;
          const timeB = new Date(b.date).getTime() || 0;
          return historySortAsc ? timeA - timeB : timeB - timeA;
        });

        return (
          <div 
            className="modal-overlay" 
            onClick={() => setSelectedSubjectForHistory(null)}
            style={{ zIndex: 11000 }}
          >
            <div 
              className="glass-card modal-card" 
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '94%',
                maxWidth: '560px',
                maxHeight: '88vh',
                display: 'flex',
                flexDirection: 'column',
                padding: 'clamp(1.2rem, 3.5vw, 1.75rem)',
                gap: '1rem',
                boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.2)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                animation: 'fadeIn 0.25s ease'
              }}
            >
              {/* Modal Header */}
              <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, paddingRight: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                    <span className={`subject-badge ${activeSub.type.toLowerCase()}`}>
                      {activeSub.type}
                    </span>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      color: 'var(--text-muted)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.3rem',
                      fontWeight: 500
                    }}>
                      <History size={12} /> Full Attendance History
                    </span>
                  </div>
                  <h3 style={{ fontSize: '1.35rem', lineHeight: 1.2, margin: 0, wordBreak: 'break-word' }}>
                    {activeSub.name}
                  </h3>
                </div>
                <button
                  type="button"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    borderRadius: '50%',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                  onClick={() => setSelectedSubjectForHistory(null)}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Attendance Stat Summary Cards */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '0.5rem',
                background: 'rgba(0, 0, 0, 0.25)',
                padding: '0.75rem 0.5rem',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--border-color)'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '1.25rem', 
                    fontWeight: 700, 
                    color: activeSub.stats.percentage >= activeSub.targetPercentage ? 'var(--success)' : 'var(--danger)' 
                  }}>
                    {activeSub.stats.percentage}%
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Attendance</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>
                    {presentCount}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Present</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)' }}>
                    {absentCount}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Absent</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--warning)' }}>
                    {holidayCount}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Holiday</div>
                </div>
              </div>

              {/* Filter Pills & Sort Toggle Toolbar */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                flexWrap: 'wrap', 
                gap: '0.5rem' 
              }}>
                {/* Status Filters */}
                <div style={{ 
                  display: 'flex', 
                  background: 'rgba(0, 0, 0, 0.25)', 
                  padding: '0.2rem', 
                  borderRadius: '8px', 
                  gap: '0.25rem',
                  overflowX: 'auto',
                  maxWidth: '100%'
                }}>
                  {(['ALL', 'PRESENT', 'ABSENT', 'HOLIDAY'] as const).map((filterVal) => {
                    const count = 
                      filterVal === 'ALL' ? totalCount :
                      filterVal === 'PRESENT' ? presentCount :
                      filterVal === 'ABSENT' ? absentCount : holidayCount;
                    const isActive = historyStatusFilter === filterVal;
                    return (
                      <button
                        key={filterVal}
                        type="button"
                        onClick={() => setHistoryStatusFilter(filterVal)}
                        style={{
                          background: isActive ? 'var(--primary)' : 'transparent',
                          color: isActive ? '#fff' : 'var(--text-secondary)',
                          border: 'none',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          transition: 'var(--transition-smooth)'
                        }}
                      >
                        {filterVal === 'ALL' ? 'All' : filterVal.charAt(0) + filterVal.slice(1).toLowerCase()} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Sort Order Toggle */}
                <button
                  type="button"
                  onClick={() => setHistorySortAsc((prev) => !prev)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '8px',
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginLeft: 'auto'
                  }}
                  title="Toggle chronological sort order"
                >
                  <ArrowUpDown size={12} />
                  <span>{historySortAsc ? 'Start → Present' : 'Present → Start'}</span>
                </button>
              </div>

              {/* Scrollable Log Entries List */}
              <div style={{
                overflowY: 'auto',
                flex: 1,
                maxHeight: '44vh',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem',
                paddingRight: '0.2rem'
              }}>
                {sortedLogs.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '2.5rem 1rem',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem'
                  }}>
                    <BookOpen size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
                    <p>No {historyStatusFilter !== 'ALL' ? historyStatusFilter.toLowerCase() : ''} attendance logs recorded yet.</p>
                  </div>
                ) : (
                  sortedLogs.map((log, index) => {
                    const dateInfo = formatLogDateTime(log.date);
                    const isPresent = log.status === 'PRESENT';
                    const isAbsent = log.status === 'ABSENT';
                    const isHoliday = log.status === 'HOLIDAY';

                    return (
                      <div
                        key={log.id || `${log.date}-${index}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.65rem 0.85rem',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '10px',
                          gap: '0.75rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <div style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: isPresent ? 'rgba(16, 185, 129, 0.15)' :
                                        isAbsent ? 'rgba(239, 68, 68, 0.15)' :
                                        'rgba(245, 158, 11, 0.15)',
                            color: isPresent ? 'var(--success)' :
                                   isAbsent ? 'var(--danger)' :
                                   'var(--warning)',
                            flexShrink: 0
                          }}>
                            {isPresent && <Check size={15} />}
                            {isAbsent && <X size={15} />}
                            {isHoliday && <Sun size={15} />}
                          </div>
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {dateInfo.formattedDate}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>Class #{historySortAsc ? index + 1 : sortedLogs.length - index}</span>
                              {dateInfo.timePart && (
                                <>
                                  <span>•</span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                    <Clock size={10} /> {dateInfo.timePart}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <span
                          style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '20px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            background: isPresent ? 'rgba(16, 185, 129, 0.12)' :
                                        isAbsent ? 'rgba(239, 68, 68, 0.12)' :
                                        'rgba(245, 158, 11, 0.12)',
                            border: `1px solid ${
                              isPresent ? 'rgba(16, 185, 129, 0.3)' :
                              isAbsent ? 'rgba(239, 68, 68, 0.3)' :
                              'rgba(245, 158, 11, 0.3)'
                            }`,
                            color: isPresent ? 'var(--success)' :
                                   isAbsent ? 'var(--danger)' :
                                   'var(--warning)',
                            flexShrink: 0
                          }}
                        >
                          {log.status}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer */}
              <div style={{ 
                borderTop: '1px solid var(--border-color)', 
                paddingTop: '0.75rem', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}>
                <span>Showing {sortedLogs.length} of {totalCount} total logged classes</span>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: 'auto', padding: '0.4rem 0.9rem', fontSize: '0.8rem' }}
                  onClick={() => setSelectedSubjectForHistory(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Offline Status indicator banner */}
      {(isBrowserOffline || isOfflineSyncPending) && (
        <div 
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            background: isBrowserOffline ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${isBrowserOffline ? 'var(--danger)' : 'var(--warning)'}`,
            borderRadius: 'var(--border-radius-md)',
            padding: '0.75rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            zIndex: 9999,
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            boxShadow: 'var(--shadow-main)',
            animation: 'fadeIn 0.3s ease'
          }}
        >
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isBrowserOffline ? 'var(--danger)' : 'var(--warning)',
            animation: 'pulse 1.5s infinite'
          }} />
          <span style={{ fontWeight: 500 }}>
            {isBrowserOffline 
              ? 'Working Offline (Saved logs will sync online)' 
              : 'Syncing local logs...'}
          </span>
        </div>
      )}

      <datalist id="subject-names-list">
        {(() => {
          const presetSuggestions = [
            { name: "Operating Systems", search: "OS, Operating System" },
            { name: "Object Oriented Programming", search: "OOP, Object-Oriented Programming" },
            { name: "Compiler Design", search: "CD, Compiler design" },
            { name: "Software Engineering", search: "SE, Software Engineering" },
            { name: "Introduction to Industrial Management", search: "IIM, Industrial Management" },
            { name: "Constitution of India", search: "COI, Constitution of India" },
            { name: "Artificial Intelligence", search: "AI, Artificial Intelligence" },
            { name: "Computer Graphics", search: "CG, Computer Graphics" },
            { name: "Software Engineering Lab", search: "SE Lab, Software Engineering Lab" },
            { name: "Operating Systems Lab", search: "OS Lab, Operating Systems Lab" },
            { name: "Object Oriented Programming Lab", search: "OOP Lab, Object Oriented Programming Lab" },
            { name: "Database Management Systems", search: "DBMS, Database Management Systems" },
            { name: "Database Management Systems Lab", search: "DBMS Lab, Database Management Systems Lab" },
            { name: "Computer Networks", search: "CN, Computer Networks" },
            { name: "Computer Networks Lab", search: "CN Lab, Computer Networks Lab" },
            { name: "Design and Analysis of Algorithms", search: "DAA, Design and Analysis of Algorithms" },
            { name: "Design and Analysis of Algorithms Lab", search: "DAA Lab, Design and Analysis of Algorithms Lab" },
            { name: "Data Structures and Algorithms", search: "DSA, Data Structures and Algorithms" },
            { name: "Theory of Computation", search: "TOC, Theory of Computation, Automata" },
            { name: "Web Technology", search: "WT, Web Technology, Web Dev" },
            { name: "Web Technology Lab", search: "WT Lab, Web Technology Lab, Web Dev Dev" },
            { name: "Machine Learning", search: "ML, Machine Learning" }
          ];

          const userSubjectNames = subjects.map(s => s.name);
          const allSuggestions = [
            ...presetSuggestions,
            ...userSubjectNames.filter(name => !presetSuggestions.some(p => p.name.toLowerCase() === name.toLowerCase())).map(name => ({ name, search: name }))
          ];

          return allSuggestions.map((item) => (
            <option key={item.name} value={item.name}>
              {item.search}
            </option>
          ));
        })()}
      </datalist>
    </div>
  );
}
