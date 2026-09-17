'use client';

import React, { useState } from 'react';
import { MessageSquare, Send, X, ArrowRightCircle, Clock, AlertTriangle } from 'lucide-react';
import { sendQueueChatMessageAction, passTableToNextAction } from '@/app/dashboard/actions';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';
import type { QueueChatMessage, QueueLateInfo } from '@/lib/services/queue-service';

interface StaffQueueChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueEntryId: string;
  customerName: string;
  ticketDisplayNumber: string;
  lateInfo?: QueueLateInfo | null;
  initialMessages?: QueueChatMessage[];
  onActionComplete?: () => void;
}

export function StaffQueueChatModal({
  isOpen,
  onClose,
  queueEntryId,
  customerName,
  ticketDisplayNumber,
  lateInfo,
  initialMessages = [],
  onActionComplete,
}: StaffQueueChatModalProps) {
  const [messages, setMessages] = useState<QueueChatMessage[]>(initialMessages);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isPassingTable, setIsPassingTable] = useState(false);

  if (!isOpen) return null;

  const quickReplies = [
    "No problem! We've held your spot.",
    'Table ready as soon as you step inside.',
    'Seating next guest now; yours is next upon arrival!',
  ];

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText('');

    // Optimistic message
    const tempMsg: QueueChatMessage = {
      id: `staff-${Date.now()}`,
      sender: 'staff',
      senderName: 'Host Stand',
      message: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      await sendQueueChatMessageAction({
        queueEntryId,
        message: text,
      });
      await broadcastCustomerQueueUpdate(queueEntryId);
    } catch (e) {
      console.error('Failed to send staff message:', e);
      alert('Could not send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handlePassToNext = async () => {
    if (isPassingTable) return;
    const confirmed = confirm(
      `Pass table to the next customer in line? \n\n${customerName}'s queue priority will be held, and they will receive a notification that their spot is safe for when they arrive.`
    );
    if (!confirmed) return;

    setIsPassingTable(true);
    try {
      await passTableToNextAction(queueEntryId);
      await broadcastCustomerQueueUpdate(queueEntryId);

      setMessages((prev) => [
        ...prev,
        {
          id: `pass-${Date.now()}`,
          sender: 'staff',
          senderName: 'Host Stand',
          message: "Table passed to next waiting party. Customer spot held for arrival.",
          createdAt: new Date().toISOString(),
        },
      ]);

      if (onActionComplete) onActionComplete();
    } catch (e) {
      console.error('Failed to pass table:', e);
      alert('Could not pass table to next customer. Please try again.');
    } finally {
      setIsPassingTable(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0F1420] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/5 bg-[#141B2D]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-mono font-bold text-xs shrink-0">
              {ticketDisplayNumber}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-white">{customerName}</h3>
                {lateInfo?.isLate && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>+{lateInfo.delayMinutes || 10}m late</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Direct Guest Communications & Spot Hold
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Customer Late Alert & Pass-to-Next Action Bar */}
        {lateInfo?.isLate && (
          <div className="p-3.5 bg-amber-500/10 border-b border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="text-xs text-slate-300">
                <span className="font-bold text-amber-300">Guest reported delay: </span>
                {lateInfo.note ? `"${lateInfo.note}"` : `~${lateInfo.delayMinutes} mins late`}
              </div>
            </div>

            <button
              type="button"
              onClick={handlePassToNext}
              disabled={isPassingTable || lateInfo.tablePassedToNext}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer shrink-0"
            >
              <ArrowRightCircle className="h-3.5 w-3.5" />
              <span>
                {lateInfo.tablePassedToNext
                  ? 'Table Passed to Next'
                  : isPassingTable
                  ? 'Passing...'
                  : 'Seat Next & Hold Table'}
              </span>
            </button>
          </div>
        )}

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[260px] bg-black/30">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <MessageSquare className="h-10 w-10 mb-2 opacity-30 text-cyan-400" />
              <p className="text-sm font-semibold text-slate-400">No communication recorded</p>
              <p className="text-xs text-slate-500 mt-1">Send a greeting or arrival instructions to the guest.</p>
            </div>
          ) : (
            messages.map((m) => {
              const isStaff = m.sender === 'staff';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isStaff ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[10px] text-slate-500 mb-1 px-1">
                    {isStaff ? 'Host Stand (You)' : customerName} ·{' '}
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div
                    className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                      isStaff
                        ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-medium rounded-tr-none shadow-md'
                        : 'bg-[#1E293B] border border-white/10 text-slate-100 rounded-tl-none'
                    }`}
                  >
                    {m.message}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Responses */}
        <div className="px-4 py-2 border-t border-white/5 bg-[#141B2D]/50 flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Quick:</span>
          {quickReplies.map((qr) => (
            <button
              key={qr}
              type="button"
              onClick={() => handleSend(qr)}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] text-slate-300 hover:text-white whitespace-nowrap transition-all cursor-pointer"
            >
              {qr}
            </button>
          ))}
        </div>

        {/* Chat Input */}
        <div className="p-3 sm:p-4 border-t border-white/5 bg-[#141B2D]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Send a message to ${customerName}...`}
              className="flex-1 px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-400"
              maxLength={300}
            />
            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="h-10 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
