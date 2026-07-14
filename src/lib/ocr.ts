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
  let prompt = `
    Analyze this timetable image/PDF. You must extract all academic classes and labs listed in the timetable in a step-by-step verification process to ensure 100% accuracy.
    
    STEP-BY-STEP REASONING PROCESS:
    In your response, you must write down your thinking process step-by-step before producing the final JSON array.
    1. **Identify Target Rows**: Write down the row headers and locate the exact rows that correspond to the requested branch/section: "${branchSection?.trim() || 'All'}". Note the row indices.
    2. **Map Days**: For each day of the week (Monday to Saturday), trace the left margin. Determine which rows align with that day's vertically merged label. Write this mapping down.
    3. **Chronological Scan**: For each day, scan the target branch rows from left to right (from the first period to the last period). List out every academic course/subject you read in those cells, along with the start and end times.
    4. **Filter Labs**: If a lab cell is split or lists groups (e.g. Group A/Group B), check if it matches the requested group: "${labGroup?.trim() || 'All'}". Write down which group was selected and why you are keeping or discarding each lab slot.
    5. **Self-Review & Verification**: Cross-reference your listed classes against the timetable image again. Check: Are there any classes you missed? Did you accidentally map a Tuesday class to Monday? Are there any blank slots that actually contain subjects? Double-check and correct any errors.
    6. **Output JSON**: Once verified, output the final result as a JSON array of objects starting with "[" and ending with "]" at the very end of your response.
    
    CRITICAL RULES:
    - Do NOT extract non-academic slots (lunch breaks, recesses, gap slots, self-study, etc.).
    - Normalize abbreviations to full names consistently (e.g., "DAA Lab" -> "Design & Analysis of Algorithms Lab").
    - If a class spans multiple consecutive time slots on the same day (even if separated by a short break of less than 30 minutes, such as a lunch break or recess), you MUST merge them into a single parsed class. The startTime must be the start of the first slot, and the endTime must be the end of the last slot.
    
    JSON Structure to output at the end:
    [
      {
        "subjectName": "Full Course Name",
        "type": "LECTURE" or "LAB",
        "dayOfWeek": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY",
        "startTime": "HH:MM",
        "endTime": "HH:MM"
      }
    ]
  `;

  // 1. Try Gemini API key rotation with gemini-3.5-flash
  const geminiKeys = getGeminiKeys();

  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i];
    
    // Tier 1: Try gemini-3.1-pro-preview first for maximum parsing quality
    try {
      console.log(`[OCR] Attempting timetable parse using Gemini Key #${i + 1} with gemini-3.1-pro-preview`);
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });

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
      console.warn(`[OCR] Gemini Key #${i + 1} (gemini-3.1-pro-preview) failed, trying gemini-3.5-flash:`, err.message || err);
      
      // Tier 2: Try gemini-3.5-flash next
      try {
        console.log(`[OCR] Attempting timetable parse using Gemini Key #${i + 1} with gemini-3.5-flash`);
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

        const imagePart = {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType,
          },
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        return cleanAndParseJson(responseText);
      } catch (flash35Err: any) {
        console.warn(`[OCR] Gemini Key #${i + 1} (gemini-3.5-flash) failed, trying gemini-2.0-flash:`, flash35Err.message || flash35Err);

        // Tier 3: Try gemini-2.0-flash as stable backup
        try {
          console.log(`[OCR] Attempting timetable parse using Gemini Key #${i + 1} with gemini-2.0-flash`);
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

          const imagePart = {
            inlineData: {
              data: buffer.toString('base64'),
              mimeType,
            },
          };

          const result = await model.generateContent([prompt, imagePart]);
          const responseText = result.response.text();
          return cleanAndParseJson(responseText);
        } catch (flash20Err: any) {
          console.error(`[OCR] Gemini Key #${i + 1} (gemini-2.0-flash) also failed:`, flash20Err.message || flash20Err);
        }
      }
    }
  }

  // 2. Fallback to Llama 3.2 Vision (Groq / Together / OpenRouter)
  const fallbackProvider = process.env.FALLBACK_AI_PROVIDER;
  const fallbackKey = process.env.FALLBACK_AI_API_KEY;
  const fallbackModel = process.env.FALLBACK_AI_MODEL || 'google/gemini-2.5-flash';

  if (fallbackProvider && fallbackKey) {
    try {
      console.log(`[OCR] Falling back to Llama via provider: ${fallbackProvider}`);
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
          max_tokens: 4000,
        };

        // Groq vision models do NOT support response_format: { type: 'json_object' }
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
          console.error('[OCR] Llama fallback API error:', await response.text());
        }
      }
    } catch (err) {
      console.error('[OCR] Llama fallback failed:', err);
    }
  }

  throw new Error('All AI OCR engines failed to parse the timetable.');
}

