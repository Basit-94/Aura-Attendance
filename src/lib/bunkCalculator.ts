/**
 * Bunk Runway & Attendance Analytics Engine
 * Provides precise calculations for safe skips, recovery targets, and crowd risk analysis.
 */

export type FacultyMood = 'psycho_strict' | 'strict' | 'neutral' | 'lenient' | 'relaxed';

export interface BunkBudget {
  totalClasses: number;
  presentClasses: number;
  absentClasses: number;
  currentPercentage: number;
  targetPercentage: number;
  isAboveTarget: boolean;
  bunksAvailable: number; // How many more classes the student can skip while staying >= target
  classesNeeded: number;  // How many consecutive classes the student must attend to reach target
  status: 'safe' | 'warning' | 'danger';
  headline: string;
  recommendation: string;
}

export interface TeacherVibeInfo {
  id: FacultyMood;
  emoji: string;
  label: string;
  accentColor: string;
  bgColor: string;
  darkColor: string;
  riskPenalty: number; // 0 to 100 risk multiplier
  tagline: string;
  description: string;
}

export const FACULTY_MOODS: Record<FacultyMood, TeacherVibeInfo> = {
  psycho_strict: {
    id: 'psycho_strict',
    emoji: '👹',
    label: 'VERY STRICT',
    accentColor: '#c8322b',
    bgColor: '#fdf2f1',
    darkColor: '#991b1b',
    riskPenalty: 95,
    tagline: 'Shake, Strobe, Glitch. Late gaye toh scene!',
    description: 'Zero tolerance for late entries or proxies. Door shuts at the bell.'
  },
  strict: {
    id: 'strict',
    emoji: '😠',
    label: 'STRICT',
    accentColor: '#e8722e',
    bgColor: '#fff7ed',
    darkColor: '#b4501a',
    riskPenalty: 75,
    tagline: 'Taana toh padega. 75% se 1% kam toh no hall ticket.',
    description: 'Strict roll calls. Will question latecomers before allowing entry.'
  },
  neutral: {
    id: 'neutral',
    emoji: '😐',
    label: 'NEUTRAL',
    accentColor: '#1a1414',
    bgColor: '#faf5e4',
    darkColor: '#332a2a',
    riskPenalty: 50,
    tagline: 'Coin Flip. Bunk ya jaao — pure 50/50 chance.',
    description: 'Sometimes takes attendance at the end, sometimes calls roll right away.'
  },
  lenient: {
    id: 'lenient',
    emoji: '🙂',
    label: 'LENIENT',
    accentColor: '#86e8a3',
    bgColor: '#f0fdf4',
    darkColor: '#15803d',
    riskPenalty: 25,
    tagline: 'Halki hawa. Ek polite sorry, aur baith jao.',
    description: 'Allows students up to 15 mins late. Generally accepts proxy if convincing.'
  },
  relaxed: {
    id: 'relaxed',
    emoji: '😌',
    label: 'RELAXED / CHILL',
    accentColor: '#3ccf6e',
    bgColor: '#e9f6ec',
    darkColor: '#15803d',
    riskPenalty: 5,
    tagline: 'Shimmer & Petals. Full chill, kabhi bhi ghuso.',
    description: 'Rarely takes formal roll call, passes attendance sheet around the hall.'
  }
};

/**
 * Calculates the exact bunk runway against institutional target (e.g. 75%).
 */
