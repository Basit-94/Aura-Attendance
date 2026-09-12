import { GoogleGenerativeAI } from '@google/generative-ai';

const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';

export interface ParsedClass {
  subjectName: string;
  type: 'LECTURE' | 'LAB';
  dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
}

// Realistic timetable template for Developer Mock Mode
const MOCK_TIMETABLE: ParsedClass[] = [
  { subjectName: 'Mathematics III', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Data Structures', type: 'LECTURE', dayOfWeek: 'MONDAY', startTime: '11:00', endTime: '12:00' },
  { subjectName: 'Physics Lab', type: 'LAB', dayOfWeek: 'TUESDAY', startTime: '10:00', endTime: '12:00' },
  { subjectName: 'Mathematics III', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '09:30', endTime: '10:30' },
  { subjectName: 'Computer Networks', type: 'LECTURE', dayOfWeek: 'WEDNESDAY', startTime: '14:00', endTime: '15:30' },
  { subjectName: 'Data Structures', type: 'LECTURE', dayOfWeek: 'THURSDAY', startTime: '11:00', endTime: '12:00' },
  { subjectName: 'Chemistry Lab', type: 'LAB', dayOfWeek: 'THURSDAY', startTime: '14:00', endTime: '16:00' },
  { subjectName: 'Computer Networks', type: 'LECTURE', dayOfWeek: 'FRIDAY', startTime: '14:00', endTime: '15:30' },
];

export async function parseTimetableImage(
  buffer: Buffer,
  mimeType: string,
  branchSection?: string,
  labGroup?: string
): Promise<ParsedClass[]> {
  const geminiKeys = getGeminiKeys();
  const fallbackProvider = process.env.FALLBACK_AI_PROVIDER;
  const fallbackKey = getFallbackKey();

  let rawClasses: ParsedClass[] = [];

  // Try real AI OCR first if API keys are configured (even in mock mode)
  if (geminiKeys.length > 0 || (fallbackProvider && fallbackKey)) {
    try {
      rawClasses = await runRealOcr(buffer, mimeType, branchSection, labGroup);
    } catch (err) {
      console.warn('[OCR] Real OCR failed, falling back to mock mode if enabled:', err);
      if (!MOCK_MODE) {
        throw err;
      }
    }
  }

  if (rawClasses.length === 0 && MOCK_MODE) {
    // Simulate API processing delay in mock mode
    console.log('[OCR] Running in mock mode, returning MOCK_TIMETABLE');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    rawClasses = MOCK_TIMETABLE;
  }

  if (rawClasses.length === 0) {
    throw new Error('All timetable AI OCR scanners are currently unavailable. Please enter your timetable manually.');
  }

  // Map and normalize subject names to avoid abbreviation mismatches
  const normalizedClasses = rawClasses.map(c => ({
    ...c,
    subjectName: normalizeSubjectName(c.subjectName)
  }));

  // Programmatically merge consecutive slots for the same subject on the same day
  return mergeConsecutiveSlots(normalizedClasses);
}

/**
 * Runs the actual AI OCR on the timetable buffer
 */
async function runRealOcr(
  buffer: Buffer,
  mimeType: string,
  branchSection?: string,
  labGroup?: string
): Promise<ParsedClass[]> {
  const targetBranch = branchSection?.trim() || 'All';
  const targetGroup = labGroup?.trim() || 'All';

  let prompt = `
    You are an expert academic timetable OCR parser. Analyze this timetable image/PDF. You must extract all academic classes and labs listed in the timetable for the requested student configuration with 100% precision.
    
    TARGET CONFIGURATION:
    - Target Branch / Class / Section: "${targetBranch}"
    - Target Lab Group / Batch: "${targetGroup}"

    TIMETABLE GRID STRUCTURE & COLUMN TIMING GUIDE:
    The timetable header has 7 academic periods and 2 breaks:
    - Period 1: 09:30 - 10:30
    - Period 2: 10:30 - 11:30
    - S. Break (recess): 11:30 - 11:45 (Do NOT extract)
    - Period 3: 11:45 - 12:45
    - Period 4: 12:45 - 13:45
    - Break / Lunch: 13:45 - 14:30 (Do NOT extract)
    - Period 5: 14:30 - 15:30 (printed as 2.30 - 3.30)
    - Period 6: 15:30 - 16:30 (printed as 3.30 - 4.30)
    - Period 7: 16:30 - 17:30 (printed as 4.30 - 5.30)

    TWO-PAGE SHEET NAVIGATION:
    - Sheet 1 (top): Monday, Tuesday, Wednesday (AIML, CSE I, CSE II, CSE III, IT, ECE).
    - Sheet 2 (bottom): Wednesday (EE), Thursday (all streams), and Friday (all streams).
    - You MUST scan the target branch across BOTH sheets to extract classes for all five days (Monday through Friday).

    CELL SPANNING & BOUNDARY RULES:
    - When a class or lab spans multiple columns, look at the vertical grid lines:
      - If a lab cell covers Period 1 through Period 4 (e.g. OS Lab on Tuesday morning), it runs 09:30 to 13:45 (or 09:30-11:30 and 11:45-13:45).
      - If a lab cell covers Period 5, 6, and 7 in the afternoon (e.g. OOP Lab on Monday afternoon, or S/W Engg Lab on Thursday afternoon), its endTime is 17:30!
      - If individual 1-hour lectures fill the afternoon periods (e.g. Tuesday afternoon: Compiler at 14:30-15:30, CG/AI at 15:30-16:30, OOP at 16:30-17:30), extract each one as a distinct 1-hour lecture slot. Do not merge them!
    
    BRANCH & LAB GROUP FILTERING:
    - Match branch names flexibly ("CSE 3", "CSC 3", "CSE III", "cse 3" all map to the "CSE III" row).
    - When a lab period is divided into Group A and Group B (e.g. "Gr. A / Gr. B"):
      - If Target Lab Group is "Group A" (or "Gr A", "A"), extract ONLY the Group A slot.
      - If Target Lab Group is "Group B" (or "Gr B", "B"), extract ONLY the Group B slot.
      - If Target Lab Group is "All" or "None", keep both.

    ACADEMIC SUBJECT NAME NORMALIZATION:
    Always expand short abbreviations to standard clean names:
    - "OS" -> "Operating Systems"
    - "CG/AI" or "CG" -> "Computer Graphics & Artificial Intelligence"
    - "Indus Mgmt." or "Indus. Mgmt" -> "Industrial Management"
    - "S/W Engg." or "S/W Engg" -> "Software Engineering"
    - "OOP" -> "Object Oriented Programming"
    - "Prob & Stat" -> "Probability & Statistics"
    - "Compiler" -> "Compiler Design"
    - "Indian Const." -> "Constitution of India"
    - "ML" -> "Machine Learning"
    - "DAA" -> "Design & Analysis of Algorithms"
    - "Comp Arch" or "Comp. Arch" -> "Computer Architecture"
    - "Discrete Maths" -> "Discrete Mathematics"

    NON-ACADEMIC SLOTS TO EXCLUDE:
    - Do NOT extract: Lunch breaks, Recesses, Mentoring, Remedial Class, Library, Gap periods, Campus Drive, NSS.

    RESPONSE FORMAT (CRITICAL FOR SPEED):
    Return ONLY a valid JSON array enclosed in \`\`\`json ... \`\`\`.
    Do NOT write any reasoning, preface, explanation, or notes.
    JSON schema:
    \`\`\`json
    [
      {
        "subjectName": "Full Subject Name",
        "type": "LECTURE" or "LAB",
        "dayOfWeek": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY",
        "startTime": "HH:MM",
        "endTime": "HH:MM"
      }
    ]
    \`\`\`
  `;

  // 1. Try Gemini API key rotation with gemini-3.5-flash -> gemini-2.0-flash -> gemini-1.5-flash
  const geminiKeys = getGeminiKeys();
  const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash'];

  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i];
    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of modelsToTry) {
      try {
        console.log(`[OCR] Timetable parse attempt with Key #${i + 1}, model ${modelName} for branch "${targetBranch}"`);
        const model = genAI.getGenerativeModel({ model: modelName });

        const imagePart = {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType,
          },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        return cleanAndParseJson(responseText);
      } catch (err: any) {
        console.warn(`[OCR] Key #${i + 1} with ${modelName} failed:`, err.message || err);
      }
    }
  }

  // 2. Fallback to Vision Provider (Groq / Together / OpenRouter)
  const fallbackProvider = process.env.FALLBACK_AI_PROVIDER;
  const fallbackKey = process.env.FALLBACK_AI_API_KEY;
  const fallbackModel = process.env.FALLBACK_AI_MODEL || 'google/gemini-2.5-flash';

  if (fallbackProvider && fallbackKey) {
    try {
      console.log(`[OCR] Falling back to provider: ${fallbackProvider}`);
      let url = '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const provider = fallbackProvider.toLowerCase().trim();
      if (provider === 'groq') {
        url = 'https://api.groq.com/openai/v1/chat/completions';
        headers['Authorization'] = `Bearer ${fallbackKey}`;
      } else if (provider === 'openrouter') {
        url = 'https://openrouter.ai/api/v1/chat/completions';
        headers['Authorization'] = `Bearer ${fallbackKey}`;
      } else if (provider === 'openai') {
        url = 'https://api.openai.com/v1/chat/completions';
        headers['Authorization'] = `Bearer ${fallbackKey}`;
      }

      if (url) {
        const payload: any = {
          model: fallbackModel,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${buffer.toString('base64')}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 3000,
        };

        if (provider !== 'groq') {
          payload.response_format = { type: 'json_object' };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = await response.json();
          const responseText = data.choices[0].message.content;
          return cleanAndParseJson(responseText);
        } else {
          console.error('[OCR] Fallback API error:', await response.text());
        }
      }
    } catch (err) {
      console.error('[OCR] Fallback failed:', err);
    }
  }

  throw new Error('All AI OCR engines failed to parse the timetable.');
}

