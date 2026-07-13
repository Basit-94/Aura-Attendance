'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
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
  TrendingUp,
  FileText,
  Sliders,
  Sun,
  Moon,
  Edit
} from 'lucide-react';

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

export default function Home() {
  // Global Mock Mode Check
  const isMockMode = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

  // App Toggles
  const [authMode, setAuthMode] = useState<'STUDENT' | 'TEACHER'>('STUDENT');
  const [studentSubMode, setStudentSubMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; uniqueCode: string } | null>(null);

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
  const [selectedGroup, setSelectedGroup] = useState('');

  // Timetable review editor states
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewSlots, setReviewSlots] = useState<any[]>([]);

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
  const [copiedCode, setCopiedCode] = useState(false);
  const [inFlightChecks, setInFlightChecks] = useState<Record<string, boolean>>({});

  // Predictor Slider state
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [bunkCount, setBunkCount] = useState(0);

  // Modals
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState<'LECTURE' | 'LAB'>('LECTURE');
  const [addTarget, setAddTarget] = useState(75);

  const [showAddSemester, setShowAddSemester] = useState(false);
  const [addSemName, setAddSemName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom Criteria Thresholds
  const [criteriaA, setCriteriaA] = useState<number>(75);
  const [criteriaB, setCriteriaB] = useState<number>(60);

  // Theme Toggle state
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Teacher Edit PIN states
  const [teacherEditPin, setTeacherEditPin] = useState('');
  const [enteredEditPin, setEnteredEditPin] = useState('');
  const [isTeacherEditingUnlocked, setIsTeacherEditingUnlocked] = useState(false);

  // Multi-day Bunk Simulator state
  const [bunkProjectionDays, setBunkProjectionDays] = useState<number>(3);

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

    const savedTheme = localStorage.getItem('aura_theme') || 'dark';
    setTheme(savedTheme as 'dark' | 'light');
    document.documentElement.classList.toggle('light', savedTheme === 'light');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('aura_theme', newTheme);
    document.documentElement.classList.toggle('light', newTheme === 'light');
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

  // Quick Check-in Actions
  const handleCheckIn = async (subjectId: string, status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' | 'REMOVE') => {
    if (inFlightChecks[subjectId]) return;
    setInFlightChecks((prev) => ({ ...prev, [subjectId]: true }));
    
    // Optimistic Update
    const previousSubjects = [...subjects];
    setSubjects(prevSubjects => {
      return prevSubjects.map(sub => {
        if (sub.id !== subjectId) return sub;

        const todayDateStr = new Date().toISOString().split('T')[0];
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
            updatedLogs = [{ id: `temp-${Date.now()}`, date: new Date().toISOString(), status }, ...updatedLogs];
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
            present: newPresent,
            absent: newAbsent,
            holiday: newHoliday,
            total: newTotal,
            percentage: Math.round(newPercentage * 10) / 10
          }
        };
      });
    });

    try {
      const res = await fetch('/api/attendance/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          date: new Date().toISOString().split('T')[0], // Log for today's calendar date
          status,
        }),
      });
      if (!res.ok) {
        // Rollback on error
        setSubjects(previousSubjects);
      } else {
        await fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
      // Rollback on error
      setSubjects(previousSubjects);
    } finally {
      setInFlightChecks((prev) => ({ ...prev, [subjectId]: false }));
    }
  };

  const handleTeacherCheckIn = async (subjectId: string, status: 'PRESENT' | 'ABSENT' | 'HOLIDAY' | 'REMOVE') => {
    if (!teacherViewingData || inFlightChecks[subjectId]) return;
    setInFlightChecks((prev) => ({ ...prev, [subjectId]: true }));
    setError('');
    setSuccess('');

    // Optimistic Update for Teacher View
    const previousTeacherViewingData = teacherViewingData;
    setTeacherViewingData(prev => {
      if (!prev) return null;
      const updatedSubjects = prev.subjects.map(sub => {
        if (sub.id !== subjectId) return sub;

        const todayDateStr = new Date().toISOString().split('T')[0];
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
            updatedLogs = [{ id: `temp-${Date.now()}`, date: new Date().toISOString(), status }, ...updatedLogs];
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
          date: new Date().toISOString().split('T')[0], // Today's date only
          status,
          studentCode: teacherViewingData.studentCode,
          teacherEditPin: enteredEditPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Rollback on error
        setTeacherViewingData(previousTeacherViewingData);
        throw new Error(data.error);
      }

      setSuccess('Attendance logged successfully!');
      await refreshTeacherMirrorData();
    } catch (err: any) {
      setError(err.message || 'Failed to update attendance');
      // Rollback on error
      setTeacherViewingData(previousTeacherViewingData);
    } finally {
      setInFlightChecks((prev) => ({ ...prev, [subjectId]: false }));
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
      dates.push(d.toISOString().split('T')[0]);
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
            date: new Date().toISOString().split('T')[0],
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

  // Manual Add Subject
  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName) return;

    try {
      const res = await fetch('/api/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName, type: addType, targetPercentage: addTarget }),
      });
      if (res.ok) {
        setShowAddSubject(false);
        setAddName('');
        fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
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
        startTime: c.startTime || '09:00',
        endTime: c.endTime || '10:00',
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

    setShowWizardModal(false);
    await executeDirectUpload(pendingTimetableFile, selectedStream, selectedGroup);
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
        startTime: '09:00',
        endTime: '09:50',
        isNewSubject: true
      }
    ]);
    setShowReviewModal(true);
  };

  const handleAddReviewSlot = () => {
    console.log("[DEBUG] handleAddReviewSlot triggered. Current reviewSlots:", reviewSlots);
    const newSlot = {
      keyId: `new-${Date.now()}-${reviewSlots.length}`,
      subjectName: '',
      type: 'LECTURE',
      dayOfWeek: 'MONDAY',
      startTime: '09:00',
      endTime: '09:50',
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
      setShowReviewModal(false);
      setReviewSlots([]);
      fetchDashboardData();
    } catch (err: any) {
      setError(err.message || 'Failed to save timetable.');
    } finally {
      setIsOcrLoading(false);
    }
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
      setError('Please add at least one subject first before scheduling classes.');
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
    const todaySlots = timetable.filter((slot) => slot.dayOfWeek.toUpperCase() === todayName);
    
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
  
  // Dynamically resolve time slots based on timetable schedule data to prevent mismatches
  const sortedTimeSlots = Array.from(new Set(timetable.map((slot: any) => slot.startTime))).sort((a, b) => a.localeCompare(b));
  const TIMES = sortedTimeSlots.length > 0 ? sortedTimeSlots : ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

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
          <header className="dashboard-header">
            <div className="brand-header">
              <Calendar className="text-secondary" size={26} />
              <span className="logo-text">AuraAttend Portal</span>
              <span className="subject-badge" style={{ verticalAlign: 'middle', marginLeft: '10px' }}>Teacher Mode (Batch)</span>
            </div>
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
        <header className="dashboard-header">
          <div className="brand-header">
            <Calendar className="text-secondary" size={26} />
            <span className="logo-text">AuraAttend Portal</span>
            <span className="subject-badge" style={{ verticalAlign: 'middle', marginLeft: '10px' }}>Teacher Mode</span>
          </div>
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
                  (log) => log.date.split('T')[0] === new Date().toISOString().split('T')[0]
                );

                return (
                  <div key={sub.id} className="glass-card subject-card">
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
                          onClick={() => handleTeacherCheckIn(sub.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT')}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                          disabled={!isTeacherEditingUnlocked || inFlightChecks[sub.id]}
                          onClick={() => handleTeacherCheckIn(sub.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT')}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                          disabled={!isTeacherEditingUnlocked || inFlightChecks[sub.id]}
                          onClick={() => handleTeacherCheckIn(sub.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY')}
                          style={{ opacity: (!isTeacherEditingUnlocked || inFlightChecks[sub.id]) ? 0.5 : 1, cursor: isTeacherEditingUnlocked && !inFlightChecks[sub.id] ? 'pointer' : 'not-allowed' }}
                        >
                          Holiday
                        </button>
                      </div>
                    </div>

                    {/* Collapsible Calendar Heatmap for Teacher */}
                    <div className="calendar-heatmap-wrapper">
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Last 30 Days History:</span>
                      <div className="heatmap-grid">
                        {getLast30Days().map((dateStr) => {
                          const log = sub.logs?.find((l) => l.date.split('T')[0] === dateStr);
                          let statusClass = 'empty';
                          let tooltipText = `${dateStr}: No class`;
                          if (log) {
                            statusClass = log.status.toLowerCase();
                            tooltipText = `${dateStr}: ${log.status}`;
                          }
                          return (
                            <div 
                              key={dateStr} 
                              className={`heatmap-cell ${statusClass}`} 
                              title={tooltipText}
                            />
                          );
                        })}
                      </div>
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
        <button 
          type="button"
          onClick={toggleTheme} 
          className="btn-outline" 
          style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', width: '40px', height: '40px', padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Toggle Dark/Light Theme"
        >
          {theme === 'dark' ? <Sun size={18} className="text-warning" /> : <Moon size={18} className="text-primary" />}
        </button>
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
          <div className="glass-card auth-card">
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

                <button className="btn-primary" type="submit" disabled={isLoading}>
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
                      <span className="auth-link" onClick={() => {
                        setStudentSubMode('SIGNUP');
                        setError('');
                        setSuccess('');
                      }}>
                        Sign Up
                      </span>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <span className="auth-link" onClick={() => {
                        setStudentSubMode('LOGIN');
                        setError('');
                        setSuccess('');
                      }}>
                        Log In
                      </span>
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

                <button className="btn-primary" type="submit" disabled={isLoading}>
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
      <header className="dashboard-header">
        <div className="brand-header">
          <Calendar className="text-secondary" size={26} />
          <span className="logo-text">AuraAttend</span>
        </div>
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {viewingHistory ? (
            <button className="btn-outline" onClick={() => setViewingHistory(false)}>
              Back to Dashboard
            </button>
          ) : (
            <button className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={() => {
              setViewingHistory(true);
              fetchHistoryData();
            }}>
              <History size={16} />
              <span>History Archives</span>
            </button>
          )}

          <div className="student-info">
            <span className="student-email">{currentUser?.email}</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <span className="student-code">
                Student Code: <span style={{ fontWeight: 'bold', color: 'var(--secondary)' }}>{currentUser?.uniqueCode}</span>
                <button className="copy-btn" onClick={copyCodeToClipboard}>
                  <Copy size={12} />
                </button>
                {copiedCode && <span style={{ color: 'var(--success)', fontSize: '0.7rem' }}>Copied!</span>}
              </span>
              <span className="student-code">
                Teacher Edit PIN: <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{teacherEditPin || '----'}</span>
                <button className="copy-btn" title="Rotate PIN" onClick={rotateTeacherEditPin}>
                  <RefreshCw size={12} />
                </button>
              </span>
            </div>
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

          <button className="btn-logout" onClick={handleLogout}>
            <LogOut size={16} style={{ marginRight: '5px', verticalAlign: 'middle' }} />
            Log Out
          </button>
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
            <div className="glass-card flex-between" style={{ padding: '1rem 1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <BookOpen size={20} className="text-primary" />
                {isEditingSemesterName ? (
                  <form onSubmit={handleRenameSemester} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                  <span style={{ fontWeight: 600, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button 
                  className="btn-outline" 
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} 
                  onClick={handleExportCSV}
                  title="Export all active semester logs to CSV"
                >
                  <FileText size={14} />
                  <span>Export CSV</span>
                </button>
                <button className="btn-outline" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setShowAddSemester(true)}>
                  New Semester
                </button>
              </div>
            </div>

            {/* Today's Schedule Checklist widget */}
            {(() => {
              const todayDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date().getDay()];
              const todaySlots = timetable
                .filter((slot: any) => slot.dayOfWeek.toUpperCase() === todayDayName)
                .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));
              
              if (todaySlots.length === 0) return null;

              // Group slots by subjectId
              const groupedTodaySlots: Record<string, typeof todaySlots> = {};
              for (const slot of todaySlots) {
                if (!groupedTodaySlots[slot.subjectId]) {
                  groupedTodaySlots[slot.subjectId] = [];
                }
                groupedTodaySlots[slot.subjectId].push(slot);
              }

              const todayDateStr = new Date().toISOString().split('T')[0];

              return (
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                  <div className="flex-between">
                    <h3 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar size={20} className="text-secondary" />
                      <span>Today&apos;s Class Checklist ({new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })})</span>
                    </h3>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                    {Object.keys(groupedTodaySlots).map((subjectId) => {
                      const slots = groupedTodaySlots[subjectId];
                      const matchingSubject = subjects.find((s: any) => s.id === subjectId);
                      if (!matchingSubject) return null;

                      const todayLog = matchingSubject.logs?.find(
                        (log: any) => log.date.split('T')[0] === todayDateStr
                      );

                      // Display merged times if consecutive, otherwise list them
                      const isConsecutive = slots.length > 1 && (() => {
                        const toMin = (t: string) => {
                          const [h, m] = t.split(':').map(Number);
                          return h * 60 + m;
                        };
                        for (let i = 0; i < slots.length - 1; i++) {
                          const currentEnd = toMin(slots[i].endTime);
                          const nextStart = toMin(slots[i+1].startTime);
                          if (nextStart - currentEnd > 30) return false;
                        }
                        return true;
                      })();

                      const timeDisplay = isConsecutive
                        ? `${slots[0].startTime} - ${slots[slots.length - 1].endTime}`
                        : slots.map((s: any) => `${s.startTime}-${s.endTime}`).join(', ');

                      return (
                        <div key={subjectId} className="glass-card" style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)' }}>
                          <div className="flex-between">
                            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{matchingSubject.name}</span>
                            <span className={`subject-badge ${matchingSubject.type.toLowerCase()}`} style={{ scale: '0.85', transformOrigin: 'right center' }}>{matchingSubject.type}</span>
                          </div>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Time: <strong>{timeDisplay}</strong>
                          </span>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.35rem', marginTop: '0.25rem' }}>
                            <button
                              type="button"
                              className={`check-btn check-btn-present ${todayLog?.status === 'PRESENT' ? 'active' : ''}`}
                              style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[matchingSubject.id] ? 0.5 : 1, cursor: inFlightChecks[matchingSubject.id] ? 'not-allowed' : 'pointer' }}
                              disabled={inFlightChecks[matchingSubject.id]}
                              onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT')}
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                              style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[matchingSubject.id] ? 0.5 : 1, cursor: inFlightChecks[matchingSubject.id] ? 'not-allowed' : 'pointer' }}
                              disabled={inFlightChecks[matchingSubject.id]}
                              onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT')}
                            >
                              Absent
                            </button>
                            <button
                              type="button"
                              className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                              style={{ padding: '0.35rem', fontSize: '0.75rem', opacity: inFlightChecks[matchingSubject.id] ? 0.5 : 1, cursor: inFlightChecks[matchingSubject.id] ? 'not-allowed' : 'pointer' }}
                              disabled={inFlightChecks[matchingSubject.id]}
                              onClick={() => handleCheckIn(matchingSubject.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY')}
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

            {/* Top Widgets Grid */}
            <div className="widgets-grid">
              {/* Widget 1: Overall combined */}
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

            {/* Split section: Advisor & Bunk Planner */}
            <div className="dashboard-main-split">
               {/* Timetable Grid Card */}
              <div className="glass-card timetable-card">
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
                        ? `Extracting slots for stream "${selectedStream}" and group "${selectedGroup}"...`
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
                  </div>
                ) : (
                  <div className="timetable-grid-wrapper">
                    <div className="timetable-grid">
                      {/* Blank top left cell */}
                      <div className="grid-cell grid-header-cell" style={{ minHeight: '40px' }}>Time</div>
                      {DAYS.map((day) => (
                        <div key={day} className="grid-cell grid-header-cell" style={{ minHeight: '40px' }}>
                          {day.substring(0, 3)}
                        </div>
                      ))}

                      {TIMES.map((time: any) => (
                        <Fragment key={time}>
                          <div className="grid-cell grid-time-cell">{time}</div>
                          {DAYS.map((day: any) => {
                            const slot = getTimetableSlot(day, time);
                            return (
                              <div 
                                key={`${day}-${time}`} 
                                className={`grid-cell ${!slot ? 'clickable-grid-cell' : ''}`}
                                onClick={() => !slot && handleEmptyCellClick(day, time)}
                              >
                                {slot ? (
                                  <div className={`slot-item ${slot.type.toLowerCase()}`} style={{ position: 'relative', paddingRight: '1.75rem' }}>
                                    <div className="slot-name" title={slot.subjectName}>{slot.subjectName}</div>
                                    <div className="slot-time">{slot.startTime}-{slot.endTime}</div>
                                    <button
                                      type="button"
                                      title="Delete Slot"
                                      className="delete-slot-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSlot(slot.id);
                                      }}
                                    >
                                      <Trash size={12} />
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right panel: Advisor & Predictor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                          const newPct = newTotal > 0 ? Math.round((sub.stats.present / newTotal) * 1000) / 10 : 100;
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

            {/* Subjects Grid & Quick Actions */}
            <div>
              <div className="subjects-section-header">
                <h3 style={{ fontSize: '1.6rem' }}>Subject Check-Ins</h3>
                <button className="btn-primary" style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }} onClick={() => setShowAddSubject(true)}>
                  <Plus size={16} />
                  <span>Add Subject</span>
                </button>
              </div>

              {subjects.length === 0 && (
                <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
                  <BookOpen size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
                  <h4>No Subjects Added Yet</h4>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Add subjects manually or upload your timetable above to get started.</p>
                </div>
              )}

              <div className="subjects-grid">
                {subjects.map((sub) => {
                  // Check today's logged status for this subject
                  const todayLog = sub.logs.find(
                    (log) => log.date.split('T')[0] === new Date().toISOString().split('T')[0]
                  );

                  return (
                    <div key={sub.id} className="glass-card subject-card">
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
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                          onClick={() => handleDeleteSubject(sub.id)}
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
                        {(() => {
                          const advice = calculateAdvice(sub.stats.present, sub.stats.total, sub.targetPercentage);
                          return (
                            <div className={`bunk-budget-badge ${advice.status}`}>
                              {advice.status === 'safe' ? (
                                <span>Can skip: <strong>{advice.classCount}</strong></span>
                              ) : advice.status === 'warning' ? (
                                <span>Can skip: <strong>0</strong></span>
                              ) : (
                                <span>Attend: <strong>+{advice.classCount}</strong></span>
                              )}
                            </div>
                          );
                        })()}
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
                        <span className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>Log attendance today:</span>
                        <div className="check-in-actions">
                          <button
                            type="button"
                            className={`check-btn check-btn-present ${todayLog?.status === 'PRESENT' ? 'active' : ''}`}
                            disabled={inFlightChecks[sub.id]}
                            onClick={() => handleCheckIn(sub.id, todayLog?.status === 'PRESENT' ? 'REMOVE' : 'PRESENT')}
                            style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            className={`check-btn check-btn-absent ${todayLog?.status === 'ABSENT' ? 'active' : ''}`}
                            disabled={inFlightChecks[sub.id]}
                            onClick={() => handleCheckIn(sub.id, todayLog?.status === 'ABSENT' ? 'REMOVE' : 'ABSENT')}
                            style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                          >
                            Absent
                          </button>
                          <button
                            type="button"
                            className={`check-btn check-btn-holiday ${todayLog?.status === 'HOLIDAY' ? 'active' : ''}`}
                            disabled={inFlightChecks[sub.id]}
                            onClick={() => handleCheckIn(sub.id, todayLog?.status === 'HOLIDAY' ? 'REMOVE' : 'HOLIDAY')}
                            style={{ opacity: inFlightChecks[sub.id] ? 0.5 : 1, cursor: inFlightChecks[sub.id] ? 'not-allowed' : 'pointer' }}
                          >
                            Holiday
                          </button>
                        </div>
                      </div>

                      {/* Collapsible Calendar Heatmap for Student */}
                      <div className="calendar-heatmap-wrapper">
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Last 30 Days History:</span>
                        <div className="heatmap-grid">
                          {getLast30Days().map((dateStr) => {
                            const log = sub.logs?.find((l) => l.date.split('T')[0] === dateStr);
                            let statusClass = 'empty';
                            let tooltipText = `${dateStr}: No class`;
                            if (log) {
                              statusClass = log.status.toLowerCase();
                              tooltipText = `${dateStr}: ${log.status}`;
                            }
                            return (
                              <div 
                                key={dateStr} 
                                className={`heatmap-cell ${statusClass}`} 
                                title={tooltipText}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      {/* =========================================================================
         UI MODALS
         ========================================================================= */}
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
            
            <form onSubmit={handleAddSubject}>
              <div className="form-group">
                <label className="form-label">Subject Name</label>
                <input
                  className="form-input"
                  type="text"
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

              <button className="btn-primary" type="submit">
                Create Subject
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
                <label className="form-label">Subject</label>
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

              {detectedStreams.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Select Stream / Branch / Section</label>
                  <select
                    className="planner-select"
                    value={selectedStream}
                    onChange={(e) => setSelectedStream(e.target.value)}
                    required
                  >
                    {detectedStreams.map((stream) => (
                      <option key={stream} value={stream}>{stream}</option>
                    ))}
                  </select>
                </div>
              )}

              {detectedGroups.length > 0 && (
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
                  </select>
                </div>
              )}

              <button className="btn-primary" type="submit" style={{ marginTop: '0.5rem' }}>
                Confirm & Import Routine
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal 6: Review Extracted Routine */}
      {showReviewModal && (() => {
        const combinedSubjectNames = Array.from(
          new Set([
            ...subjects.map((s) => s.name),
            ...reviewSlots.map((s) => s.subjectName)
          ])
        ).filter((name) => name && name !== 'New Subject' && name !== '__NEW__');

        return (
          <div className="modal-overlay">
            <datalist id="subject-names-list">
              {combinedSubjectNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

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
    </div>
  );
}