/**
 * Sanitizes model responses by stripping markdown formatting and parsing JSON
 */
function cleanAndParseJson(text: string): ParsedClass[] {
  let cleaned = text.trim();
  
  // Remove markdown code blocks if present (e.g. ```json ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
  }
  
  cleaned = cleaned.trim();
  const parsed = JSON.parse(cleaned);

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

      // Tier 1: Try gemini-3.1-pro-preview for best structure scan
      try {
        console.log(`[OCR Analyze] Attempting pre-scan using Gemini Key #${i + 1} with gemini-3.1-pro-preview`);
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        return cleanAndParseStructureJson(responseText);
      } catch (err: any) {
        console.warn(`[OCR Analyze] Gemini Key #${i + 1} (gemini-3.1-pro-preview) failed, trying gemini-3.5-flash:`, err.message || err);
        
        // Tier 2: Try gemini-3.5-flash next
        try {
          console.log(`[OCR Analyze] Attempting pre-scan using Gemini Key #${i + 1} with gemini-3.5-flash`);
          const genAI = new GoogleGenerativeAI(key);
          const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });

          const result = await model.generateContent([prompt, imagePart]);
          const responseText = result.response.text();
          return cleanAndParseStructureJson(responseText);
        } catch (flash35Err: any) {
          console.warn(`[OCR Analyze] Gemini Key #${i + 1} (gemini-3.5-flash) failed, trying gemini-2.0-flash:`, flash35Err.message || flash35Err);

          // Tier 3: Try gemini-2.0-flash as stable backup
          try {
            console.log(`[OCR Analyze] Attempting pre-scan using Gemini Key #${i + 1} with gemini-2.0-flash`);
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

            const result = await model.generateContent([prompt, imagePart]);
            const responseText = result.response.text();
            return cleanAndParseStructureJson(responseText);
          } catch (flash20Err: any) {
            console.error(`[OCR Analyze] Gemini Key #${i + 1} (gemini-2.0-flash) also failed:`, flash20Err.message || flash20Err);
          }
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
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(json)?\n/, '').replace(/\n```$/, '');
  }
  cleaned = cleaned.trim();
  const parsed = JSON.parse(cleaned);
  
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
  if (lower.includes('os') || lower.includes('operating system')) {
    if (lower.includes('lab')) return 'Operating Systems Lab';
    return 'Operating Systems';
  }
  if (lower.includes('cn') || lower.includes('computer network')) {
    if (lower.includes('lab')) return 'Computer Networks Lab';
    return 'Computer Networks';
  }
  if (lower.includes('coa') || (lower.includes('computer') && lower.includes('org'))) {
    if (lower.includes('lab')) return 'Computer Organization Lab';
    return 'Computer Organization & Architecture';
  }
  if (lower.includes('math')) {
    if (lower.includes('iii') || lower.includes('3')) return 'Mathematics III';
    if (lower.includes('iv') || lower.includes('4')) return 'Mathematics IV';
    return 'Mathematics';
  }
  
  return clean;
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