/**
 * Sanitizes model responses by extracting JSON from code blocks or arrays
 */
function cleanAndParseJson(text: string): ParsedClass[] {
  let cleaned = text.trim();
  
  // 1. Try extracting from markdown code block ```json [...] ``` or ``` [...] ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    // 2. Try extracting JSON array [ { ... } ]
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      cleaned = arrayMatch[0].trim();
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // 3. Last-ditch attempt: find any array inside the string
    const fallbackArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (fallbackArrayMatch) {
      parsed = JSON.parse(fallbackArrayMatch[0]);
    } else {
      throw new Error(`Failed to parse AI OCR response as JSON: ${err}`);
    }
  }

  if (Array.isArray(parsed)) {
    return parsed as ParsedClass[];
  } else if (parsed.classes && Array.isArray(parsed.classes)) {
    return parsed.classes as ParsedClass[];
  }
  
  throw new Error('Parsed response does not contain a valid classes array.');
}

/**
 * Pre-analyzes a timetable image/PDF to list all available streams and groups.
 */
export async function analyzeTimetableStructure(
  buffer: Buffer,
  mimeType: string
): Promise<{ streams: string[]; groups: string[] }> {
  const geminiKeys = getGeminiKeys();

  if (geminiKeys.length > 0) {
    for (let i = 0; i < geminiKeys.length; i++) {
      const key = geminiKeys[i];
      
      const prompt = `
        Analyze this timetable image/PDF.
        1. Identify all streams, branches, or sections listed in the timetable (e.g. CSE I, CSE II, CSE III, ECE, AIML, IT, etc.). Look for columns or headers indicating the stream/branch/section names.
        2. Identify any lab groups or batches mentioned in the cells (e.g. Grp A, Grp B, Group A, Group B, Batch 1, etc.).
        You must output a JSON object. Do not wrap the JSON in markdown code blocks, just return raw JSON text.
        The JSON must have the following structure:
        {
          "streams": ["CSE I", "CSE II", ...],
          "groups": ["Grp A", "Grp B", ...]
        }
        Be exhaustive and precise. Do not invent any sections.
      `;

      const imagePart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      };

      const modelsToTry = ['gemini-3.6-flash', 'gemini-3.5-flash'];
      const genAI = new GoogleGenerativeAI(key);

      for (const modelName of modelsToTry) {
        try {
          console.log(`[OCR Analyze] Attempting pre-scan using Gemini Key #${i + 1} with ${modelName}`);
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent([prompt, imagePart]);
          const responseText = result.response.text();
          return cleanAndParseStructureJson(responseText);
        } catch (err: any) {
          console.warn(`[OCR Analyze] Key #${i + 1} with ${modelName} failed:`, err.message || err);
        }
      }
    }
  }

  // Fallback or Mock Mode response if no key succeeds
  return {
    streams: ['CSE I', 'CSE II', 'CSE III', 'IT', 'ECE', 'EE', 'AIML'],
    groups: ['Grp A', 'Grp B']
  };
}

