import './globals.css';
import type { Metadata } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

export const metadata: Metadata = {
  title: 'AuraAttend | Premium Attendance Tracker',
  description: 'Smart attendance tracking and predictor advisor for students and teachers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="glow-orb-3" />
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
