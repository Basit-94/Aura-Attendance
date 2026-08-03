const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany({
    select: {
      email: true,
      createdAt: true,
      semesters: {
        select: {
          subjects: {
            select: {
              name: true,
              attendanceLogs: {
                select: {
                  status: true,
                  date: true,
                  createdAt: true
                }
              }
            }
          }
        }
      }
    }
  });

  const now = new Date();
  const MS_IN_DAY = 24 * 60 * 60 * 1000;

  let active7Days = 0;
  let active30Days = 0;
  let inactive = 0;
  let neverLogged = 0;

  const userRetentionData = [];

  students.forEach(student => {
    let allLogs = [];
    student.semesters.forEach(sem => {
      sem.subjects.forEach(sub => {
        allLogs.push(...sub.attendanceLogs);
      });
    });

    if (allLogs.length === 0) {
      neverLogged++;
      userRetentionData.push({
        Email: student.email,
        "Account Created": student.createdAt.toISOString().split('T')[0],
        "Last Log Action": "Never",
        "Logs (Last 7d)": 0,
        "Total Logs": 0,
        Status: "Inactive (Never Used)"
      });
      return;
    }

    allLogs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const latestLog = allLogs[0];
    const latestLogTime = new Date(latestLog.createdAt);
    const diffDays = Math.floor((now - latestLogTime) / MS_IN_DAY);

    const logsLast7d = allLogs.filter(log => (now - new Date(log.createdAt)) / MS_IN_DAY <= 7).length;

    let status = "";
    if (diffDays <= 7) {
      active7Days++;
      status = "Active (Last 7 Days)";
    } else if (diffDays <= 30) {
      active30Days++;
      status = "Active (Last 30 Days)";
    } else {
      inactive++;
      status = "Inactive (>30 Days)";
    }

    userRetentionData.push({
      Email: student.email,
      "Account Created": student.createdAt.toISOString().split('T')[0],
      "Last Log Action": latestLogTime.toISOString().split('T')[0] + ` (${diffDays}d ago)`,
      "Logs (Last 7d)": logsLast7d,
      "Total Logs": allLogs.length,
      Status: status
    });
  });

  const studentAttendancePercentages = [];
  const subjectStats = {};

  students.forEach(student => {
    let presentCount = 0;
    let absentCount = 0;

    student.semesters.forEach(sem => {
      sem.subjects.forEach(sub => {
        const normalizedSubjectName = sub.name.trim().replace(/\s+/g, ' ');
        if (!subjectStats[normalizedSubjectName]) {
          subjectStats[normalizedSubjectName] = { present: 0, absent: 0, holiday: 0 };
        }

        sub.attendanceLogs.forEach(log => {
          if (log.status === 'PRESENT') {
            presentCount++;
            subjectStats[normalizedSubjectName].present++;
          } else if (log.status === 'ABSENT') {
            absentCount++;
            subjectStats[normalizedSubjectName].absent++;
          } else if (log.status === 'HOLIDAY') {
            subjectStats[normalizedSubjectName].holiday++;
          }
        });
      });
    });

    const totalCalculatedClasses = presentCount + absentCount;
    if (totalCalculatedClasses > 0) {
      const percentage = (presentCount / totalCalculatedClasses) * 100;
      studentAttendancePercentages.push(percentage);
    }
  });

  const totalUsersWithLogs = studentAttendancePercentages.length;
  const averageOverallAttendance = totalUsersWithLogs > 0
    ? (studentAttendancePercentages.reduce((a, b) => a + b, 0) / totalUsersWithLogs).toFixed(2)
    : "N/A";

  const above75 = studentAttendancePercentages.filter(p => p >= 75).length;
  const below75 = totalUsersWithLogs - above75;

  const subjectList = Object.keys(subjectStats).map(name => {
    const stats = subjectStats[name];
    const totalLogs = stats.present + stats.absent;
    const bunkRate = totalLogs > 0 ? ((stats.absent / totalLogs) * 100).toFixed(1) : 0;
    return {
      Subject: name,
      Present: stats.present,
      Absent: stats.absent,
      Holidays: stats.holiday,
      "Total Logs": totalLogs,
      "Bunk Rate (%)": totalLogs > 0 ? parseFloat(bunkRate) : 0
    };
  });

  const rankedSubjects = subjectList
    .filter(s => s["Total Logs"] >= 2)
    .sort((a, b) => b["Bunk Rate (%)"] - a["Bunk Rate (%)"]);

  console.log("\n========================================================");
  console.log("===           ACTIVE USER RETENTION REPORT           ===");
  console.log("========================================================");
  console.log(`Total Registered Students: ${students.length}`);
  console.log(`- Active (Logged in last 7 Days) : ${active7Days} (${((active7Days/students.length)*100).toFixed(1)}%)`);
  console.log(`- Active (Logged in last 30 Days): ${active30Days} (${((active30Days/students.length)*100).toFixed(1)}%)`);
  console.log(`- Inactive (> 30 Days ago)       : ${inactive} (${((inactive/students.length)*100).toFixed(1)}%)`);
  console.log(`- Never Logged Attendance        : ${neverLogged} (${((neverLogged/students.length)*100).toFixed(1)}%)`);
  console.log("\nUser Detail Table:");
  console.table(userRetentionData);

  console.log("\n========================================================");
  console.log("===          AGGREGATED ATTENDANCE ANALYTICS         ===");
  console.log("========================================================");
  console.log(`Average Overall Attendance (Across all active students): ${averageOverallAttendance}%`);
  console.log(`- Students meeting 75% Target: ${above75} (${totalUsersWithLogs > 0 ? ((above75/totalUsersWithLogs)*100).toFixed(1) : 0}%)`);
  console.log(`- Students falling below 75% : ${below75} (${totalUsersWithLogs > 0 ? ((below75/totalUsersWithLogs)*100).toFixed(1) : 0}%)`);
  
  console.log("\nMost Bunked Subjects (Min. 2 logs overall):");
  console.table(rankedSubjects.slice(0, 10));
  console.log("========================================================\n");
}

main()
  .catch((e) => {
    console.error("Error executing database analytics:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
