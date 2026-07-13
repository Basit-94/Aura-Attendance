# Attendance Tracker 📅✍️

A modern, full-stack Attendance Tracker web application designed for students and teachers. It simplifies attendance management with AI-powered routine/timetable parsing, interactive scheduling, and rich visual analytics.

## 🚀 Key Features

### 1. **AI Timetable/Routine Upload & OCR** 📸🤖
* Upload an image or screenshot of your timetable/routine.
* Powered by the **Gemini API (`@google/generative-ai`)**, the app automatically analyzes and extracts class names, types (LECTURE or LAB), days of the week, and start/end times.

### 2. **Interactive Routine Review & Custom Slot Creation** ➕
* Review extracted slots in an intuitive modal before saving.
* **+ Add Class Slot Button**: Manually insert missed or new slots at any time.
* **Browser-Native Time Picker**: Clickable clock selectors (`<input type="time" />`) for mobile and desktop precision.
* **Smart Autocomplete**: A combobox dropdown suggesting subjects in your active semester as you type (or allowing custom entries).

### 3. **Attendance Advice & Predictors** 🔮📊
* Real-time recommendation system (e.g., *"Attend next 3 classes"* or *"Safe to skip next 2 classes"*).
* Interactive sliders to simulate how future skip/attendance choices impact target criteria (customizable thresholds like 75% or 60%).
* **Multi-day Bunk Simulator**: Calculates automatic projection of attendance over the next X days based on upcoming slots in the timetable.

### 4. **Teacher Portal & Batch Modes** 🍎🔑
* **PIN Verification**: Share a rotable, unique 4-digit Teacher Edit PIN and a student code with teachers.
* **Live Update Mirroring**: Instructors can view student records and log attendance securely.
* **Batch Mode**: Input multiple comma-separated student codes to unlock and update attendance records simultaneously.

### 5. **Data Management & Sharing** 📂📤
* **Timetable Sharing**: Generate and share a unique code to import a friend's routine instantly.
* **Report Export**: Download complete attendance history logs to CSV file formats.
* **Historical Snapshots**: Archive completed semesters to maintain history logs separate from the active semester.

---

## 🛠️ Tech Stack

* **Framework**: [Next.js 14](https://nextjs.org/) (App Router)
* **Frontend**: React 18, Recharts (visual statistics), Lucide React (icons)
* **Styling**: Modern, premium dark/light themed CSS system with customized micro-animations
* **Database & ORM**: [Prisma ORM](https://www.prisma.io/) with SQLite (local development) and PostgreSQL (production Vercel integration)
* **Authentication**: Token-based sessions with HTTP-only cookies (JWT + bcryptjs)
* **AI Processing**: Google Gemini API via `@google/generative-ai`

---

## ⚙️ Environment Variables Setup

Create a `.env` (or `.env.local`) file in the root directory:

```env
# Database connection string (PostgreSQL for production, SQLite local is file:./dev.db)
DATABASE_URL="file:./dev.db"

# JWT encryption key
JWT_SECRET="your-super-secret-cryptographic-jwt-key"

# Gemini API Key (needed for timetable image parsing)
GEMINI_API_KEY="AIzaSyYourGeminiApiKeyHere..."

# App mode toggles
NEXT_PUBLIC_MOCK_MODE="false"
```

---

## 💻 Local Development Setup

Follow these steps to run the project locally on your machine:

1. **Clone and Install Dependencies**:
   ```bash
   npm install
   ```

2. **Initialize Database**:
   Ensure you have Prisma client generated and your local SQLite schema initialized:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

4. **Production Build**:
   ```bash
   npm run build
   npm run start
   ```

---

## 🌐 Deploy to Vercel

The application is fully compatible with Vercel deployment. Ensure you link the PostgreSQL database in the Vercel project settings and set the required environment variables (`JWT_SECRET`, `GEMINI_API_KEY`, etc.) inside the Vercel project configuration dashboard.