function cleanAndParseStructureJson(text: string): { streams: string[]; groups: string[] } {
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      cleaned = objMatch[0].trim();
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
      parsed = JSON.parse(objMatch[0]);
    } else {
      throw new Error(`Failed to parse structure response: ${err}`);
    }
  }
  
  const rawStreams = Array.isArray(parsed.streams) ? parsed.streams.map((s: any) => String(s).trim()) : [];
  const rawGroups = Array.isArray(parsed.groups) ? parsed.groups.map((g: any) => String(g).trim()) : [];

  // Deduplicate and clean streams (e.g. unique, non-empty)
  const streamsSet = new Set<string>();
  for (const stream of rawStreams) {
    if (stream && stream.length > 0) {
      streamsSet.add(stream);
    }
  }

  // Deduplicate and normalize groups (e.g. Map "Gr A", "Grp A", "Group A" to "Group A")
  const groupsSet = new Set<string>();
  for (const group of rawGroups) {
    if (!group) continue;
    const upper = group.toUpperCase();
    if (upper.includes('A') || upper.endsWith(' A')) {
      groupsSet.add('Group A');
    } else if (upper.includes('B') || upper.endsWith(' B')) {
      groupsSet.add('Group B');
    } else if (upper.includes('C') || upper.endsWith(' C')) {
      groupsSet.add('Group C');
    } else if (upper.includes('D') || upper.endsWith(' D')) {
      groupsSet.add('Group D');
    } else {
      groupsSet.add(group);
    }
  }

  return {
    streams: Array.from(streamsSet),
    groups: Array.from(groupsSet),
  };
}

