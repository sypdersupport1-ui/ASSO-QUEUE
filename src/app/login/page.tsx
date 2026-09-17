'use client';

import { useActionState } from 'react';
import { loginAction } from './actions';
import { motion } from 'framer-motion';
import { Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-slate-100 relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="absolute top-8 left-8 right-8 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-slate-400 hover:text-white transition-colors flex items-center gap-2">
          &larr; Back to Platform
        </Link>
        <ThemeToggle />
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md relative z-10"
      >
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ShieldCheck className="w-6 h-6 text-slate-950" />
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Welcome Back</h1>
            <p className="mt-2 text-sm text-slate-400">Sign in to your administrative dashboard</p>
          </div>

          {state?.error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-400 text-center"
            >
              {state.error}
            </motion.div>
          )}

          <form action={formAction} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="superadmin@queueflow.io"
                  className="block w-full pl-10 pr-3 py-3 rounded-xl border border-slate-700 bg-slate-950/50 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wider">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="password"
                  name="password"
                  required
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-3 py-3 rounded-xl border border-slate-700 bg-slate-950/50 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="group relative w-full flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 overflow-hidden"
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                {isPending ? 'Authenticating...' : 'Secure Sign In'}
                {!isPending && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
              </button>
            </div>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500">
              Protected by military-grade encryption &bull; v1.0.0
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
