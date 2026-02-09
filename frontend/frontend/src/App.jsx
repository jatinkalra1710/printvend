import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { 
  Upload, FileText, Check, CreditCard, Shield, Zap, 
  LogOut, Layout, ArrowRight 
} from "lucide-react";
import "./index.css";

// --- ENV CONFIG ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Prevent White Screen if Env is missing
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

// --- LANDING PAGE ---
const LandingView = ({ onLogin }) => {
  const [scrollP, setScrollP] = useState(0);
  
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const p = Math.min(scrollTop / (scrollHeight - clientHeight), 1);
    setScrollP(p);
  };

  const fileY = Math.min(scrollP * 250, 120);
  const fileOp = 1 - Math.max(0, (scrollP - 0.2) * 5);
  const printY = Math.max(0, (scrollP - 0.6) * 200);
  const printOp = scrollP > 0.6 ? 1 : 0;

  return (
    <div className="landing-view" onScroll={handleScroll}>
      <div className="hero-section">
        <h1 className="hero-title">PrintVend</h1>
        <p className="hero-subtitle">Fast. Secure. Cashless Printing.</p>
        <button className="btn-google" onClick={onLogin}> Login with Google </button>
        <div style={{marginTop:40, opacity:0.5, fontSize:12}}>Scroll to see magic ▼</div>
      </div>

      <div className="story-section">
         <div className="sticky-printer-stage">
            {/* Input File */}
            <div className="digital-file" style={{ transform: `translateY(${fileY}px) scale(${1-scrollP*0.3})`, opacity: fileOp }}>
               <FileText size={40} color="#6366f1" />
               <div style={{fontSize:10, fontWeight:700, marginTop:5}}>FILE.pdf</div>
            </div>
            {/* Printer */}
            <div className="printer-machine">
               <div className="printer-slot"></div>
            </div>
            {/* Output File */}
            <div className="physical-print" style={{ transform: `translateY(${printY}px)`, opacity: printOp }}>
               <FileText size={40} color="black" />
               <div className="security-tag"><Check size={10}/> DELETED</div>
            </div>
         </div>
      </div>
    </div>
  );
};