/**
 * Programmatically merges slots of the same subject on the same day if they are consecutive 
 * or separated by a short break (gap <= 30 minutes).
 */
export function mergeConsecutiveSlots(slots: ParsedClass[]): ParsedClass[] {
  if (slots.length <= 1) return slots;

  // Helper to parse "HH:MM" (or "H:MM") to minutes from midnight
  const toMin = (t: string) => {
    const clean = t.replace('.', ':').trim(); // support formats like "12.45"
    const parts = clean.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      return 0;
    }
    const [h, m] = parts;
    return h * 60 + m;
  };

  // Group by dayOfWeek
  const groupedByDay: Record<string, ParsedClass[]> = {};
  for (const s of slots) {
    const day = s.dayOfWeek.toUpperCase();
    if (!groupedByDay[day]) groupedByDay[day] = [];
    groupedByDay[day].push(s);
  }

  const mergedSlots: ParsedClass[] = [];

  for (const day of Object.keys(groupedByDay)) {
    const daySlots = groupedByDay[day];
    
    // Sort slots chronologically
    daySlots.sort((a, b) => toMin(a.startTime) - toMin(b.startTime));

    const mergedDaySlots: ParsedClass[] = [];
    let current = { ...daySlots[0] };

    for (let i = 1; i < daySlots.length; i++) {
      const next = daySlots[i];
      
      const currentEnd = toMin(current.endTime);
      const nextStart = toMin(next.startTime);

      // Normalize names for comparison (alphanumeric only, lowercase)
      const normName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const namesMatch = normName(current.subjectName) === normName(next.subjectName);
      const typesMatch = current.type === next.type;

      // Check if same subject and consecutive/close (gap <= 30 mins)
      if (namesMatch && typesMatch && nextStart >= currentEnd && (nextStart - currentEnd) <= 30) {
        // Merge: update end time of current slot to end time of next slot
        current.endTime = next.endTime;
      } else {
        mergedDaySlots.push(current);
        current = { ...next };
      }
    }
    mergedDaySlots.push(current);
    mergedSlots.push(...mergedDaySlots);
  }

  return mergedSlots;
}

/**
 * Normalizes common variations/abbreviations of subject names to prevent duplication
 */
