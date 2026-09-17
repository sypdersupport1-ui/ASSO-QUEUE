import React from 'react';
import { MenuService } from '@/lib/services/menu-service';
import {
  createCategoryFormAction,
  updateCategoryStatusAction,
  createMenuItemFormAction,
  updateMenuItemAvailabilityAction,
  archiveMenuItemAction,
} from '@/app/dashboard/actions';

export default async function MenuManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    category?: string;
    showArchived?: string;
  }>;
}) {
  const params = await searchParams;
  const searchTerm = params.search || '';
  const selectedCategory = params.category || '';
  const includeArchived = params.showArchived === 'true';

  const [{ categories }, { items, total }] = await Promise.all([
    MenuService.listCategories(),
    MenuService.listMenuItems({
      search: searchTerm,
      categoryId: selectedCategory || undefined,
      includeArchived,
      limit: 100,
    }),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500 p-4 sm:p-0">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900/40 via-purple-900/20 to-slate-900/40 border border-white/10 p-5 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-primary/20 rounded-full blur-[80px]"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-purple-500/10 rounded-full blur-[80px]"></div>
        
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 tracking-tight">Menu Configuration</h1>
            <p className="text-sm text-slate-400 mt-2 max-w-xl">
              Curate your digital menu, organize categories, and adjust pricing instantly.
            </p>
          </div>
        </div>
      </div>

      {/* CATEGORIES SECTION */}
      <div className="rounded-2xl border border-white/5 bg-[#111827]/80 backdrop-blur-xl p-4 sm:p-6 space-y-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <span className="material-symbols-outlined text-[20px] text-purple-400">category</span>
            </div>
            <h2 className="text-xl font-bold text-white">Categories</h2>
          </div>
          <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono font-bold text-slate-300">
            {categories.length} TOTAL
          </span>
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className={`group relative p-5 rounded-xl border backdrop-blur-md transition-all duration-300 flex flex-col justify-between overflow-hidden ${
                cat.active
                  ? 'bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-white/10 hover:border-white/20 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1'
                  : 'bg-slate-900/40 border-slate-800/50 opacity-70 grayscale hover:grayscale-0'
              }`}
            >
              {cat.active && (
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              )}
              
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-bold text-base text-white line-clamp-1">{cat.name}</h3>
                  <span
                    className={`text-[9px] px-2 py-0.5 rounded-full font-mono font-bold tracking-wider uppercase flex-shrink-0 ${
                      cat.active
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                        : 'bg-slate-800/80 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {cat.active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                {cat.description ? (
                  <p className="text-xs text-slate-400 line-clamp-2 h-8">{cat.description}</p>
                ) : (
                  <p className="text-xs text-slate-500 italic h-8">No description</p>
                )}
                
                <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                    <span className="material-symbols-outlined text-[14px]">restaurant_menu</span>
                    {cat.itemCount} items
                  </div>
                  
                  <form action={updateCategoryStatusAction.bind(null, cat.id, !cat.active)}>
                    <button
                      type="submit"
                      className={`text-[10px] px-3 py-1 rounded-lg font-bold transition-all ${
                        cat.active
                          ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300'
                          : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                      }`}
                    >
                      {cat.active ? 'Disable' : 'Enable'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Category Form Inline */}
        <details className="mt-6 border border-white/5 rounded-xl bg-black/20 group">
          <summary className="text-sm font-bold text-white cursor-pointer px-6 py-4 flex items-center gap-2 select-none hover:bg-white/5 transition-colors rounded-xl">
            <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center group-open:rotate-45 transition-transform duration-300">
              <span className="material-symbols-outlined text-[16px]">add</span>
            </div>
            Create New Category
          </summary>
          <div className="p-6 pt-2 border-t border-white/5">
            <form action={createCategoryFormAction} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div className="md:col-span-4">
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Category Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Signature Cocktails"
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>
              <div className="md:col-span-5">
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Description (Optional)</label>
                <input
                  type="text"
                  name="description"
                  placeholder="Short, catchy description"
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Sort Order</label>
                <input
                  type="number"
                  name="sortOrder"
                  defaultValue="0"
                  min="0"
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>
              <div className="md:col-span-1">
                <button
                  type="submit"
                  className="w-full h-[42px] bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:shadow-[0_0_20px_rgba(37,99,235,0.6)] flex items-center justify-center"
                >
                  <span className="material-symbols-outlined">save</span>
                </button>
              </div>
            </form>
          </div>
        </details>
      </div>

      {/* MENU ITEMS SECTION */}
      <div className="rounded-2xl border border-white/5 bg-[#111827]/80 backdrop-blur-xl p-4 sm:p-6 space-y-6 shadow-xl relative overflow-hidden">
        {/* Subtle decorative background */}
        <div className="absolute right-0 bottom-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <span className="material-symbols-outlined text-[20px] text-emerald-400">restaurant_menu</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Menu Items</h2>
              <p className="text-xs text-slate-400">{total} items total</p>
            </div>
          </div>

          {/* Search & Category Filter */}
          <form method="GET" className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-[18px] text-slate-500">search</span>
              </div>
              <input
                type="text"
                name="search"
                defaultValue={searchTerm}
                placeholder="Search items..."
                className="w-full bg-slate-900/50 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              />
            </div>
            <select
              name="category"
              defaultValue={selectedCategory}
              className="bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all appearance-none pr-8"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem top 50%', backgroundSize: '0.65rem auto' }}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-white/10 hover:bg-white/20 text-white font-medium text-sm px-5 py-2 rounded-xl transition-colors border border-white/5"
            >
              Filter
            </button>
          </form>
        </div>

        {/* Menu Items Table - desktop */}
        <div className="hidden sm:block overflow-x-auto rounded-xl border border-white/5 bg-black/20 relative z-10">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 font-bold border-b border-white/10">
              <tr>
                <th className="p-4 rounded-tl-xl">Item Details</th>
                <th className="p-4">Category</th>
                <th className="p-4 text-right">Price</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right rounded-tr-xl">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[32px] text-slate-500">search_off</span>
                      </div>
                      <p className="text-slate-400 font-medium">No menu items found</p>
                      <p className="text-xs text-slate-500">Try adjusting your filters or create a new item.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="p-4 font-medium text-white max-w-[250px]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {item.imageUrl ? (<img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />) : (<span className="material-symbols-outlined text-[20px] text-slate-400">lunch_dining</span>)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-white group-hover:text-primary transition-colors truncate">{item.name}</div>
                          {item.description && (
                            <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{item.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-medium text-slate-300">
                        {item.categoryName || 'Unassigned'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <span className="font-mono font-bold text-base text-white tracking-tight">
                        ₹{Number(item.price).toFixed(2)}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <span
                          className={`px-2.5 py-1 text-[10px] rounded-md font-mono font-bold tracking-wider uppercase inline-block ${
                            item.isArchived
                              ? 'bg-slate-800 text-slate-500'
                              : item.active
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {item.isArchived ? 'ARCHIVED' : item.active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                        
                        <form action={updateMenuItemAvailabilityAction.bind(null, item.id, !item.available)}>
                          <button
                            type="submit"
                            className={`px-3 py-1 text-[10px] rounded-full font-bold transition-all flex items-center gap-1 ${
                              item.available
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {item.available ? 'check_circle' : 'cancel'}
                            </span>
                            {item.available ? 'IN STOCK' : 'OUT OF STOCK'}
                          </button>
                        </form>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      {!item.isArchived && (
                        <form
                          action={archiveMenuItemAction.bind(null, item.id)}
                          className="inline-block"
                        >
                          <button
                            type="submit"
                            className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 flex items-center justify-center transition-all"
                            title="Archive Item"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Menu Cards - mobile */}
        <div className="sm:hidden space-y-3 relative z-10">
          {items.length === 0 ? (
            <div className="bg-black/20 border border-white/5 rounded-xl p-8 text-center">
              <span className="material-symbols-outlined text-[32px] text-slate-500">search_off</span>
              <p className="text-slate-400 font-medium mt-2">No menu items found</p>
              <p className="text-xs text-slate-500 mt-1">Create your first item below</p>
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="bg-black/20 border border-white/5 rounded-2xl p-4 flex gap-3">
              <div className="w-16 h-16 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                {item.imageUrl ? (<img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />) : (<span className="material-symbols-outlined text-[24px] text-slate-500">lunch_dining</span>)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-white truncate">{item.name}</div>
                {item.description && <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{item.description}</div>}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-emerald-400">₹{Number(item.price).toFixed(2)}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400">{item.categoryName || 'Unassigned'}</span>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${item.available?'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20':'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{item.available?'In Stock':'Out'}</span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <form action={updateMenuItemAvailabilityAction.bind(null, item.id, !item.available)} className="flex-1">
                    <button type="submit" className={`w-full h-9 rounded-xl text-xs font-bold border ${item.available?'bg-amber-500/10 border-amber-500/20 text-amber-400':'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{item.available?'Mark Out':'Mark In'}</button>
                  </form>
                  {!item.isArchived && (
                    <form action={archiveMenuItemAction.bind(null, item.id)}>
                      <button type="submit" className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Menu Item Form */}
        <details className="mt-6 border border-white/5 rounded-xl bg-black/20 group relative z-10">
          <summary className="text-sm font-bold text-white cursor-pointer px-6 py-4 flex items-center gap-2 select-none hover:bg-white/5 transition-colors rounded-xl">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-open:rotate-45 transition-transform duration-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
              <span className="material-symbols-outlined text-[16px]">add</span>
            </div>
            Create New Menu Item
          </summary>
          <div className="p-6 pt-2 border-t border-white/5">
            <form action={createMenuItemFormAction} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Item Name</label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Signature Truffle Burger"
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Category</label>
                <select
                  name="categoryId"
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all appearance-none pr-8"
                  style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem top 50%', backgroundSize: '0.65rem auto' }}
                >
                  <option value="">Unassigned</option>
                  {categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Price ($)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-slate-500 font-medium">$</span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    name="price"
                    required
                    placeholder="25.00"
                    className="w-full bg-slate-900/50 border border-white/10 rounded-xl pl-8 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="lg:col-span-3">
                <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Description</label>
                <input
                  type="text"
                  name="description"
                  placeholder="Appetizing description of the dish..."
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all"
                />
              </div>
              
              {/* Hidden field for default preparation time since inventory is gone */}
              <input type="hidden" name="preparationTimeMinutes" value="15" />

              <div className="flex items-end lg:col-span-1">
                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-6 py-2.5 rounded-xl transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">add_circle</span>
                  Create Item
                </button>
              </div>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
