'use client';

import React, { useRef, useState, useEffect } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  QrCode,
  Sparkles,
  Copy,
  Check,
  Download,
  Printer,
  ExternalLink,
  ShieldCheck,
  Zap,
  Bell,
  UtensilsCrossed,
  Smartphone,
  Layers,
} from 'lucide-react';

type StandeeTheme = 'gold' | 'emerald' | 'ruby';

export function QRManagerClient({
  restaurantName,
  qrUrl,
}: {
  restaurantName: string;
  qrUrl: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [theme, setTheme] = useState<StandeeTheme>('gold');
  const [effectiveQrUrl, setEffectiveQrUrl] = useState(qrUrl);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      try {
        const parsed = new URL(qrUrl, window.location.origin);
        if (window.location.origin.includes('vercel.app') || window.location.origin.includes('localhost') === false) {
          setEffectiveQrUrl(`${window.location.origin}${parsed.pathname}${parsed.search}`);
        }
      } catch {
        setEffectiveQrUrl(qrUrl);
      }
    }
  }, [qrUrl]);

  const qrSize = size === 'sm' ? 190 : size === 'lg' ? 270 : 230;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(effectiveQrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      alert(effectiveQrUrl);
    }
  };

  const handleDownloadPNG = () => {
    const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
    if (qrCanvas) {
      const url = qrCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${restaurantName.replace(/\s+/g, '-').toLowerCase()}-official-qr.png`;
      a.click();
    }
  };

  const handlePrint = () => window.print();

  // Theme palettes for lucrative showcase
  const themeStyles = {
    gold: {
      cardBorder: 'border-amber-400/40 shadow-[0_0_50px_rgba(245,158,11,0.22)]',
      glow: 'from-amber-500/25 via-orange-500/15 to-transparent',
      badge: 'border-amber-400/50 bg-amber-500/20 text-amber-200',
      heading: 'from-amber-200 via-white to-amber-300',
      accentBorder: 'border-amber-400',
      accentText: 'text-amber-400',
      pillBg: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
      qrBorder: 'border-amber-300/40 shadow-amber-500/20',
    },
    emerald: {
      cardBorder: 'border-emerald-400/40 shadow-[0_0_50px_rgba(16,185,129,0.22)]',
      glow: 'from-emerald-500/25 via-teal-500/15 to-transparent',
      badge: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200',
      heading: 'from-emerald-200 via-white to-teal-300',
      accentBorder: 'border-emerald-400',
      accentText: 'text-emerald-400',
      pillBg: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
      qrBorder: 'border-emerald-300/40 shadow-emerald-500/20',
    },
    ruby: {
      cardBorder: 'border-rose-400/40 shadow-[0_0_50px_rgba(244,63,94,0.22)]',
      glow: 'from-rose-500/25 via-amber-500/15 to-transparent',
      badge: 'border-rose-400/50 bg-rose-500/20 text-rose-200',
      heading: 'from-rose-200 via-white to-amber-200',
      accentBorder: 'border-rose-400',
      accentText: 'text-rose-400',
      pillBg: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
      qrBorder: 'border-rose-300/40 shadow-rose-500/20',
    },
  }[theme];

  return (
    <div className="flex flex-col w-full min-h-screen text-white p-4 sm:p-6 md:p-8 gap-6 max-w-6xl mx-auto">
      {/* Top Luxury Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-amber-500/25 border border-amber-300/30">
            <QrCode className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-sm">
                Smart QR Standee &amp; Pass
              </h1>
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 text-emerald-300 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live System
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              High-resolution printable host standee &amp; guest digital touchpoint for <strong className="text-amber-200">{restaurantName}</strong>
            </p>
          </div>
        </div>

        {/* Quick actions top pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="px-3.5 py-2 rounded-xl text-xs font-black bg-white/5 hover:bg-white/10 border border-white/15 text-slate-200 flex items-center gap-1.5 transition-all active:scale-[0.98]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
            <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
          </button>
          <a
            href={effectiveQrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white flex items-center gap-1.5 transition-all shadow-md shadow-orange-500/20 active:scale-[0.98]"
          >
            <span>Preview Guest Flow</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: FLASHY LUXURY STANDEE PREVIEW (Col 1 to 7) */}
        <div className="lg:col-span-7 flex flex-col items-center">
          {/* Printable Standee Preview Box */}
          <div
            id="print-standee"
            className={`w-full max-w-[440px] bg-gradient-to-b from-[#141724] via-[#0d0f18] to-[#07080d] border-2 ${themeStyles.cardBorder} rounded-[32px] p-7 sm:p-9 flex flex-col items-center shadow-2xl relative overflow-hidden transition-all duration-300`}
          >
            {/* Ambient Background Aura Lights */}
            <div
              aria-hidden="true"
              className={`absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-52 bg-gradient-to-b ${themeStyles.glow} blur-[60px] rounded-full pointer-events-none opacity-80`}
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-80 h-40 bg-amber-500/10 blur-[50px] rounded-full pointer-events-none"
            />

            {/* Shimmering Top Bar */}
            <div className="flex items-center justify-between w-full relative z-10 mb-4 px-1">
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${themeStyles.badge} backdrop-blur-md shadow-sm`}>
                <Sparkles className="h-3 w-3 animate-pulse" />
                Official Queue Pass
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Verified Stand
              </span>
            </div>

            {/* Restaurant Brand Header with Luxury Typography */}
            <div className="text-center relative z-10 space-y-1">
              <h2 className="font-serif text-2xl sm:text-3xl font-extrabold tracking-wider uppercase text-white drop-shadow-[0_2px_12px_rgba(245,158,11,0.25)]">
                {restaurantName}
              </h2>
              <div className="h-0.5 w-16 mx-auto bg-gradient-to-r from-transparent via-amber-400 to-transparent my-1.5" />
              <p className={`text-sm sm:text-base font-black tracking-tight bg-gradient-to-r ${themeStyles.heading} bg-clip-text text-transparent`}>
                Scan with Phone Camera to Join
              </p>
              <p className="text-[11px] text-slate-300 font-medium">
                No app download required · Instant digital ticket
              </p>
            </div>

            {/* QR Centerpiece Frame with Holographic Scanner Corners */}
            <div className="mt-6 relative z-10">
              {/* Luxury Frame Container */}
              <div className="p-4 sm:p-5 bg-white rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.6)] border-2 border-slate-100 relative group transition-transform duration-300 hover:scale-[1.01]">
                {/* Scanner HUD Crosshairs */}
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-amber-500 rounded-tl-lg pointer-events-none" />
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-amber-500 rounded-tr-lg pointer-events-none" />
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-amber-500 rounded-bl-lg pointer-events-none" />
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-amber-500 rounded-br-lg pointer-events-none" />

                {/* QR Code SVG Display */}
                <div id="qr-svg-wrap" className="bg-white rounded-2xl overflow-hidden flex items-center justify-center p-1">
                  <QRCodeSVG
                    id="qr-svg"
                    value={effectiveQrUrl}
                    size={qrSize}
                    level="H"
                    includeMargin={false}
                    bgColor="#ffffff"
                    fgColor="#080b12"
                  />
                  {/* High-res 1024px canvas for crystal clear PNG download */}
                  <div className="hidden">
                    <QRCodeCanvas
                      id="qr-canvas"
                      ref={canvasRef as unknown as React.Ref<HTMLCanvasElement>}
                      value={effectiveQrUrl}
                      size={1024}
                      level="H"
                      bgColor="#ffffff"
                      fgColor="#080b12"
                    />
                  </div>
                </div>

                {/* Subtle Center Brand Pill Below QR */}
                <div className="mt-2 text-center">
                  <span className="inline-flex items-center gap-1 text-[9px] font-black tracking-widest text-slate-700 uppercase">
                    <span>⚡ POWERED BY ASSO QUEUE</span>
                  </span>
                </div>
              </div>
            </div>

            {/* One-Touch Link Pill */}
            <div
              onClick={handleCopy}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-slate-200 font-mono text-[11px] max-w-full truncate cursor-pointer transition-all active:scale-[0.98] relative z-10 shadow-sm group"
            >
              <span className={`material-symbols-outlined text-[15px] ${themeStyles.accentText} group-hover:scale-110 transition-transform`}>
                link
              </span>
              <span className="truncate font-semibold text-slate-300">
                {effectiveQrUrl.replace(/^https?:\/\//, '')}
              </span>
              <span className="ml-1 text-[10px] uppercase font-black text-amber-300 bg-amber-400/20 px-2 py-0.5 rounded-full">
                {copied ? 'Copied! ✓' : 'Tap to Copy'}
              </span>
            </div>

            {/* 3 High-Impact Flashy Perk Capsules */}
            <div className="mt-7 grid grid-cols-3 gap-2 w-full relative z-10 border-t border-white/10 pt-5">
              <div className="flex flex-col items-center text-center p-2 rounded-2xl bg-white/[0.04] border border-white/5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-1 text-emerald-400">
                  <Zap className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-white">Instant</span>
                <span className="text-[9px] text-slate-400 font-medium">10s Join</span>
              </div>

              <div className="flex flex-col items-center text-center p-2 rounded-2xl bg-white/[0.04] border border-white/5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mb-1 text-blue-400">
                  <Bell className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-white">SMS &amp; Chime</span>
                <span className="text-[9px] text-slate-400 font-medium">Table Alerts</span>
              </div>

              <div className="flex flex-col items-center text-center p-2 rounded-2xl bg-white/[0.04] border border-white/5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-1 text-amber-400">
                  <UtensilsCrossed className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-white">Pre-Order</span>
                <span className="text-[9px] text-slate-400 font-medium">Live Menu</span>
              </div>
            </div>

            {/* Standee Base Signature */}
            <div className="mt-5 text-center relative z-10">
              <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                Host Stand Official Digital Ticket Pass
              </p>
            </div>
          </div>
        </div>

        {/* Right: CONTROLS & MANAGEMENT SUITE (Col 8 to 12) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Theme Palette Switcher */}
          <div className="bg-[#111420] border border-white/10 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Layers className="h-4 w-4 text-amber-400" />
                Standee Style &amp; Mood
              </h3>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Live Preview
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setTheme('gold')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  theme === 'gold'
                    ? 'border-amber-400 bg-amber-500/25 text-amber-200 shadow-md shadow-amber-500/20'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span>Gold Luxury</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme('emerald')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  theme === 'emerald'
                    ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200 shadow-md shadow-emerald-500/20'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span>Neon Emerald</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme('ruby')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  theme === 'ruby'
                    ? 'border-rose-400 bg-rose-500/25 text-rose-200 shadow-md shadow-rose-500/20'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span>Royal Ruby</span>
              </button>
            </div>
          </div>

          {/* Size Selector */}
          <div className="bg-[#111420] border border-white/10 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-white">QR Code Scale</h3>
              <span className="text-[10px] font-bold text-slate-400">
                {size === 'sm' ? '190px (Table Tent)' : size === 'md' ? '230px (Counter Stand)' : '270px (A4 Entrance Poster)'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['sm', 'md', 'lg'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`h-11 rounded-xl border text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                    size === s
                      ? 'bg-white text-[#0A0E17] border-white shadow-lg shadow-white/20'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {s === 'sm' ? 'Compact' : s === 'md' ? 'Standard' : 'Entrance A4'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Scale adjusts the display dimensions for optimal camera scanning distance.
            </p>
          </div>

          {/* Action Suite: Download, Print, Copy */}
          <div className="bg-[#111420] border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl">
            <h3 className="text-sm font-black text-white">Export &amp; Print Assets</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleDownloadPNG}
                className="h-12 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>Download PNG</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="h-12 rounded-xl bg-white text-[#0A0E17] hover:bg-slate-100 font-black text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] cursor-pointer"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Copied! ✓' : 'Copy Queue Link'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrint}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-black text-sm flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            >
              <Printer className="h-4 w-4 text-amber-300" />
              <span>Print Ready A4 Standee Poster</span>
            </button>

            <a
              href={effectiveQrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold text-xs flex items-center justify-center gap-2 transition-all hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open Customer Experience Tab</span>
            </a>
          </div>

          {/* Quick Host Guidance Card */}
          <div className="bg-[#111420] border border-white/10 rounded-2xl p-5 shadow-xl space-y-3">
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-amber-400" />
              How Guests Join
            </h3>

            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.03]">
                <span className="h-5 w-5 rounded-full bg-amber-400/20 text-amber-300 flex items-center justify-center font-black shrink-0 text-[11px]">
                  1
                </span>
                <p>
                  Place the printed standee at your <strong className="text-white">Host Stand or Entrance</strong>.
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.03]">
                <span className="h-5 w-5 rounded-full bg-amber-400/20 text-amber-300 flex items-center justify-center font-black shrink-0 text-[11px]">
                  2
                </span>
                <p>
                  Guests scan with camera app and enter party size in <strong className="text-white">10 seconds</strong>.
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.03]">
                <span className="h-5 w-5 rounded-full bg-amber-400/20 text-amber-300 flex items-center justify-center font-black shrink-0 text-[11px]">
                  3
                </span>
                <p>
                  Phone rings with loud pager buzzer when host calls them!
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Luxury Print Stylesheet for High-End A4 Poster Output */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-standee, #print-standee * {
            visibility: visible;
          }
          #print-standee {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%) scale(1.15);
            box-shadow: none !important;
            border: 2px solid #000 !important;
            background: #ffffff !important;
            color: #000000 !important;
            width: 90% !important;
            max-width: 500px !important;
          }
          #print-standee h2, #print-standee p, #print-standee span {
            color: #000000 !important;
            background: none !important;
            -webkit-text-fill-color: initial !important;
          }
        }
      `}</style>
    </div>
  );
}
