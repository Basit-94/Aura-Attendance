import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aura Attendance',
    short_name: 'AuraAttend',
    description: 'Smart attendance tracking and predictor advisor for students and teachers',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0f19',
    theme_color: '#4f46e5',
    icons: [
      {
        src: 'https://cdn-icons-png.flaticon.com/512/3200/3200742.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: 'https://cdn-icons-png.flaticon.com/512/3200/3200742.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      }
    ],
  };
}
