'use client';

import React, { useState } from 'react';
import { Clock, MessageSquare, Send, X, Check, Car, AlertCircle } from 'lucide-react';
import type { QueueLateInfo, QueueChatMessage } from '@/lib/services/queue-service';
import { calculateDelayCountdown } from '@/lib/delay-timer';

interface CustomerLateModalProps {
  token: string;
  restaurantSlug: string;
  customerName: string;
  lateInfo?: QueueLateInfo | null;
  initialMessages?: QueueChatMessage[];
  onSuccess?: () => void;
}

export function CustomerLateModal({
  token,
  restaurantSlug,
  customerName,
  lateInfo,
  initialMessages = [],
  onSuccess,
}: CustomerLateModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'delay' | 'chat'>('delay');
  const [delayMinutes, setDelayMinutes] = useState(10);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<QueueChatMessage[]>(initialMessages);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Tick timer every second
  React.useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Synchronize incoming chat messages from server polling or realtime updates
  React.useEffect(() => {
    if (initialMessages && Array.isArray(initialMessages)) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // Live polling and event listener for chat messages — always active (not just when modal is open)
  // This ensures message count badge stays accurate and messages appear instantly on all devices
  React.useEffect(() => {
    const fetchLatestMessages = async () => {
      try {
        const queryParams = new URLSearchParams({ token, restaurantSlug });
        const res = await fetch(`/api/q/status?${queryParams.toString()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const latestMsgs = data?.status?.chatMessages;
        if (latestMsgs && Array.isArray(latestMsgs)) {
          setMessages(latestMsgs);
        }
      } catch {}
    };

    fetchLatestMessages();
    const interval = setInterval(fetchLatestMessages, 3000);

    const onQueueUpdate = () => {
      fetchLatestMessages();
    };
    window.addEventListener('queue_update', onQueueUpdate);
    window.addEventListener('queue_poll_tick', onQueueUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('queue_update', onQueueUpdate);
      window.removeEventListener('queue_poll_tick', onQueueUpdate);
    };
  }, [token, restaurantSlug]);

  const delayOptions = [5, 10, 15, 20, 30];
  const quickNotes = [
    '🚗 Looking for parking',
    '🚦 Stuck in traffic',
    '🚶 5 mins away, walking over',
    '🚕 In a cab, arriving shortly',
  ];

  const handleReportLate = async () => {
    setIsSubmitting(true);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.set('token', token);
      formData.set('restaurantSlug', restaurantSlug);
      formData.set('delayMinutes', String(delayMinutes));
      formData.set('note', note);

      const res = await fetch('/api/q/late', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Failed to notify restaurant');
      }

      setSuccessMessage(`Host alerted! We noted you'll be ~${delayMinutes} mins late.`);

      // Optimistically add chat message
      setMessages((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          sender: 'customer',
          senderName: customerName || 'You',
          message: `Reported ~${delayMinutes}m late${note ? `: "${note}"` : ''}`,
          createdAt: new Date().toISOString(),
        },
      ]);

      if (onSuccess) onSuccess();
      setTimeout(() => {
        setActiveTab('chat');
        setSuccessMessage(null);
      }, 1500);
    } catch {
      alert('Could not send late notice. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSendingChat) return;

    const msgText = chatInput.trim();
    setChatInput('');
    setIsSendingChat(true);

    // Optimistic message
    const tempMsg: QueueChatMessage = {
      id: `client-${Date.now()}`,
      sender: 'customer',
      senderName: customerName || 'You',
      message: msgText,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const formData = new FormData();
      formData.set('token', token);
      formData.set('restaurantSlug', restaurantSlug);
      formData.set('message', msgText);

      const res = await fetch('/api/q/chat', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Failed to send message');
      }
      if (onSuccess) onSuccess();
    } catch {
      alert('Message failed to send. Please try again.');
    } finally {
      setIsSendingChat(false);
    }
  };

  return (
    <>
      {/* Trigger Button or Banner on Customer Ticket */}
      {lateInfo?.isLate ? (
        (() => {
          const timerResult = calculateDelayCountdown(lateInfo.reportedAt, lateInfo.delayMinutes || 10, nowMs);
          return (
            <div className="customer-glass-surface rounded-2xl border border-[var(--qf-warning)]/40 bg-[var(--qf-warning)]/10 p-3.5 shadow-lg transition-all animate-fadeUp">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-[var(--qf-warning)]/20 border border-[var(--qf-warning)]/40 flex items-center justify-center text-[var(--qf-warning)] shrink-0 mt-0.5">
                    <Clock className="h-4 w-4 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-black text-[var(--qf-warning)] uppercase tracking-wide">
                        Running Late (+{lateInfo.delayMinutes || 10}m)
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-black border flex items-center gap-1 ${
                          timerResult.isExpired
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                            : 'bg-[var(--qf-warning)]/20 text-[var(--qf-warning)] border-[var(--qf-warning)]/40'
                        }`}
                      >
                        ⏱️ {timerResult.isExpired ? '00:00 Expired' : `${timerResult.formatted} left`}
                      </span>
                      {lateInfo.tablePassedToNext && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[9px] font-black uppercase border border-purple-500/30">
                          Table Offered to Next · Spot Held
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                      {lateInfo.tablePassedToNext
                        ? "The host seated the next guest to keep service moving. Your queue priority is held and you'll be seated upon arrival!"
                        : lateInfo.note
                        ? `"${lateInfo.note}" — Host notified.`
                        : "Host notified. We'll hold your spot!"}
                    </p>
                  </div>
                </div>

            <button
              type="button"
              onClick={() => {
                setActiveTab('chat');
                setIsOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-[var(--qf-warning)]/20 hover:bg-[var(--qf-warning)]/30 border border-[var(--qf-warning)]/40 text-[var(--qf-warning)] text-xs font-bold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer active:scale-95"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat {messages.length > 0 ? `(${messages.length})` : ''}</span>
            </button>
          </div>
        </div>
      );
    })()
  ) : (
        <button
          type="button"
          onClick={() => {
            setActiveTab(messages.length > 0 ? 'chat' : 'delay');
            setIsOpen(true);
          }}
          className="customer-glass-control w-full flex items-center justify-between gap-2 p-3 rounded-2xl border border-[var(--qf-warning)]/30 bg-[var(--qf-warning)]/10 hover:bg-[var(--qf-warning)]/15 text-[var(--qf-warning)] transition-all cursor-pointer group shadow-sm active:scale-[0.99]"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-[var(--qf-warning)]/20 flex items-center justify-center text-[var(--qf-warning)] shrink-0">
              {messages.length > 0 ? <MessageSquare className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <div className="text-left">
              <span className="text-xs font-bold text-white block group-hover:text-[var(--qf-warning)] transition-colors">
                {messages.length > 0 ? 'Host Stand Messages' : 'Running late? Let the host know'}
              </span>
              <span className="text-[10px] text-slate-400">
                {messages.length > 0
                  ? `${messages.length} message${messages.length === 1 ? '' : 's'} with restaurant host`
                  : 'We will hold your spot and seat next guest'}
              </span>
            </div>
          </div>
          <span className="text-xs font-black text-[var(--qf-warning)] font-mono px-2 py-1 rounded-lg bg-[var(--qf-warning)]/20 border border-[var(--qf-warning)]/30 shrink-0 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            <span>{messages.length > 0 ? `Chat (${messages.length})` : "I'll be late →"}</span>
          </span>
        </button>
      )}

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="customer-glass-card relative w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-[var(--qf-border)] bg-[var(--qf-surface)]/95 backdrop-blur-xl p-5 sm:p-6 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-2xl bg-[var(--qf-warning)]/20 border border-[var(--qf-warning)]/30 flex items-center justify-center text-[var(--qf-warning)] font-bold">
                  <Car className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Running Late & Host Chat
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Notify host to avoid cancellation and hold your queue turn
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex rounded-xl bg-white/[0.04] p-1 mb-4 border border-white/5">
              <button
                type="button"
                onClick={() => setActiveTab('delay')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'delay'
                    ? 'bg-[var(--qf-warning)] text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                ⏱️ Report Delay
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'chat'
                    ? 'bg-[var(--qf-warning)] text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Live Chat ({messages.length})</span>
              </button>
            </div>

            {/* TAB 1: REPORT DELAY */}
            {activeTab === 'delay' && (
              <div className="space-y-4 overflow-y-auto pr-1">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-2">
                    Estimated Delay
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {delayOptions.map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => setDelayMinutes(mins)}
                        className={`py-2 rounded-xl font-mono font-bold text-xs transition-all border ${
                          delayMinutes === mins
                            ? 'bg-[var(--qf-warning)] text-slate-950 border-[var(--qf-warning)] shadow-md scale-105'
                            : 'bg-white/5 text-slate-300 border-white/10 hover:border-white/20'
                        }`}
                      >
                        +{mins}m
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-2">
                    Quick Status Note
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {quickNotes.map((qNote) => (
                      <button
                        key={qNote}
                        type="button"
                        onClick={() => setNote(qNote)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                          note === qNote
                            ? 'bg-[var(--qf-warning)]/20 border-[var(--qf-warning)] text-[var(--qf-warning)]'
                            : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        {qNote}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Or type custom reason (e.g. traffic on 5th Ave)..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-[var(--qf-warning)]"
                    maxLength={150}
                  />
                </div>

                <div className="p-3 rounded-xl bg-[var(--qf-warning)]/10 border border-[var(--qf-warning)]/20 text-slate-300 text-[11px] flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-[var(--qf-warning)] shrink-0 mt-0.5" />
                  <span>
                    To keep wait times low for everyone, the host may seat the next waiting guest while you travel. Your spot is held and you will be seated as soon as you arrive!
                  </span>
                </div>

                {successMessage && (
                  <div className="p-2.5 rounded-xl bg-[var(--qf-success)]/20 border border-[var(--qf-success)]/40 text-[var(--qf-success)] text-xs font-bold text-center animate-fadeUp">
                    {successMessage}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleReportLate}
                  disabled={isSubmitting}
                  className="customer-primary-cta w-full min-h-[48px] h-12 rounded-2xl font-bold text-sm shadow-lg transition-all cursor-pointer active:scale-[0.99] flex items-center justify-center gap-2"
                >
                  <Check className="h-4 w-4" />
                  <span>{isSubmitting ? 'Notifying Host...' : `Notify Host (+${delayMinutes} mins)`}</span>
                </button>
              </div>
            )}

            {/* TAB 2: TWO-WAY CHAT */}
            {activeTab === 'chat' && (
              <div className="flex flex-col flex-1 min-h-[300px] overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-2.5 p-2 bg-black/20 rounded-2xl border border-white/5 mb-3">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                      <MessageSquare className="h-8 w-8 mb-2 opacity-40 text-[var(--qf-primary)]" />
                      <p className="text-xs font-medium">No messages yet.</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">Send a quick note to the host stand.</p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isCustomer = m.sender === 'customer';
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
                        >
                          <span className="text-[9px] text-slate-500 mb-0.5 px-1">
                            {m.senderName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div
                            className={`max-w-[82%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                              isCustomer
                                ? 'customer-primary-cta font-medium rounded-tr-none'
                                : 'bg-slate-800 border border-white/10 text-white rounded-tl-none'
                            }`}
                          >
                            {m.message}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Chat Input */}
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Message the host stand..."
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-[var(--qf-primary)]"
                    maxLength={250}
                  />
                  <button
                    type="submit"
                    disabled={isSendingChat || !chatInput.trim()}
                    className="customer-primary-cta h-10 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Send</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
