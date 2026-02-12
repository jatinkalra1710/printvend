import { useEffect, useState } from "react";

export default function Admin() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/admin/orders`)
      .then(r => r.json())
      .then(setOrders);
  }, []);

  // ---- derived stats (frontend only) ----
  const totalRevenue = orders.reduce(
    (sum, o) => sum + (o.total_amount || 0),
    0
  );

  const activeJobs = orders.filter(o => o.status === "pending").length;
  const completedJobs = orders.filter(o => o.status === "completed").length;
  const failedJobs = orders.filter(o => o.status === "failed").length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">

      {/* HEADER */}
      <h2 className="text-2xl font-bold mb-6">Admin Dashboard</h2>

      {/* STATS CARDS */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total Orders" value={orders.length} />
        <StatCard title="Revenue" value={`₹${totalRevenue}`} />
        <StatCard title="Active Jobs" value={activeJobs} />
        <StatCard title="Completed" value={completedJobs} />
      </div>

      {/* TABLE */}
      <div className="rounded-xl overflow-hidden shadow bg-white dark:bg-[#0b1020]">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-[#121a33]">
            <tr className="text-left text-sm">
              <th className="p-4">QR</th>
              <th className="p-4">User</th>
              <th className="p-4">Status</th>
              <th className="p-4">Amount</th>
            </tr>
          </thead>

          <tbody>
            {orders.map(o => (
              <tr
                key={o.id}
                className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-[#121a33]"
              >
                <td className="p-4 font-mono text-sm">
                  {o.qr_code}
                </td>

                <td className="p-4">
                  {o.user_email}
                </td>

                <td className="p-4">
                  <StatusBadge status={o.status} />
                </td>

                <td className="p-4 font-semibold">
                  ₹{o.total_amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {orders.length === 0 && (
          <div className="p-6 text-center text-gray-500">
            No orders yet
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Small Components ---------- */

function StatCard({ title, value }) {
  return (
    <div className="p-4 rounded-xl shadow bg-white dark:bg-[#0b1020]">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    pending: "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700"
  };

  return (
    <span
      className={`px-2 py-1 rounded-md text-xs font-medium ${
        colors[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status}
    </span>
  );
}
