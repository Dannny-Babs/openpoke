import type { Metadata } from 'next';
import './globals.css';
import { Feedback } from '@/components/ui/Feedback';

export const metadata: Metadata = {
  title: 'OpenPoke Chat',
  description: 'A personal assistant with saved task history.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}<Feedback />
      </body>
    </html>
  );
}

