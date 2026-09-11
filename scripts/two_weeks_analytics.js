const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const students = await prisma.student.findMany({
    select: {
      id: true,
      email: true,
      createdAt: true,
      semesters: {
        select: {
          id: true,
          name: true,
          subjects: {
            select: {
              name: true,
              type: true,
              attendanceLogs: {
                select: {
                  id: true,
                  status: true,
                  date: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const now = new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  console.log(`\n========================================================================`);
  console.log(`===        AURAATTEND: 14-DAY ACTIVITY & DAILY USAGE REPORT          ===`);
  console.log(`========================================================================`);
  console.log(`Current Server Time: ${now.toISOString()}`);
  console.log(`Total Registered Accounts in Database: ${students.length}\n`);

  let activeLast14Days = 0;
  let activeLast7Days = 0;
  let activeLast24Hours = 0;
  let activeLast48Hours = 0;
  let activeEver = 0;
  let neverUsed = 0;

  // Track daily unique users for the past 14 days
  const dailyUniqueUsers = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getTime() - i * MS_PER_DAY);
    const dateKey = d.toISOString().split('T')[0];
    dailyUniqueUsers[dateKey] = new Set();
  }

  const userSummaries = [];

  students.forEach((student) => {
    const allLogs = [];
    student.semesters.forEach((sem) => {
      sem.subjects.forEach((sub) => {
        sub.attendanceLogs.forEach((log) => {
          allLogs.push({
            ...log,
            subjectName: sub.name,
          });
        });
      });
    });

    if (allLogs.length === 0) {
      neverUsed++;
      userSummaries.push({
        email: student.email,
        created: student.createdAt.toISOString().split('T')[0],
        lastActivity: 'Never',
        daysAgo: 'N/A',
        logs14d: 0,
        totalLogs: 0,
        status: 'Never Used',
      });
      return;
    }

    activeEver++;

    // Sort logs descending by createdAt
    allLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestLog = allLogs[0];
    const latestTime = new Date(latestLog.createdAt);
    const diffMs = now - latestTime;
    const diffDays = Math.floor(diffMs / MS_PER_DAY);
    const diffHours = (diffMs / (1000 * 60 * 60)).toFixed(1);

    // Filter logs in past 14 days
    const logs14d = allLogs.filter((log) => (now - new Date(log.createdAt)) / MS_PER_DAY <= 14);
    const logs7d = allLogs.filter((log) => (now - new Date(log.createdAt)) / MS_PER_DAY <= 7);
    const logs24h = allLogs.filter((log) => (now - new Date(log.createdAt)) / MS_PER_DAY <= 1);
    const logs48h = allLogs.filter((log) => (now - new Date(log.createdAt)) / MS_PER_DAY <= 2);

    if (logs14d.length > 0) activeLast14Days++;
    if (logs7d.length > 0) activeLast7Days++;
    if (logs24h.length > 0) activeLast24Hours++;
    if (logs48h.length > 0) activeLast48Hours++;

    // Populate daily unique users
    allLogs.forEach((log) => {
      const dateKey = new Date(log.createdAt).toISOString().split('T')[0];
      if (dailyUniqueUsers[dateKey]) {
        dailyUniqueUsers[dateKey].add(student.email);
      }
    });

    let status = 'Inactive (> 14d)';
    if (diffDays === 0) status = 'Active Today (< 24h)';
    else if (diffDays <= 7) status = 'Active (< 7d)';
    else if (diffDays <= 14) status = 'Active (7-14d)';

    userSummaries.push({
      email: student.email,
      created: student.createdAt.toISOString().split('T')[0],
      lastActivity: `${latestTime.toISOString().split('T')[0]} (${diffDays}d / ${diffHours}h ago)`,
      daysAgo: diffDays,
      logs14d: logs14d.length,
      totalLogs: allLogs.length,
      status,
    });
  });

  console.log(`SUMMARY STATISTICS:`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`- Active in past 24 Hours (Today)  : ${activeLast24Hours}`);
  console.log(`- Active in past 48 Hours          : ${activeLast48Hours}`);
  console.log(`- Active in past 7 Days            : ${activeLast7Days}`);
  console.log(`- Active in past 14 Days (2 Weeks) : ${activeLast14Days} (${((activeLast14Days / students.length) * 100).toFixed(1)}% of all registered)`);
  console.log(`- Inactive (> 14 Days)             : ${students.length - activeLast14Days - neverUsed}`);
  console.log(`- Never Logged Attendance          : ${neverUsed}\n`);

  console.log(`DAILY UNIQUE ACTIVE USERS (PAST 14 DAYS):`);
  console.log(`------------------------------------------------------------------------`);
  const dailyRows = Object.keys(dailyUniqueUsers)
    .sort()
    .map((date) => ({
      Date: date,
      'Unique Active Users': dailyUniqueUsers[date].size,
      Users: Array.from(dailyUniqueUsers[date]).join(', ') || '—',
    }));
  console.table(dailyRows);

  console.log(`\nALL USERS BREAKDOWN (SORTED BY MOST RECENT ACTIVITY):`);
  console.log(`------------------------------------------------------------------------`);
  userSummaries.sort((a, b) => {
    if (a.daysAgo === 'N/A') return 1;
    if (b.daysAgo === 'N/A') return -1;
    return a.daysAgo - b.daysAgo;
  });

  console.table(
    userSummaries.map((u) => ({
      Email: u.email,
      'Created On': u.created,
      'Last Active': u.lastActivity,
      'Logs (14d)': u.logs14d,
      'Total Logs': u.totalLogs,
      Status: u.status,
    }))
  );
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
