'use client';

import React, { useState, useMemo } from 'react';
import { createStaffTakeawayOrderAction } from '@/app/dashboard/actions';
import { broadcastCustomerQueueUpdate } from '@/lib/realtime/useCustomerQueueRealtime';

export interface StaffTakeawayMenuItem {
  id: string;
  name: string;
  price: number;
  description?: string | null;
  available: boolean;
  active: boolean;
  categoryName?: string | null;
}

interface CartLineItem {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes: string;
}

interface StaffTakeawayOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueEntry: {
    id: string;
    display_number?: string | null;
    queue_number?: number | null;
    customer_name?: string | null;
    customer_phone?: string | null;
  };
  menuItems: StaffTakeawayMenuItem[];
  currencySymbol?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onOrderCreated?: (order: any) => void;
}

export function StaffTakeawayOrderModal({
  isOpen,
  onClose,
  queueEntry,
  menuItems,
  currencySymbol = '₹',
  onOrderCreated,
}: StaffTakeawayOrderModalProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cart, setCart] = useState<CartLineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rawNum = (queueEntry.display_number || queueEntry.queue_number || '').toString();
  const ticketDisplay = rawNum.startsWith('T-') ? rawNum : `T-${rawNum.replace(/^#+/, '')}`;

  // Unique categories for filtering
  const categories = useMemo(() => {
    const cats = new Set<string>();
    menuItems.forEach((i) => {
      if (i.categoryName) cats.add(i.categoryName);
    });
    return ['ALL', ...Array.from(cats)];
  }, [menuItems]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      if (!item.active || !item.available) return false;
      if (selectedCategory !== 'ALL' && item.categoryName !== selectedCategory) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesDesc = (item.description || '').toLowerCase().includes(q);
        return matchesName || matchesDesc;
      }
      return true;
    });
  }, [menuItems, selectedCategory, search]);

  const addToCart = (item: StaffTakeawayMenuItem) => {
    setErrorMsg(null);
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          unitPrice: Number(item.price),
          quantity: 1,
          notes: '',
        },
      ];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.id === itemId) {
            const nextQty = c.quantity + delta;
            return nextQty > 0 ? { ...c, quantity: nextQty } : null;
          }
          return c;
        })
        .filter(Boolean) as CartLineItem[]
    );
  };

  const updateNotes = (itemId: string, notes: string) => {
    setCart((prev) => prev.map((c) => (c.id === itemId ? { ...c, notes } : c)));
  };

  const totalAmount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }, [cart]);

  const totalItemsCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  const handleSubmit = async () => {
    if (cart.length === 0) {
      setErrorMsg('Please select at least one item from the menu.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await createStaffTakeawayOrderAction({
        queueEntryId: queueEntry.id,
        items: cart.map((i) => ({
          menuItemId: i.id,
          quantity: i.quantity,
          notes: i.notes.trim() ? i.notes.trim() : null,
        })),
      });

      if (!result.success) {
        setErrorMsg(result.error || 'Failed to create order.');
        setIsSubmitting(false);
        return;
      }

      // Broadcast customer realtime update so ticket reflects the newly attached order
      try {
        await broadcastCustomerQueueUpdate(queueEntry.id);
      } catch {
        /* non-blocking */
      }

      if (onOrderCreated) {
        onOrderCreated(result.order);
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error creating order.');
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-[#0E1524] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between gap-3 bg-[#131B2E]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white font-mono font-black text-lg flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0">
              {ticketDisplay}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-white tracking-tight">
                  Take Order for {queueEntry.customer_name || 'Takeaway Guest'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30">
                  Takeaway
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                {queueEntry.customer_phone ? <span>📞 {queueEntry.customer_phone}</span> : null}
                <span>·</span>
                <span className="text-amber-300 font-semibold">Payment: PAY AT COUNTER</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="px-5 py-3 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Body: Two Column Split (Menu Selection on Left, Cart on Right) */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-0">
          {/* Left: Menu Browser (7 cols on md) */}
          <div className="md:col-span-7 p-4 sm:p-5 flex flex-col border-b md:border-b-0 md:border-r border-white/10 overflow-y-auto">
            {/* Search and Category Filter */}
            <div className="flex flex-col gap-2.5 mb-4 shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search dishes..."
                  className="w-full pl-9 pr-3 h-10 rounded-xl bg-[#080D1A] border border-white/10 text-white placeholder:text-slate-500 text-xs focus:outline-none focus:border-amber-500 transition-all font-medium"
                />
              </div>

              {categories.length > 1 && (
                <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer border ${
                        selectedCategory === cat
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dishes Grid / List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No available dishes match your search.
                </div>
              ) : (
                filteredItems.map((item) => {
                  const cartItem = cart.find((c) => c.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-bold text-white tracking-tight truncate">
                          {item.name}
                        </span>
                        {item.description && (
                          <span className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                            {item.description}
                          </span>
                        )}
                        <span className="text-xs font-bold text-amber-400 mt-1">
                          {currencySymbol}
                          {Number(item.price).toFixed(2)}
                        </span>
                      </div>

                      {cartItem ? (
                        <div className="flex items-center gap-2 shrink-0 bg-[#080D1A] border border-white/10 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center transition-colors cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-5 text-center font-mono font-bold text-xs text-white">
                            {cartItem.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center justify-center transition-colors cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToCart(item)}
                          className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer active:scale-95"
                        >
                          <span>+ Add</span>
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Order Cart & Submission (5 cols on md) */}
          <div className="md:col-span-5 p-4 sm:p-5 flex flex-col bg-[#0A0F1D] justify-between overflow-hidden">
            <div className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 shrink-0">
                <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                  Current Order ({totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'})
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-[11px] text-slate-500 hover:text-rose-400 font-bold transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Cart List */}
              <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1 min-h-0">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500">
                    <span className="text-3xl mb-2 select-none">🛍️</span>
                    <span className="text-xs font-medium">Cart is currently empty.</span>
                    <span className="text-[11px] text-slate-600 mt-1">
                      Tap items on the left to add them to this order.
                    </span>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold text-white truncate">{item.name}</span>
                          <span className="text-[11px] text-slate-400">
                            {currencySymbol}
                            {item.unitPrice.toFixed(2)} each
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-5 text-center font-mono font-bold text-xs text-white">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/5">
                        <input
                          type="text"
                          value={item.notes}
                          onChange={(e) => updateNotes(item.id, e.target.value)}
                          placeholder="Special instructions / notes..."
                          className="flex-1 bg-transparent text-[11px] text-slate-300 placeholder:text-slate-600 focus:outline-none"
                        />
                        <span className="font-mono font-bold text-xs text-amber-300 shrink-0">
                          {currencySymbol}
                          {(item.unitPrice * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Cart Footer Summary & Submission */}
            <div className="pt-4 border-t border-white/10 flex flex-col gap-3 shrink-0 mt-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Payment Method:</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">
                  Pay at Counter
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Order Total:</span>
                <span className="text-lg font-black font-mono text-amber-400">
                  {currencySymbol}
                  {totalAmount.toFixed(2)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || cart.length === 0}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:brightness-110 active:scale-[0.98] text-slate-950 font-black text-sm shadow-lg shadow-amber-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                    <span>Creating Takeaway Order...</span>
                  </>
                ) : (
                  <>
                    <span>🛍️</span>
                    <span>
                      Create Takeaway Order ({currencySymbol}
                      {totalAmount.toFixed(2)})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
