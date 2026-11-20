import { useEffect, useState } from 'react';
import { contactService, type ContactMessage } from '../../services/contactService';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../utils/format';
import Loading from '../../components/common/Loading';
import Pagination from '../../components/common/Pagination';

export default function AdminContactsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    contactService.list({ page: String(page), limit: '12' })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setTotalPages(result.totalPages);
      })
      .catch((error: unknown) => {
        if (active) showToast(error instanceof Error ? error.message : 'Không tải được liên hệ', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page, showToast]);

  if (loading && items.length === 0) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Tin nhắn liên hệ</h1>
      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {items.length === 0 ? (
          <p className="p-8 text-center text-gray-500 text-sm">Chưa có tin nhắn liên hệ.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b">
                <th className="px-4 py-3">Người gửi</th>
                <th className="px-4 py-3">Nội dung</th>
                <th className="px-4 py-3">Ngày gửi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50 align-top">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="font-medium">{item.fullName}</p>
                    <a href={`mailto:${item.email}`} className="text-xs text-blue-600 hover:underline">{item.email}</a>
                  </td>
                  <td className="px-4 py-3 min-w-[240px] whitespace-pre-wrap">{item.message}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