// --- MAIN APP ---
export default function App() {
  if (!supabase) return <div style={{padding:40, color:'red'}}>Error: Missing VITE_SUPABASE_KEY in .env</div>;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [wallet, setWallet] = useState(0);
  const [orders, setOrders] = useState([]);
  
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState({ color: false, doubleSide: false, copies: 1, numPages: 1 });
  const [useCoins, setUseCoins] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successQr, setSuccessQr] = useState(null);

  const RATES = { bw_single: 1.5, bw_double: 1.0, col_single: 5.0, col_double: 4.5 };

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
       setUser(user);
       if(user) fetchData(user.id);
       setLoading(false);
    });
    supabase.auth.onAuthStateChange((_, session) => {
       setUser(session?.user ?? null);
       if(session?.user) fetchData(session.user.id);
    });
  }, []);

  const fetchData = async (uid) => {
     try {
       const res = await fetch(`${API_URL}/user-data/${uid}`);
       if(res.ok) {
         const data = await res.json();
         setWallet(data.wallet || 0);
         setOrders(data.orders || []);
       }
     } catch(e) { console.error(e); }
  };

  const calculateTotal = () => {
    const rate = settings.color 
      ? (settings.doubleSide ? RATES.col_double : RATES.col_single)
      : (settings.doubleSide ? RATES.bw_double : RATES.bw_single);
    
    const sheets = settings.doubleSide ? Math.ceil(settings.numPages/2) : parseInt(settings.numPages);
    const totalSheets = sheets * settings.copies;
    let subtotal = totalSheets * rate;
    let tax = subtotal * 0.18;
    let total = subtotal + tax;
    let discount = 0;

    if(useCoins && wallet > 0) {
      const coinVal = wallet * 0.1;
      discount = Math.min(total, coinVal);
      total -= discount;
    }
    return { subtotal, tax, total, discount, rate, totalSheets };
  };

  const { total, subtotal, tax, discount, rate, totalSheets } = calculateTotal();

  const handleProcess = async () => {
    if(!file) return;
    setProcessing(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("meta", JSON.stringify({
      userId: user.id, userEmail: user.email,
      ...settings, useCoins
    }));

    try {
      const res = await fetch(`${API_URL}/process-print`, { method:"POST", body: formData });
      const data = await res.json();
      if(data.success) {
         setSuccessQr(data.qr);
         fetchData(user.id);
         setFile(null);
      } else { alert(data.error); }
    } catch(e) { alert("Server Error"); }
    setProcessing(false);
  };

  if(loading) return <div className="spinner-overlay"><div className="spinner"></div></div>;
  if(!user) return <LandingView onLogin={() => supabase.auth.signInWithOAuth({provider:"google"})} />;

  if(successQr) return (
    <div className="app-container" style={{textAlign:'center', paddingTop:50}}>
       <div className="card">
          <h2>Order Success!</h2>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${successQr}`} style={{margin:'20px 0'}} alt="QR"/>
          <h1>{successQr}</h1>
          <button className="btn-primary" onClick={()=>setSuccessQr(null)}>Print Another</button>
       </div>
    </div>
  );

  return (
    <div className="app-container">
       <div className="header">
          <div className="logo-box">PV</div>
          <div className="coin-badge" onClick={()=>supabase.auth.signOut()}>
             {wallet} Coins <LogOut size={12}/>
          </div>
       </div>

       <div className="card">
         {!file ? (
            <label className="upload-area">
               <Upload size={32} color="var(--primary)"/>
               <p style={{fontWeight:700}}>Tap to Upload PDF</p>
               <input type="file" accept="application/pdf" hidden onChange={e=>{
                  if(e.target.files[0]) { setFile(e.target.files[0]); setSettings(s=>({...s, numPages:1})); }
               }}/>
            </label>
         ) : (
            <div className="file-preview-row">
               <FileText color="var(--primary)"/> <span>{file.name}</span>
               <button className="btn-close" onClick={()=>setFile(null)}>✕</button>
            </div>
         )}
       </div>

       <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
             <h3>Settings</h3> 
             <div className="rate-pill">${rate}/sheet</div>
          </div>
          <div className="toggle-row">
             <button className={!settings.color?'active':''} onClick={()=>setSettings({...settings, color:false})}>B&W</button>
             <button className={settings.color?'active':''} onClick={()=>setSettings({...settings, color:true})}>Color</button>
          </div>
          <div className="toggle-row">
             <button className={!settings.doubleSide?'active':''} onClick={()=>setSettings({...settings, doubleSide:false})}>Single Side</button>
             <button className={settings.doubleSide?'active':''} onClick={()=>setSettings({...settings, doubleSide:true})}>Double Side</button>
          </div>
          <div className="input-group-row">
             <div style={{flex:1}}>
                <label className="input-label">Copies</label>
                <input type="number" min="1" className="glass-input" value={settings.copies} onChange={e=>setSettings({...settings, copies:e.target.value})}/>
             </div>
             <div style={{flex:1}}>
                <label className="input-label">Pages in PDF</label>
                <input type="number" min="1" className="glass-input" value={settings.numPages} onChange={e=>setSettings({...settings, numPages:e.target.value})}/>
             </div>
          </div>
       </div>

       <div className="card">
          <div className="bill-row"><span>Subtotal</span><span>{subtotal.toFixed(2)}</span></div>
          <div className="bill-row"><span>Tax (18%)</span><span>{tax.toFixed(2)}</span></div>
          {wallet > 0 && <label className="coin-toggle-box"><span>Use {wallet} Coins</span> <input type="checkbox" checked={useCoins} onChange={e=>setUseCoins(e.target.checked)}/></label>}
          {useCoins && <div className="bill-row" style={{color:'#d97706'}}><span>Discount</span><span>-{discount.toFixed(2)}</span></div>}
          <div className="bill-total"><span>Total</span><span>${total.toFixed(2)}</span></div>
          <button className="btn-primary" disabled={!file||processing} onClick={handleProcess}>{processing?'...':`Pay ${total.toFixed(2)}`}</button>
       </div>

       <h3>Recent Orders</h3>
       <div className="card" style={{padding:0}}>
          {orders.map(o => (
             <div key={o.order_id} className="order-item" style={{padding:15}}>
                <div><b>{o.qr_code}</b> <br/><small>{new Date(o.created_at).toLocaleDateString()}</small></div>
                <span className={`status-badge ${o.status}`}>{o.status}</span>
             </div>
          ))}
          {orders.length===0 && <div style={{padding:20, textAlign:'center', opacity:0.6}}>No orders</div>}
       </div>
    </div>
  );
}