export function normalizeSubjectName(name: string): string {
  if (!name) return '';
  let clean = name.trim();
  
  // Remove extra spaces
  clean = clean.replace(/\s+/g, ' ');
  
  const lower = clean.toLowerCase();
  
  // Common academic mappings
  if (lower.includes('comp') && lower.includes('arch')) {
    if (lower.includes('lab')) return 'Computer Architecture Lab';
    return 'Computer Architecture';
  }
  if (lower.includes('daa') || (lower.includes('design') && lower.includes('algorithm'))) {
    if (lower.includes('lab')) return 'Design & Analysis of Algorithms Lab';
    return 'Design & Analysis of Algorithms';
  }
  if (lower.includes('dbms') || (lower.includes('database') && lower.includes('management'))) {
    if (lower.includes('lab')) return 'Database Management Systems Lab';
    return 'Database Management Systems';
  }
  if (/\bos\b/i.test(clean) || lower.includes('operating system')) {
    if (lower.includes('lab')) return 'Operating Systems Lab';
    return 'Operating Systems';
  }
  if (/\bcn\b/i.test(clean) || lower.includes('computer network')) {
    if (lower.includes('lab')) return 'Computer Networks Lab';
    return 'Computer Networks';
  }
  if (/\bcoa\b/i.test(clean) || (lower.includes('computer') && lower.includes('org'))) {
    if (lower.includes('lab')) return 'Computer Organization Lab';
    return 'Computer Organization & Architecture';
  }
  if (lower.includes('math')) {
    if (lower.includes('iii') || lower.includes('3')) return 'Mathematics III';
    if (lower.includes('iv') || lower.includes('4')) return 'Mathematics IV';
    return 'Mathematics';
  }
  if ((lower.includes('cg') || lower.includes('computer graphic') || lower.includes('graphics')) && (lower.includes('ai') || lower.includes('artificial intelligence') || lower.includes('intelligence') || lower === 'cg' || lower === 'cg/ai')) {
    if (lower.includes('lab')) return 'Computer Graphics and Artificial Intelligence Lab';
    return 'Computer Graphics and Artificial Intelligence';
  }
  if (lower.includes('software engineer') || lower.includes('s/w engg') || lower.includes('se lab') || (lower.includes('software') && lower.includes('eng'))) {
    if (lower.includes('lab') || lower.includes('laboratory')) return 'Software Engineering Laboratory';
    return 'Software Engineering';
  }
  if (lower.includes('object oriented') || lower.includes('oop') || lower.includes('oops')) {
    if (lower.includes('lab') || lower.includes('laboratory')) return 'Object Oriented Programming Laboratory';
    return 'Object Oriented Programming';
  }
  if (lower.includes('compiler') || /\bcd\b/i.test(clean)) {
    if (lower.includes('lab')) return 'Compiler Design Lab';
    return 'Compiler Design';
  }
  if (lower.includes('constitution') || lower.includes('indian const')) {
    return 'Constitution of India';
  }
  if (lower.includes('indus') || lower.includes('industrial manage')) {
    return 'Industrial Management';
  }
  
  return clean;
}

/**
 * Returns a canonical matching key for subject name & type to guarantee exact deduplication
 */
export function canonicalSubjectKey(name: string, type?: string): string {
  const norm = normalizeSubjectName(name);
  let clean = norm
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/\blaboratory\b/g, 'lab')
    .replace(/[^a-z0-9]/g, '');

  const isLab = type 
    ? (type.toUpperCase() === 'LAB' || type.toLowerCase().includes('lab')) 
    : (clean.includes('lab') || clean.endsWith('lab'));

  if (isLab && !clean.endsWith('lab')) {
    clean += 'lab';
  }

  return `${clean}_${isLab ? 'LAB' : 'LECTURE'}`;
}

/**
 * Helper to extract and sanitize Gemini API keys from environment variables,
 * stripping any surrounding double/single quotes.
 */
function getGeminiKeys(): string[] {
  const env = process.env.GEMINI_API_KEYS || '';
  return env
    .split(',')
    .map((k) => k.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Helper to extract and sanitize the fallback API key, stripping quotes.
 */
function getFallbackKey(): string {
  const env = process.env.FALLBACK_AI_API_KEY || '';
  return env.trim().replace(/^["']|["']$/g, '');
}

