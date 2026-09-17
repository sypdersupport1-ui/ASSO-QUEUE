'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchPaymentsAction,
  fetchPaymentDetailsAction,
  recordManualPaymentAction,
  processRefundAction,
  reconcilePaymentAction,
} from './actions';
import { PaymentState } from '@/lib/payments/types';

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: PaymentState;
  payment_method: string;
  provider: string;
  provider_reference: string | null;
  refunded_amount: number;
  created_at: string;
  orders?: {
    order_number: string;
    customer_name: string | null;
    customer_phone: string | null;
    status: string;
  };
}

interface PaymentEvent {
  id: string;
  event_type: string;
  actor_type: string;
  created_at: string;
}

interface PaymentAttemptRecord {
  id: string;
  attempt_number: number;
  amount: number;
  status: string;
  payment_method: string;
  provider: string;
  provider_reference: string | null;
  created_at: string;
}

interface PaymentDetailsPayload {
  payment: PaymentRow;
  events: PaymentEvent[];
  attempts: PaymentAttemptRecord[];
}

export default function StaffPaymentsPage() {
  const [restaurantId, setRestaurantId] = useState<string>('');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [details, setDetails] = useState<PaymentDetailsPayload | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);

  // Manual payment modal state
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [manualOrderId, setManualOrderId] = useState<string>('');
  const [manualMethod, setManualMethod] = useState<'CASH' | 'PAY_AT_RESTAURANT'>('CASH');

  // Refund modal state
  const [showRefundModal, setShowRefundModal] = useState<boolean>(false);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Resolve active restaurant from session storage / window
  useEffect(() => {
    const saved = localStorage.getItem('queueflow_active_restaurant_id') || '00000000-0000-0000-0000-000000000001';
    setRestaurantId(saved);
  }, []);

  const loadPayments = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetchPaymentsAction(restaurantId, {
        status: selectedStatus === 'ALL' ? undefined : (selectedStatus as PaymentState),
        search: searchQuery || undefined,
      });
      setPayments(res.payments as PaymentRow[]);
      setTotalCount(res.total);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, selectedStatus, searchQuery]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const inspectPayment = async (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    setDetailsLoading(true);
    try {
      const data = await fetchPaymentDetailsAction(paymentId, restaurantId);
      setDetails(data);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to load details');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrderId) return;
    setActionError(null);
    try {
      await recordManualPaymentAction(restaurantId, manualOrderId, manualMethod);
      setActionSuccess('Manual payment recorded successfully');
      setShowManualModal(false);
      setManualOrderId('');
      loadPayments();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to record manual payment');
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPaymentId || !refundAmount) return;
    setActionError(null);
    try {
      await processRefundAction(
        restaurantId,
        selectedPaymentId,
        parseFloat(refundAmount),
        refundReason
      );
      setActionSuccess('Refund issued successfully');
      setShowRefundModal(false);
      setRefundAmount('');
      setRefundReason('');
      inspectPayment(selectedPaymentId);
      loadPayments();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to process refund');
    }
  };

  const handleReconcile = async (paymentId: string) => {
    setActionError(null);
    try {
      await reconcilePaymentAction(restaurantId, paymentId);
      setActionSuccess('Payment reconciled successfully');
      inspectPayment(paymentId);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to reconcile payment');
    }
  };

  const getStatusBadge = (status: PaymentState) => {
    switch (status) {
      case 'SUCCEEDED':
      case 'COMPLETED':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300';
      case 'PROCESSING':
      case 'PENDING':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300';
      case 'FAILED':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300';
      case 'REFUNDED':
      case 'REFUND_PENDING':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Payments & Transactions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Monitor online payments, manual cash settlements, refunds, and reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
          >
            + Record Cash / Manual Payment
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionError && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {actionSuccess}
        </div>
      )}

      {/* Controls & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex flex-wrap gap-2">
          {['ALL', 'SUCCEEDED', 'PROCESSING', 'PENDING', 'FAILED', 'REFUNDED'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                selectedStatus === st
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-50'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="w-full md:w-64">
          <input
            type="text"
            placeholder="Search provider ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border rounded-md border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Table & Details Drawer Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table View */}
        <div className={`${selectedPaymentId ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {totalCount} Total Payments
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Loading transactions...</div>
          ) : payments.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No payment records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-950/50 text-slate-500 text-xs uppercase border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {payments.map((pm) => (
                    <tr
                      key={pm.id}
                      onClick={() => inspectPayment(pm.id)}
                      className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors ${
                        selectedPaymentId === pm.id ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {pm.orders?.order_number || `#${pm.order_id.slice(0, 6)}`}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        ₹{Number(pm.amount).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">
                        {pm.payment_method} ({pm.provider})
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(pm.status)}`}>
                          {pm.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500">
                        {new Date(pm.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            inspectPayment(pm.id);
                          }}
                          className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                        >
                          Details &rarr;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Drawer */}
        {selectedPaymentId && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-5">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg">
                Payment Detail
              </h3>
              <button
                onClick={() => setSelectedPaymentId(null)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {detailsLoading ? (
              <div className="p-6 text-center text-slate-500 text-sm">Loading details...</div>
            ) : details ? (
              <div className="space-y-4 text-sm">
                <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-lg space-y-1">
                  <div className="text-xs text-slate-500 uppercase font-semibold">Order Number</div>
                  <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                    {details.payment.orders?.order_number || details.payment.order_id}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Amount</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      ₹{Number(details.payment.amount).toFixed(2)} {details.payment.currency}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Refunded</div>
                    <div className="font-bold text-purple-600 dark:text-purple-400">
                      ₹{Number(details.payment.refunded_amount || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Status</div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(details.payment.status)}`}>
                      {details.payment.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Method</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {details.payment.payment_method}
                    </div>
                  </div>
                </div>

                {details.payment.provider_reference && (
                  <div>
                    <div className="text-xs text-slate-500">Provider Reference</div>
                    <div className="font-mono text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded-md break-all">
                      {details.payment.provider_reference}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 flex flex-col gap-2">
                  {(details.payment.status === 'SUCCEEDED' || details.payment.status === 'COMPLETED') && (
                    <button
                      onClick={() => setShowRefundModal(true)}
                      className="w-full py-2 px-3 text-xs font-semibold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 border border-purple-200 rounded-md transition-colors"
                    >
                      Issue Full / Partial Refund
                    </button>
                  )}
                  <button
                    onClick={() => handleReconcile(details.payment.id)}
                    className="w-full py-2 px-3 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-md transition-colors"
                  >
                    Reconcile with Gateway
                  </button>
                </div>

                {/* Timeline / Events */}
                <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                  <h4 className="font-bold text-xs text-slate-500 uppercase tracking-wider mb-2">
                    Audit Event History
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {details.events?.map((ev: PaymentEvent) => (
                      <div key={ev.id} className="text-xs border-l-2 border-indigo-500 pl-2.5 py-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{ev.event_type}</div>
                        <div className="text-slate-400 text-[10px]">
                          By {ev.actor_type} • {new Date(ev.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Manual Payment Modal */}
      {showManualModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">
              Record Manual Payment
            </h3>
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Order ID / Order Number
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter Order ID"
                  value={manualOrderId}
                  onChange={(e) => setManualOrderId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-md border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Payment Method
                </label>
                <select
                  value={manualMethod}
                  onChange={(e) => setManualMethod(e.target.value as 'CASH' | 'PAY_AT_RESTAURANT')}
                  className="w-full px-3 py-2 text-sm border rounded-md border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="CASH">Cash Payment</option>
                  <option value="PAY_AT_RESTAURANT">Pay at Restaurant Counter</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
                >
                  Confirm Cash Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-lg text-slate-900 dark:text-slate-100">
              Issue Refund
            </h3>
            <form onSubmit={handleRefundSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Refund Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="Enter amount to refund"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-md border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Reason for Refund
                </label>
                <input
                  type="text"
                  placeholder="e.g. Order cancelled by customer"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded-md border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRefundModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-md"
                >
                  Confirm Refund
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
