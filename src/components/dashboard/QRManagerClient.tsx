'use client';

import React, { useRef, useState, useEffect } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';

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
  const [effectiveQrUrl, setEffectiveQrUrl] = useState(qrUrl);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      try {
        const parsed = new URL(qrUrl, window.location.origin);
        // If current origin is available and qrUrl points to localhost or preview hash,
        // sync to current window origin so scanned QR matches active host
        if (window.location.origin.includes('vercel.app') || window.location.origin.includes('localhost') === false) {
          setEffectiveQrUrl(`${window.location.origin}${parsed.pathname}${parsed.search}`);
        }
      } catch {
        setEffectiveQrUrl(qrUrl);
      }
    }
  }, [qrUrl]);

  const qrSize = size === 'sm' ? 180 : size === 'lg' ? 260 : 220;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(effectiveQrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(effectiveQrUrl);
    }
  };

  const handleDownloadPNG = () => {
    const svg = document.querySelector('#qr-svg') as unknown as SVGElement;
    if (!svg) return;
    // Use canvas QR for PNG
    const qrCanvas = document.getElementById('qr-canvas') as HTMLCanvasElement;
    if (qrCanvas) {
      const url = qrCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${restaurantName.replace(/\s+/g, '-').toLowerCase()}-qr.png`;
      a.click();
    }
  };

  const handlePrint = () => window.print();

  return (
    <div className="flex flex-col w-full min-h-screen text-white p-4 sm:p-6 md:p-8 gap-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow-lg">
            <span className="material-symbols-outlined text-white text-[20px]">qr_code_2</span>
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">QR Code</h1>
            <p className="text-xs text-slate-400">Print and place at host stand · guests scan to join queue</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left: QR Preview - balanced, not full white */}
        <div className="bg-[#111827] border border-white/5 rounded-[28px] p-6 sm:p-8 flex flex-col items-center shadow-2xl relative overflow-hidden">
          {/* subtle glow */}
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-96 h-40 bg-emerald-500/10 blur-[50px] rounded-full pointer-events-none"></div>
          <div className="flex items-center gap-2 mb-5 relative z-10">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow">
              <span className="material-symbols-outlined text-white text-[14px]">restaurant</span>
            </div>
            <span className="font-black tracking-widest text-[11px] text-white uppercase">{restaurantName}</span>
          </div>

          <h2 className="text-[18px] font-black text-white text-center leading-tight relative z-10">
            Scan to Join Queue
          </h2>
          <p className="text-[11px] text-slate-400 text-center mt-1 max-w-[260px] relative z-10">
            No app needed · join in 10 seconds
          </p>

          <div className="mt-6 p-3 bg-white rounded-2xl shadow-lg border border-slate-100 relative z-10">
            <div id="qr-svg-wrap" className="bg-white rounded-xl overflow-hidden">
              <QRCodeSVG
                id="qr-svg"
                value={effectiveQrUrl}
                size={qrSize}
                level="H"
                includeMargin={false}
                bgColor="#ffffff"
                fgColor="#0A0E17"
              />
              <div className="hidden">
                <QRCodeCanvas
                  id="qr-canvas"
                  ref={canvasRef as unknown as React.Ref<HTMLCanvasElement>}
                  value={effectiveQrUrl}
                  size={1024}
                  level="H"
                  bgColor="#ffffff"
                  fgColor="#0A0E17"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white font-mono text-[11px] max-w-full truncate relative z-10">
            <span className="material-symbols-outlined text-[14px] text-emerald-400">link</span>
            <span className="truncate">{effectiveQrUrl.replace(/^https?:\/\//, '')}</span>
          </div>

          <div className="mt-6 flex items-center gap-5 relative z-10">
            <span className="flex flex-col items-center gap-1">
              <span className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"><span className="material-symbols-outlined text-emerald-400 text-[16px]">bolt</span></span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">No App</span>
            </span>
            <span className="w-px h-8 bg-white/10"></span>
            <span className="flex flex-col items-center gap-1">
              <span className="w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><span className="material-symbols-outlined text-blue-400 text-[16px]">notifications</span></span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">SMS Alert</span>
            </span>
            <span className="w-px h-8 bg-white/10"></span>
            <span className="flex flex-col items-center gap-1">
              <span className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><span className="material-symbols-outlined text-amber-400 text-[16px]">restaurant</span></span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Pre-Order</span>
            </span>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex flex-col gap-4">
          {/* Size selector */}
          <div className="bg-[#111827] border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-white mb-3">Size</h3>
            <div className="grid grid-cols-3 gap-2">
              {(['sm','md','lg'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`h-11 rounded-xl border text-sm font-bold capitalize transition-colors ${size===s ? 'bg-white text-[#0A0E17] border-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                >
                  {s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Large = best for A4 print · Small = table tent</p>
          </div>

          {/* Actions */}
          <div className="bg-[#111827] border border-white/5 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">Use this QR</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button onClick={handleCopy} className="h-11 rounded-xl bg-white text-[#0A0E17] font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-100 active:scale-[0.98] transition-all">
                <span className="material-symbols-outlined text-[18px]">{copied ? 'check' : 'content_copy'}</span>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <button onClick={handleDownloadPNG} className="h-11 rounded-xl bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-emerald-600 active:scale-[0.98] transition-all">
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download PNG
              </button>
            </div>
            <button onClick={handlePrint} className="w-full h-11 rounded-xl bg-white/5 border border-white/10 text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-white/10 active:scale-[0.98] transition-all">
              <span className="material-symbols-outlined text-[18px]">print</span>
              Print (A4 ready)
            </button>
            <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="block w-full h-11 rounded-xl bg-[#0A0E17] border border-white/10 text-slate-300 font-bold text-sm flex items-center justify-center gap-2 hover:text-white hover:border-white/20">
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              Open Customer Page
            </a>
          </div>

          {/* Instructions */}
          <div className="bg-[#111827] border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-400 text-[18px]">lightbulb</span>
              How to use
            </h3>
            <ol className="space-y-2 text-sm text-slate-300 list-decimal list-inside">
              <li>Print this QR and place at <b className="text-white">host stand</b></li>
              <li>Guests scan → join queue in 10 sec (no app)</li>
              <li>They get SMS + live ticket on phone</li>
            </ol>
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-2">
              <span className="material-symbols-outlined text-amber-400 text-[18px] shrink-0">info</span>
              <p className="text-xs text-amber-200/80 leading-relaxed">Each restaurant has its own link. This QR only works for <b className="text-amber-200">{restaurantName}</b>. Test by scanning with your phone camera.</p>
            </div>
          </div>
        </div>
      </div>

      <style>{`@media print { body * { visibility: hidden; } #qr-svg-wrap, #qr-svg-wrap * { visibility: visible; } #qr-svg-wrap { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); } }`}</style>
    </div>
  );
}
