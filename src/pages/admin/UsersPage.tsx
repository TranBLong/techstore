import { useEffect, useMemo, useState } from 'react';
import { userService } from '../../services/userService';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../utils/format';
import type { User, Role } from '../../types';
import Loading from '../../components/common/Loading';
import Pagination from '../../components/common/Pagination';

const PER_PAGE = 12;

export default function AdminUsersPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'locked'>('ALL');

  const filteredUsers = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false;
      if (statusFilter === 'active' && !user.isActive) return false;
      if (statusFilter === 'locked' && user.isActive) return false;
      if (!keyword) return true;
      return `${user.fullName} ${user.email} ${user.phone || ''}`.toLowerCase().includes(keyword);
    });
  }, [users, q, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PER_PAGE));
  const visibleUsers = filteredUsers.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  useEffect(() => {
    userService.getAll().then(setUsers).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setPage(1);
  }, [q, roleFilter, statusFilter]);

  const patch = async (id: string, data: Partial<User>) => {
    try {
      const u = await userService.update(id, data);
      setUsers((prev) => prev.map((x) => (x.id === id ? u : x)));
      showToast('Cập nhật thành công', 'success');
    } catch (e: any) {
      showToast(e.message || 'Lỗi', 'error');
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Quản lý người dùng</h1>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo họ tên, email, SĐT..."
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as 'ALL' | Role)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[140px]"
        >
          <option value="ALL">Tất cả vai trò</option>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'active' | 'locked')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[140px]"
        >
          <option value="ALL">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="locked">Bị khóa</option>
        </select>
      </div>
      <div className="bg-white rounded-xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50 border-b">
              <th className="px-4 py-3">Họ tên</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500 text-sm">
                  Không tìm thấy người dùng.
                </td>
              </tr>
            ) : visibleUsers.map((u) => (
              <tr key={u.id} className="border-b border-gray-50">
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value as Role })} className="text-xs px-2 py-1 border rounded">
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => patch(u.id, { isActive: !u.isActive })} className={`text-xs px-2.5 py-1 rounded-full font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.isActive ? 'Hoạt động' : 'Đã khóa'}
                  </button>
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
