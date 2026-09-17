import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QueueFlow - Restaurant Operations Platform',
  description: 'Multi-tenant restaurant SaaS platform foundation',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover' as const,
  themeColor: '#0A0E17',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('queueflow-theme');const l=window.matchMedia('(prefers-color-scheme: light)').matches;const m=t||(l?'light':'dark');if(m==='light')document.documentElement.classList.add('light')}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-background font-body-md text-on-surface antialiased min-h-[100dvh] supports-[min-height:100dvh]:min-h-[100dvh]">
        {children}
      </body>
    </html>
  );
}
