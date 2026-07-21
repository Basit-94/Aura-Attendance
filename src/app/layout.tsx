import './globals.css';
import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/react';

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'AuraAttend | Premium Attendance Tracker',
  description: 'Smart attendance tracking and predictor advisor for students and teachers',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'AuraAttend',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={outfit.className}>
      <body>
        <div className="glow-orb-3" />
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

