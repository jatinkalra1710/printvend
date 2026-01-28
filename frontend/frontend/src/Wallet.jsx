import { useEffect, useState } from "react";


export default function Wallet({ user }) {
const [balance, setBalance] = useState(0);


useEffect(() => {
fetch(`${import.meta.env.VITE_API_URL}/api/wallet/${user.id}`)
.then(r=>r.json())
.then(d=>setBalance(d.balance||0));
},[]);


return (
<div className="card">
<h2>💰 Wallet</h2>
<h1>₹{balance.toFixed(2)}</h1>
<p>Cashback auto-applies on next print.</p>
</div>
);
}