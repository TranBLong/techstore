import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, Edit } from 'lucide-react';
import { productService } from '../../services/productService';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../utils/format';
import { mediaUrl } from '../../services/api';
import type { Product } from '../../types';
import Loading from '../../components/common/Loading';
import Pagination from '../../components/common/Pagination';

const PER_PAGE = 12;

export default function AdminProductsPage() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    productService
      .getAll({
        status: 'all',
        page: String(page),
        limit: String(PER_PAGE),
        ...(search.trim() ? { q: search.trim() } : {}),
      })
      .then((result) => {
        if (!active) return;
        setProducts(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch(console.error)
      .finally(() => {
        if (active) {
          setLoading(false);
          setHasLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [page, search]);

  const handleDelete = async (id: string) => {
    if (!confirm('Xóa sản phẩm này?')) return;
    try {
      await productService.delete(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      const nextTotal = total - 1;
      const nextTotalPages = Math.max(1, Math.ceil(nextTotal / PER_PAGE));
      setTotal(nextTotal);
      setTotalPages(nextTotalPages);
      setPage((current) => Math.min(current, nextTotalPages));
      showToast('Đã xóa sản phẩm', 'success');
    } catch (e: any) {
      showToast(e.message || 'Lỗi', 'error');
    }
  };

  if (loading && products.length === 0 && !hasLoaded) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Quản lý sản phẩm</h1>
        <Link to="/admin/san-pham/them" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Thêm sản phẩm
        </Link>
      </div>
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Tìm sản phẩm..." className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
      </div>
      <p className="text-sm text-gray-500">{total} sản phẩm</p>
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50 border-b">
              <th className="px-4 py-3">Sản phẩm</th>
              <th className="px-4 py-3">Giá</th>
              <th className="px-4 py-3">Kho</th>
              <th className="px-4 py-3">TT</th>
              <th className="px-4 py-3">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <img src={mediaUrl(p.images?.[0])} alt="" className="w-10 h-10 rounded object-cover" />
                    <div>
                      <p className="font-medium line-clamp-1 max-w-[220px]">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.brand}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-medium">{formatCurrency(p.salePrice ?? p.price)}</td>
                <td className="px-4 py-3">{p.stock}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {p.status === 'active' ? 'Hiện' : 'Ẩn'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <Link to={`/admin/san-pham/${p.id}`} className="p-1.5 text-gray-400 hover:text-blue-600"><Edit size={16} /></Link>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  {search ? 'Không tìm thấy sản phẩm' : 'Chưa có sản phẩm'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
