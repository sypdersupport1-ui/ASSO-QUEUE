/**
 * Phase 4G — customer-facing order status copy.
 *
 * Maps the authoritative order lifecycle (DRAFT, PLACED, CONFIRMED,
 * PREPARING, READY, SERVED, CANCELLED — no new states) to calm,
 * customer-friendly wording. Presentation only: never authorization,
 * never state transitions, never internal failure codes.
 */
export type CustomerOrderStatus =
  | 'DRAFT'
  | 'PLACED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

export function customerOrderStatusCopy(status: string): string {
  switch (status) {
    case 'PLACED':
      return 'Order received — the kitchen has your request. 🧾';
    case 'CONFIRMED':
      return 'Restaurant confirmed your order. ✅';
    case 'PREPARING':
      return 'Your food is being prepared. 👨‍🍳';
    case 'READY':
      return 'Your order is ready. 🔔';
    case 'SERVED':
      return 'Enjoy your meal! 😋';
    case 'CANCELLED':
      return 'Order cancelled.';
    case 'DRAFT':
    default:
      return 'Your order was received and is awaiting kitchen confirmation. ✨';
  }
}
