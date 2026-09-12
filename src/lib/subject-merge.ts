import db from '@/lib/db';
import { normalizeSubjectName, canonicalSubjectKey } from '@/lib/ocr';

/**
 * Automatically detects and consolidates duplicate subjects within a semester.
 * Reassigns schedule slots and attendance logs to the primary subject and deletes duplicates.
 */
export async function mergeDuplicateSubjects(semesterId: string) {
  try {
    const subjects = await db.subject.findMany({
      where: { semesterId },
      include: {
        attendanceLogs: true,
        scheduleSlots: true,
      },
    });

    const groups: Record<string, typeof subjects> = {};
    for (const sub of subjects) {
      const key = canonicalSubjectKey(sub.name, sub.type);
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(sub);
    }

    for (const key in groups) {
      const list = groups[key];
      if (list.length > 1) {
        // Prefer the subject with the most attendance logs, then the oldest record
        list.sort((a, b) => {
          if (b.attendanceLogs.length !== a.attendanceLogs.length) {
            return b.attendanceLogs.length - a.attendanceLogs.length;
          }
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        const canonical = list[0];
        const duplicates = list.slice(1);

        const canonicalNormName = normalizeSubjectName(canonical.name);
        if (canonical.name !== canonicalNormName) {
          await db.subject.update({
            where: { id: canonical.id },
            data: { name: canonicalNormName },
          });
        }

        await db.$transaction(async (tx) => {
          const canonicalLogs = [...canonical.attendanceLogs];
          const canonicalSlots = [...canonical.scheduleSlots];

          for (const duplicate of duplicates) {
            for (const log of duplicate.attendanceLogs) {
              const existingLog = canonicalLogs.find(
                (l) => new Date(l.date).getTime() === new Date(log.date).getTime()
              );
              if (!existingLog) {
                await tx.attendanceLog.update({
                  where: { id: log.id },
                  data: { subjectId: canonical.id },
                });
                canonicalLogs.push(log);
              } else {
                await tx.attendanceLog.delete({
                  where: { id: log.id },
                });
              }
            }

            for (const slot of duplicate.scheduleSlots) {
              const existingSlot = canonicalSlots.find(
                (s) =>
                  s.dayOfWeek === slot.dayOfWeek &&
                  s.startTime === slot.startTime &&
                  s.endTime === slot.endTime
              );
              if (!existingSlot) {
                await tx.scheduleSlot.update({
                  where: { id: slot.id },
                  data: { subjectId: canonical.id },
                });
                canonicalSlots.push(slot);
              } else {
                await tx.scheduleSlot.delete({
                  where: { id: slot.id },
                });
              }
            }

            await tx.subject.delete({
              where: { id: duplicate.id },
            });
          }
        }, {
          maxWait: 15000,
          timeout: 30000,
        });
      } else if (list.length === 1) {
        const sub = list[0];
        const normName = normalizeSubjectName(sub.name);
        if (sub.name !== normName) {
          await db.subject.update({
            where: { id: sub.id },
            data: { name: normName },
          });
        }
      }
    }
  } catch (error) {
    console.error('Error in mergeDuplicateSubjects:', error);
  }
}
