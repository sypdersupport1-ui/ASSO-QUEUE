import { redirect } from 'next/navigation';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { AnalyticsService } from '@/lib/services/analytics-service';
import { KPICard } from '@/components/analytics/kpi-card';
import { AuthorizationError } from '@/lib/errors';

export default async function AnalyticsPage() {
  // Enforce RBAC: only users with analytics.view permission may access this page
  let restaurantId: string;
  try {
    const ctx = await AuthorizationService.requirePermission({
      permission: 'analytics.view',
    });
    if (!ctx.restaurantId) {
      return redirect('/dashboard');
    }
    restaurantId = ctx.restaurantId;
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return (
        <div className="p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Analytics</h1>
          <p className="text-gray-500">You do not have permission to view analytics.</p>
        </div>
      );
    }
    return redirect('/login');
  }

  // Let's use Last 30 days as a default range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  let queueMetrics = null;
  let commerceMetrics = null;
  let error = null;

  try {
    const [queueData, commerceData] = await Promise.all([
      AnalyticsService.getQueueMetricsSummary(restaurantId, startDate, endDate),
      AnalyticsService.getCommerceMetricsSummary(restaurantId, startDate, endDate),
    ]);
    queueMetrics = queueData;
    commerceMetrics = commerceData;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Unknown analytics error';
  }

  // Calculate Drop-off Rate
  const totalQueueEvents = (queueMetrics?.total_joined || 0);
  const dropOffRate = totalQueueEvents > 0 
    ? ((queueMetrics?.total_dropped || 0) / totalQueueEvents * 100).toFixed(1)
    : 0;

  // Format wait time
  const waitTimeMins = queueMetrics?.avg_wait_time_seconds 
    ? Math.round(queueMetrics.avg_wait_time_seconds / 60) 
    : 0;

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Analytics Dashboard</h1>
          <p className="text-slate-400 text-[13px] sm:text-sm mt-1">Operational intelligence — last 30 days</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono font-bold text-slate-300 self-start sm:self-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Live
        </span>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md">
          {error}
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Queue Operations</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              <KPICard 
                title="Total Joined" 
                value={queueMetrics?.total_joined || 0} 
                description="Customers who joined the digital queue" 
              />
              <KPICard 
                title="Total Seated" 
                value={queueMetrics?.total_seated || 0} 
                description="Successfully seated customers" 
              />
              <KPICard 
                title="Avg Wait Time" 
                value={`${waitTimeMins} mins`} 
                description="Average time from joined to seated" 
              />
              <KPICard 
                title="Drop-off Rate" 
                value={`${dropOffRate}%`} 
                description="Cancelled, no-show, or expired" 
              />
            </div>
          </section>

          <section>
            <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Commerce Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
              <KPICard 
                title="Total Orders" 
                value={commerceMetrics?.total_orders || 0} 
                description="Completed or served orders" 
              />
              <KPICard 
                title="Total Revenue" 
                value={`$${(commerceMetrics?.total_revenue || 0).toFixed(2)}`} 
                description="Revenue from successful payments" 
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
