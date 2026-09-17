'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ChevronRight, Layers, Zap, Shield, Smartphone } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 overflow-hidden relative">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-emerald-500/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-violet-600/10 blur-[150px] rounded-full pointer-events-none" />

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Layers className="w-5 h-5 text-slate-950" />
          </div>
          <span className="font-bold text-xl tracking-tight text-white">QueueFlow</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
            Sign In
          </Link>
          <Link href="/platform" className="text-sm font-semibold bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2 rounded-full backdrop-blur-md transition-all">
            Dashboard
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm font-semibold text-emerald-400 mb-8"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          Production Architecture Active
        </motion.div>
        
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-5xl md:text-7xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-6"
        >
          The Future of Restaurant<br />Queue Management
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-2xl mx-auto text-lg md:text-xl text-slate-400 leading-relaxed mb-10"
        >
          An enterprise-grade platform built with next-generation infrastructure. 
          Manage multi-tenant restaurants, real-time queues, and live analytics with zero compromise on performance.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/login" className="group flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-8 py-4 rounded-full transition-all shadow-lg shadow-emerald-500/25">
            Access Platform
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a href="#features" className="text-sm font-medium text-slate-300 hover:text-white px-8 py-4 transition-colors">
            Explore Architecture
          </a>
        </motion.div>
      </div>

      {/* Tech Stack Grid */}
      <motion.div 
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.4 }}
        className="relative z-10 max-w-5xl mx-auto px-6 pb-32"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-8 backdrop-blur-xl hover:bg-slate-800/50 transition-colors">
            <Zap className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Real-Time Core</h3>
            <p className="text-sm text-slate-400">Powered by Next.js App Router and resilient Redis caching for instantaneous state synchronization across all clients.</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-8 backdrop-blur-xl hover:bg-slate-800/50 transition-colors">
            <Shield className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Secure Isolation</h3>
            <p className="text-sm text-slate-400">Granular Row Level Security (RLS) and strict Supabase Auth boundaries ensure true multi-tenant data isolation.</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-8 backdrop-blur-xl hover:bg-slate-800/50 transition-colors">
            <Smartphone className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Responsive Design</h3>
            <p className="text-sm text-slate-400">Beautiful, adaptive interfaces built with Tailwind CSS and Framer Motion, optimized for mobile POS and customer devices.</p>
          </div>
        </div>
      </motion.div>
    </main>
  );
}
