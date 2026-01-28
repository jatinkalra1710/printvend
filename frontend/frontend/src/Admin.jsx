import { useEffect, useState } from "react";


export default function Admin() {
const [orders,setOrders]=useState([]);


useEffect(()=>{
fetch(`${import.meta.env.VITE_API_URL}/api/admin/orders`)
.then(r=>r.json())
.then(setOrders);
},[]);


return (
<div className="card">
<h2>Admin Dashboard</h2>
<table width="100%">
<thead>
<tr><th>QR</th><th>User</th><th>Status</th><th>Amount</th></tr>
</thead>
<tbody>
{orders.map(o=> (
<tr key={o.id}>
<td>{o.qr_code}</td>
<td>{o.user_email}</td>
<td>{o.status}</td>
<td>₹{o.total_amount}</td>
</tr>
))}
</tbody>
</table>
</div>
);
}