export function calculateBunkBudget(
  present: number,
  absent: number,
  targetPercentage: number = 75.0
): BunkBudget {
  const total = present + absent;
  const currentPercentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 100.0;
  const targetFraction = targetPercentage / 100.0;

  let bunksAvailable = 0;
  let classesNeeded = 0;

  if (total === 0) {
    return {
      totalClasses: 0,
      presentClasses: 0,
      absentClasses: 0,
      currentPercentage: 100.0,
      targetPercentage,
      isAboveTarget: true,
      bunksAvailable: 0,
      classesNeeded: 0,
      status: 'safe',
      headline: 'Fresh Semester',
      recommendation: 'No classes logged yet. Start strong!'
    };
  }

  if (currentPercentage >= targetPercentage) {
    // Formula: floor((present - targetFraction * total) / targetFraction)
    bunksAvailable = Math.floor((present - targetFraction * total) / targetFraction);
    if (bunksAvailable < 0) bunksAvailable = 0;

    let status: 'safe' | 'warning' = 'safe';
    let headline = `${bunksAvailable} Bunk${bunksAvailable === 1 ? '' : 's'} Safe`;
    let recommendation = `You can skip ${bunksAvailable} class${bunksAvailable === 1 ? '' : 'es'} without dropping below ${targetPercentage}%.`;

    if (bunksAvailable === 0) {
      status = 'warning';
      headline = '0 Bunks Left (On The Edge)';
      recommendation = `Attend the next class! Any absence will push you below ${targetPercentage}%.`;
    } else if (bunksAvailable <= 2) {
      status = 'warning';
      headline = `${bunksAvailable} Bunk${bunksAvailable === 1 ? '' : 's'} Margin`;
      recommendation = `Low margin. Keep these bunks reserved for emergencies.`;
    }

    return {
      totalClasses: total,
      presentClasses: present,
      absentClasses: absent,
      currentPercentage,
      targetPercentage,
      isAboveTarget: true,
      bunksAvailable,
      classesNeeded: 0,
      status,
      headline,
      recommendation
    };
  } else {
    // Formula: ceil((targetFraction * total - present) / (1 - targetFraction))
    classesNeeded = Math.ceil((targetFraction * total - present) / (1 - targetFraction));
    if (classesNeeded < 1) classesNeeded = 1;

    return {
      totalClasses: total,
      presentClasses: present,
      absentClasses: absent,
      currentPercentage,
      targetPercentage,
      isAboveTarget: false,
      bunksAvailable: 0,
      classesNeeded,
      status: 'danger',
      headline: `Need +${classesNeeded} Straight Classes`,
      recommendation: `Attend ${classesNeeded} consecutive class${classesNeeded === 1 ? '' : 'es'} to recover to ${targetPercentage}%. Bunking is locked!`,
    };
  }
}

/**
 * Evaluates real-time classroom crowd poll risk ("Sir/Mam Aa Gaye Kya?").
 */
export interface PollResult {
  hasArrived: boolean;
  confidenceScore: number; // 0 - 100%
  riskLevel: 'SAFE' | 'CAUTION' | 'HIGH_RISK' | 'CRITICAL';
  statusText: string;
  actionAdvice: string;
  totalVotes: number;
  haanPercent: number;
}

export function evaluateClassPoll(
  haanVotes: number,
  nahiVotes: number,
  mood: FacultyMood,
  minutesSinceScheduledStart: number = 5
): PollResult {
  const totalVotes = haanVotes + nahiVotes;
  const moodInfo = FACULTY_MOODS[mood];

  if (totalVotes === 0) {
    return {
      hasArrived: false,
      confidenceScore: 0,
      riskLevel: 'SAFE',
      statusText: 'No votes yet',
      actionAdvice: 'Be the first to confirm if the professor has stepped into class!',
      totalVotes: 0,
      haanPercent: 0
    };
  }

  const haanPercent = Math.round((haanVotes / totalVotes) * 100);
  const confidenceScore = Math.min(100, totalVotes * 25); // 4+ votes = 100% confidence
  const hasArrived = haanVotes > nahiVotes;

  if (hasArrived) {
    if (mood === 'psycho_strict') {
      return {
        hasArrived: true,
        confidenceScore,
        riskLevel: 'CRITICAL',
        statusText: `🚨 PROF IS IN CLASS (${haanVotes} confirmed)`,
        actionAdvice: 'DO NOT ENTER! Extreme strictness — entering late will result in detention or public scolding.',
        totalVotes,
        haanPercent
      };
    } else if (mood === 'strict') {
      return {
        hasArrived: true,
        confidenceScore,
        riskLevel: 'HIGH_RISK',
        statusText: `⚠️ PROF IS IN CLASS (${haanVotes} confirmed)`,
        actionAdvice: minutesSinceScheduledStart <= 7 
          ? 'Enter RIGHT NOW with a polite excuse before attendance starts!' 
          : 'High risk of attendance denial. Enter at your own risk.',
        totalVotes,
        haanPercent
      };
    } else if (mood === 'neutral') {
      return {
        hasArrived: true,
        confidenceScore,
        riskLevel: 'CAUTION',
        statusText: `👀 Prof is in room (${haanVotes} confirmed)`,
        actionAdvice: 'Slide in through the back door quietly while he arranges his slides.',
        totalVotes,
        haanPercent
      };
    } else {
      return {
        hasArrived: true,
        confidenceScore,
        riskLevel: 'SAFE',
        statusText: `😌 Prof has arrived (${haanVotes} confirmed)`,
        actionAdvice: 'Relaxed professor! You can enter whenever — attendance will likely be taken at the end.',
        totalVotes,
        haanPercent
      };
    }
  } else {
    return {
      hasArrived: false,
      confidenceScore,
      riskLevel: 'SAFE',
      statusText: `🟢 Room is clear (${nahiVotes} confirmed not here)`,
      actionAdvice: `Prof has not arrived yet. You have time to grab a coffee or head to class comfortably.`,
      totalVotes,
      haanPercent
    };
  }
}
