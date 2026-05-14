import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useQuery, useMutation } from 'react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Search, ShoppingCart, Trash2, Plus, Minus, X, CreditCard,
  Banknote, Building2, Printer, Pause, Play, RotateCcw, Wifi, WifiOff,
  Loader2, Check, ChevronDown, Tag, User, Barcode,
} from 'lucide-react';
import {
  addItem, removeItem, updateQuantity, updatePrice, updateDiscount,
  setCustomer, setPaymentMethod, clearCart, setDiscount,
  selectCartItems, selectSubtotal, selectTaxTotal, selectGrandTotal, selectHasUnsavedPrices,
} from '../../../store/slices/cartSlice';
import api from '../../../services/api';
import { queueOfflineSale, searchProductsOffline, getProductByBarcodeOffline } from '../../../services/offline';
import { useOfflineSync } from '../../../hooks';
import { selectCompany } from '../../../store/slices/authSlice';

export default function POSPage() {
  const dispatch       = useDispatch();
  const items          = useSelector(selectCartItems);
  const subtotal       = useSelector(selectSubtotal);
  const taxTotal       = useSelector(selectTaxTotal);
  const grandTotal     = useSelector(selectGrandTotal);
  const hasBadPrices   = useSelector(selectHasUnsavedPrices);
  const cartDiscount   = useSelector(s => s.cart.discountTotal);
  const paymentMethod  = useSelector(s => s.cart.paymentMethod);
  const customerName   = useSelector(s => s.cart.customerName);
  const company        = useSelector(selectCompany);
  const { isOnline }   = useOfflineSync();

  const [search, setSearch]     = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [showPayment, setShowPayment] = useState(false);
  const [amountPaid, setAmountPaid]   = useState('');
  const searchRef = useRef(null);

  const cur = company?.currencySymbol || '₨';

  // ── Product search ────────────────────────────────────────────────────────
  const { data: searchData, isFetching: searching } = useQuery(
    ['pos-products', search, activeCategory],
    async () => {
      if (!isOnline) {
        const products = await searchProductsOffline(search);
        return { products };
      }
      const { data } = await api.get('/erp/pos/search', {
        params: { q: search, categoryId: activeCategory, limit: 40 },
      });
      return data.data;
    },
    { keepPreviousData: true, staleTime: 30_000 }
  );

  const { data: catData } = useQuery(
    ['categories'],
    () => api.get('/erp/categories').then(r => r.data.data?.data || []),
    { staleTime: 60_000 * 5 }
  );

  // ── Barcode scanner handler ────────────────────────────────────────────────
  useEffect(() => {
    let buffer = '';
    let timer  = null;

    const handler = async (e) => {
      if (e.key === 'Enter' && buffer.length > 3) {
        try {
          let product;
          if (isOnline) {
            const { data } = await api.get(`/erp/products/barcode/${buffer}`);
            product = data.data?.product;
          } else {
            product = await getProductByBarcodeOffline(buffer);
          }
          if (product) {
            dispatch(addItem(product));
            toast.success(`Added: ${product.name}`);
          } else {
            toast.error(`Barcode not found: ${buffer}`);
          }
        } catch {}
        buffer = '';
        return;
      }
      if (e.key.length === 1) {
        if (document.activeElement === searchRef.current) return;
        buffer += e.key;
        clearTimeout(timer);
        timer = setTimeout(() => { buffer = ''; }, 200);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, isOnline]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.key === 'p') { e.preventDefault(); setShowPayment(true); }
      if (e.ctrlKey && e.key === 'q') { e.preventDefault(); dispatch(clearCart()); }
      if (e.key === 'F2') searchRef.current?.focus();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dispatch]);

  // ── Process sale ──────────────────────────────────────────────────────────
  const saleMutation = useMutation(
    async (salePayload) => {
      if (!isOnline) {
        const offlineId = await queueOfflineSale({ ...salePayload, invoiceNumber: `OFF-${Date.now()}` });
        return { offlineId, offline: true };
      }
      const { data } = await api.post('/erp/pos/sale', salePayload);
      return data.data;
    },
    {
      onSuccess: (data) => {
        if (data.offline) {
          toast.success('Sale saved offline — will sync when online');
        } else {
          toast.success(`Sale complete! Invoice: ${data.sale?.invoiceNumber}`);
        }
        dispatch(clearCart());
        setShowPayment(false);
        setAmountPaid('');
      },
      onError: (err) => {
        toast.error(err.response?.data?.message || 'Sale failed');
      },
    }
  );

  const handleCompleteSale = () => {
    if (!items.length) return toast.error('Cart is empty');
    if (hasBadPrices)  return toast.error('Enter price for all items first');

    const paid = parseFloat(amountPaid) || grandTotal;
    saleMutation.mutate({
      items: items.map(i => ({
        productId:   i.productId,
        quantity:    i.quantity,
        salePrice:   i.salePrice,
        discount:    i.discount,
        discountPct: i.discountPct,
      })),
      customerName,
      paymentMethod,
      payments:     [{ method: paymentMethod, amount: paid }],
      amountPaid:   paid,
      changeAmount: Math.max(0, paid - grandTotal),
      discountTotal: cartDiscount,
    });
  };

  const products = searchData?.products || [];

  return (
    <div className="flex h-[calc(100vh-64px)] gap-0 -m-4 md:-m-6 overflow-hidden">
      {/* ════════════════════════════════════════════════════
          LEFT PANEL — Product Search & Grid
      ════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 bg-slate-50 border-r border-slate-200">
        {/* Search Bar */}
        <div className="p-3 bg-white border-b border-slate-200">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search product name, SKU, barcode... (F2)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-10 pr-10 text-sm"
            />
            {searching && <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />}
          </div>

          {/* Category Filters */}
          <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setActiveCategory(null)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${!activeCategory ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >All</button>
            {(catData || []).map(cat => (
              <button
                key={cat._id}
                onClick={() => setActiveCategory(activeCategory === cat._id ? null : cat._id)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${activeCategory === cat._id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >{cat.name}</button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {!isOnline && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-warning-50 border border-warning-200 rounded-lg text-sm text-warning-700">
              <WifiOff size={14} /> Offline mode — showing cached products
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            <AnimatePresence>
              {products.map(product => (
                <ProductCard key={product._id} product={product} cur={cur} onAdd={() => dispatch(addItem(product))} />
              ))}
            </AnimatePresence>
            {products.length === 0 && !searching && (
              <div className="col-span-full text-center py-12 text-slate-400 text-sm">
                <Package size={32} className="mx-auto mb-2 opacity-30" />
                {search ? `No products for "${search}"` : 'Search or scan a product'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════
          RIGHT PANEL — Cart
      ════════════════════════════════════════════════════ */}
      <div className="w-[340px] xl:w-[380px] flex flex-col bg-white flex-shrink-0">
        {/* Cart Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-primary-600" />
            <span className="font-semibold text-slate-900 text-sm">Cart</span>
            {items.length > 0 && <span className="badge-blue">{items.length}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => dispatch(clearCart())} className="btn-ghost btn-sm text-danger-500 hover:bg-danger-50" title="Clear (Ctrl+Q)">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Customer Row */}
        <div className="px-4 py-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <User size={14} /> <span className="truncate">{customerName}</span>
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-300">
              <ShoppingCart size={40} className="mb-3" />
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs mt-1">Scan or click a product</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {items.map(item => (
                <CartItem key={item.cartItemId} item={item} cur={cur} dispatch={dispatch} />
              ))}
            </div>
          )}
        </div>

        {/* Cart Totals */}
        <div className="border-t border-slate-100 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-medium">{cur} {subtotal.toLocaleString()}</span>
          </div>
          {taxTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Tax</span>
              <span className="font-medium">{cur} {taxTotal.toLocaleString()}</span>
            </div>
          )}
          {cartDiscount > 0 && (
            <div className="flex justify-between text-sm text-success-600">
              <span>Discount</span>
              <span>- {cur} {cartDiscount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg border-t border-slate-100 pt-2 mt-2">
            <span>Total</span>
            <span className="text-primary-600">{cur} {grandTotal.toLocaleString()}</span>
          </div>

          {/* Payment Method */}
          <div className="grid grid-cols-3 gap-1.5 mt-3">
            {['cash','card','bank_transfer'].map(m => (
              <button
                key={m}
                onClick={() => dispatch(setPaymentMethod(m))}
                className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all ${
                  paymentMethod === m
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'border-slate-200 text-slate-600 hover:border-primary-300'
                }`}
              >
                {m === 'cash' ? '💵 Cash' : m === 'card' ? '💳 Card' : '🏦 Bank'}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowPayment(true)}
            disabled={!items.length || hasBadPrices}
            className="btn-primary w-full h-12 text-base mt-2"
            title="Ctrl+P"
          >
            <Check size={18} /> Charge {cur} {grandTotal.toLocaleString()}
          </button>
        </div>
      </div>

      {/* ── Payment Modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPayment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={e => e.target === e.currentTarget && setShowPayment(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            >
              <h2 className="text-lg font-bold text-slate-900 mb-4">Complete Payment</h2>
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                  <p className="text-sm text-slate-500">Total Amount</p>
                  <p className="text-3xl font-bold text-primary-600 mt-1">{cur} {grandTotal.toLocaleString()}</p>
                </div>
                {paymentMethod === 'cash' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount Received</label>
                    <input
                      type="number"
                      className="input text-center text-xl font-bold h-14"
                      placeholder={grandTotal.toString()}
                      value={amountPaid}
                      onChange={e => setAmountPaid(e.target.value)}
                      autoFocus
                    />
                    {amountPaid && parseFloat(amountPaid) >= grandTotal && (
                      <p className="text-center text-success-600 font-semibold mt-2 text-sm">
                        Change: {cur} {(parseFloat(amountPaid) - grandTotal).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setShowPayment(false)} className="btn-outline flex-1">Cancel</button>
                  <button
                    onClick={handleCompleteSale}
                    disabled={saleMutation.isLoading}
                    className="btn-primary flex-1"
                  >
                    {saleMutation.isLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    {saleMutation.isLoading ? 'Processing...' : 'Confirm Sale'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ProductCard ──────────────────────────────────────────────────────────────
function ProductCard({ product, cur, onAdd }) {
  const outOfStock = product.quantity <= 0;
  return (
    <motion.button
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileTap={{ scale: 0.97 }}
      onClick={onAdd}
      disabled={outOfStock}
      className={`relative flex flex-col bg-white rounded-xl p-3 border transition-all text-left hover:border-primary-300 hover:shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${outOfStock ? 'border-slate-100' : 'border-slate-200'}`}
    >
      {product.thumbnail ? (
        <img src={product.thumbnail} alt={product.name} className="w-full aspect-square object-cover rounded-lg mb-2 bg-slate-100" />
      ) : (
        <div className="w-full aspect-square rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center mb-2">
          <span className="text-xl font-bold text-primary-300">{product.name[0]}</span>
        </div>
      )}
      <p className="text-xs font-semibold text-slate-900 leading-tight line-clamp-2">{product.name}</p>
      <p className="text-xs text-slate-400 mt-0.5 truncate">{product.sku}</p>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-sm font-bold text-primary-600">
          {product.salePrice != null ? `${cur} ${product.salePrice.toLocaleString()}` : 'Enter price'}
        </span>
        <span className={`text-[10px] font-medium ${product.quantity <= 0 ? 'text-danger-500' : product.quantity <= product.reorderLevel ? 'text-warning-500' : 'text-success-600'}`}>
          {product.quantity} {product.unit}
        </span>
      </div>
      {outOfStock && <div className="absolute inset-0 rounded-xl bg-white/60 flex items-center justify-center"><span className="badge-red text-xs">Out</span></div>}
    </motion.button>
  );
}

// ─── CartItem ─────────────────────────────────────────────────────────────────
function CartItem({ item, cur, dispatch }) {
  const [editPrice, setEditPrice] = useState(false);
  const [price, setPrice]         = useState(item.salePrice || '');

  return (
    <div className="px-4 py-3 hover:bg-slate-50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{item.name}</p>
          {item.salePrice === null || editPrice ? (
            <div className="flex items-center gap-1 mt-1">
              <input
                autoFocus={editPrice}
                type="number"
                className="w-24 px-2 py-0.5 text-xs border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Enter price"
                value={price}
                onChange={e => setPrice(e.target.value)}
                onBlur={() => {
                  if (price) { dispatch(updatePrice({ cartItemId: item.cartItemId, salePrice: parseFloat(price) })); setEditPrice(false); }
                }}
                onKeyDown={e => { if (e.key === 'Enter' && price) { dispatch(updatePrice({ cartItemId: item.cartItemId, salePrice: parseFloat(price) })); setEditPrice(false); } }}
              />
              <span className="text-xs text-danger-500">Price required</span>
            </div>
          ) : (
            <button onClick={() => setEditPrice(true)} className="text-xs text-primary-600 hover:underline">
              {cur} {item.salePrice?.toLocaleString()}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => item.quantity > 1 ? dispatch(updateQuantity({ cartItemId: item.cartItemId, quantity: item.quantity - 1 })) : dispatch(removeItem(item.cartItemId))}
            className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <Minus size={12} />
          </button>
          <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
          <button onClick={() => dispatch(updateQuantity({ cartItemId: item.cartItemId, quantity: item.quantity + 1 }))}
            className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <Plus size={12} />
          </button>
          <button onClick={() => dispatch(removeItem(item.cartItemId))}
            className="w-6 h-6 rounded-md hover:bg-danger-50 hover:text-danger-600 flex items-center justify-center text-slate-400 transition-colors ml-1">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-slate-400">{item.quantity} × {cur} {item.salePrice?.toLocaleString()}</span>
        <span className="text-sm font-semibold text-slate-900">{cur} {item.total?.toLocaleString()}</span>
      </div>
    </div>
  );
}

// Missing imports
import { Package } from 'lucide-react';
