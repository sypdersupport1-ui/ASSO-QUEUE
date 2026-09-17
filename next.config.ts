import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion', 'qrcode.react'],
  },
  async headers() {
    return [
      {
        // Apply strict security headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            // HSTS: 2 years, include subdomains, preload — production only; dev browsers may cache
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Strict referrer: never send full URL to third parties, only origin to same-origin
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Disable unnecessary browser features
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
          },
          {
            // Permissive CSP that allows Supabase auth, Razorpay payment widget, and application inline styles.
            // Intentionally not blocking inline scripts to preserve Next.js hydration and Razorpay widget.
            // For a stricter CSP, hashes/nonces would be required for every inline script.
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Supabase API, auth, realtime
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com",
              // Scripts: self + Next.js chunks + Razorpay widget
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://checkout.razorpay.com",
              // Styles: self + inline (Next.js uses inline styles for critical CSS)
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Fonts
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + data URIs (for base64 logos/QR codes)
              "img-src 'self' data: https://*.supabase.co",
              // Frames: allow Razorpay checkout iframe
              "frame-src https://checkout.razorpay.com https://api.razorpay.com",
              // Form submissions: self only
              "form-action 'self'",
              // Block all plugins
              "object-src 'none'",
              // Report URI placeholder (configure in production)
              // "report-uri /api/csp-report",
            ].join('; '),
          },
        ],
      },
      {
        // Customer QR status pages: allow embedding in QR scanners' in-app browsers
        // Remove X-Frame-Options DENY for these routes specifically
        source: '/q/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
