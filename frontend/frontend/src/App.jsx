import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { 
  Upload, FileText, Check, CreditCard, Shield, Zap, 
  LogOut, Layout, ArrowRight 
} from "lucide-react";
import "./index.css";

// --- ENVIRONMENT VARIABLES ---
// If using Create React App, change 'import.meta.env.VITE_...' to 'process.env.REACT_APP_...'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const API_URL = import.meta.env.VITE_API_URL; 

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Pricing Constants
const RATES = { 
  bw_single: 1.5, bw_double: 1.0, 
  col_single: 5.0, col_double: 4.5 
};

// --- COMPONENT: LANDING PAGE (Animated) ---
const LandingView = ({ onLogin }) => {
  const [scrollProgress, setScrollProgress] = useState(0);
  const containerRef = useRef(null);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const maxScroll = scrollHeight - clientHeight;
    // Normalize scroll from 0 to 1
    const progress = Math.min(Math.max(scrollTop / maxScroll, 0), 1);
    setScrollProgress(progress);
  };

  // Animation Math
  // 0.0 - 0.3: File moves down
  // 0.3 - 0.6: File enters printer (disappears)
  // 0.6 - 1.0: Print comes out bottom with "Deleted" tag
  
  const fileTranslateY = Math.min(scrollProgress * 400, 150); // Moves down
  const fileOpacity = 1 - Math.max(0, (scrollProgress - 0.2) * 4); // Fades out as it enters printer
  
  const printTranslateY = Math.max(0, (scrollProgress - 0.6) * 200); // Moves out of printer
  const printOpacity = scrollProgress > 0.55 ? 1 : 0; // Appears later

  return (
    <div className="landing-view" onScroll={handleScroll} ref={containerRef}>
      
      {/* SECTION 1: HERO & VALUE PROP */}
      <div className="hero-section">
        <div className="logo-box" style={{ width: 60, height: 60, fontSize: 24, marginBottom: 20 }}>PV</div>
        <h1 className="hero-title">PrintVend</h1>
        <p className="hero-subtitle">
          Secure. Instant. Cashless.<br/>
          Smart printing for the modern campus.
        </p>

        <div className="features-grid">
           <div className="feat-item"><Zap size={16}/> Instant Print</div>
           <div className="feat-item"><CreditCard size={16}/> Low Cost</div>
           <div className="feat-item"><Shield size={16}/> Encrypted</div>
        </div>

        <button className="btn-google" onClick={onLogin}>
           <img src="https://www.svgrepo.com/show/475656/google-color.svg" width="20" alt="G" style={{marginRight:10}}/>
           Continue with Google
        </button>

        <div style={{ marginTop: 50, opacity: 0.5, fontSize: 12, animation: 'bounce 2s infinite' }}>
           Scroll to see how it works <br/> ▼
        </div>
      </div>

      {/* SECTION 2: INTERACTIVE PRINTER ANIMATION */}
      <div className="story-section">
         <div className="sticky-printer-stage">
            
            {/* The Digital File (Input) */}
            <div className="digital-file" style={{ 
               transform: `translateY(${fileTranslateY}px) scale(${1 - scrollProgress * 0.3})`, 
               opacity: fileOpacity 
            }}>
               <FileText size={40} color="#6366f1" />
               <div style={{fontSize:10, marginTop:8, fontWeight:700, color:'#333'}}>CONFIDENTIAL.pdf</div>
               <div style={{fontSize:9, color:'red', marginTop:4}}>Contains Data</div>
            </div>

            {/* The Printer Machine */}
            <div className="printer-machine">
               <div className="printer-light"></div>
               <div className="printer-slot"></div>
            </div>

            {/* The Physical Print (Output) */}
            <div className="physical-print" style={{ 
               transform: `translateY(${printTranslateY}px)`, 
               opacity: printOpacity 
            }}>
               <FileText size={40} color="#000" />
               <div style={{fontSize:10, marginTop:8, fontWeight:700, color:'#000'}}>CONFIDENTIAL.pdf</div>
               
               {/* Security Tag */}
               <div className="security-tag">
                  <Check size={10} strokeWidth={4} /> DATA DELETED
               </div>
            </div>

            <div className="feature-text-overlay" style={{opacity: scrollProgress > 0.8 ? 1 : 0}}>
               <h3>100% Privacy</h3>
               <p>Your file is permanently deleted from our servers the moment it prints.</p>
            </div>

         </div>
      </div>

      {/* SECTION 3: FOOTER CTA */}
      <div style={{ padding: '60px 20px', textAlign: 'center', background: 'white' }}>
         <h2 style={{color:'var(--primary-dark)', marginBottom:20}}>Ready to print?</h2>
         <button className="btn-primary" onClick={onLogin} style={{maxWidth: 200, margin: '0 auto'}}>
            Get Started Now
         </button>
      </div>
    </div>
  );
};

// --- COMPONENT: MAIN APP (LOGGED IN) ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Data State
  const [wallet, setWallet] = useState(0);
  const [orders, setOrders] = useState([]);
  
  // Interaction State
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState({ 
    color: false, 
    doubleSide: false, 
    copies: 1, 
    numPages: 1 // Manual input replaces range slider
  });
  const [useCoins, setUseCoins] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successQr, setSuccessQr] = useState(null);

  // --- AUTH & INITIAL DATA ---
  useEffect(() => {
    // Check active session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) loadUserData(user.id);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadUserData(session.user.id);
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserData = async (uid) => {
    try {
      const res = await fetch(`${API_URL}/user-data/${uid}`);
      if(res.ok) {
         const data = await res.json();
         setWallet(data.wallet);
         setOrders(data.orders);
      }
    } catch (e) { console.error("Data Load Error", e); }
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider: "google" });
  };
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- CALCULATIONS ---
  const getCurrentRate = () => {
     if (settings.color) {
        return settings.doubleSide ? RATES.col_double : RATES.col_single;
     }
     return settings.doubleSide ? RATES.bw_double : RATES.bw_single;
  };

  const calculateTotal = () => {
     const rate = getCurrentRate();
     
     // Logic: "Pages in PDF" is what determines the sheets.
     // If Double Sided: 10 pages = 5 sheets. 11 pages = 6 sheets.
     const sheetsPerCopy = settings.doubleSide ? Math.ceil(settings.numPages / 2) : parseInt(settings.numPages);
     const totalSheets = sheetsPerCopy * settings.copies;
     
     let subtotal = totalSheets * rate;
     let tax = subtotal * 0.18;
     let total = subtotal + tax;

     // Coin Logic
     let discount = 0;
     if (useCoins && wallet > 0) {
        const coinVal = wallet * 0.1; // 1 Coin = 0.1 Currency
        discount = Math.min(total, coinVal);
        total -= discount;
     }

     return { subtotal, tax, total, discount, rate, totalSheets };
  };

  const { total, subtotal, tax, discount, rate, totalSheets } = calculateTotal();

  // --- HANDLERS ---
  const handleProcess = async () => {
     if (!file) return;
     setProcessing(true);
     
     const formData = new FormData();
     formData.append("file", file);
     formData.append("meta", JSON.stringify({
        userId: user.id,
        userEmail: user.email,
        color: settings.color,
        doubleSide: settings.doubleSide,
        copies: settings.copies,
        numPages: settings.numPages,
        useCoins,
        couponCode: "" // Add coupon logic here if needed
     }));

     try {
        const res = await fetch(`${API_URL}/process-print`, {
           method: "POST", body: formData
        });
        const data = await res.json();
        
        if (data.success) {
           setSuccessQr(data.qr);
           loadUserData(user.id); // Refresh orders immediately
           setFile(null); // Reset file
        } else {
           alert(data.error || "Failed");
        }
     } catch (e) {
        alert("Server connection failed");
     }
     setProcessing(false);
  };

  // --- RENDER ---
  if (loading) return <div className="spinner-overlay"><div className="spinner"></div></div>;
  
  if (!user) return <LandingView onLogin={handleLogin} />;

  // SUCCESS VIEW
  if (successQr) return (
     <div className="app-container" style={{textAlign:'center', paddingTop:50}}>
        <div className="card">
           <div style={{width:60, height:60, background:'#dcfce7', borderRadius:'50%', color:'#15803d', display:'grid', placeItems:'center', margin:'0 auto 20px'}}>
              <Check size={32} strokeWidth={3} />
           </div>
           <h2>Order Successful!</h2>
           <p style={{color:'var(--text-light)', marginBottom:20}}>Scan this QR code at any PrintVend Kiosk.</p>
           
           <div className="qr-display">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${successQr}`} alt="QR" />
           </div>
           
           <h1 style={{letterSpacing:6, color:'var(--primary)', margin:'20px 0'}}>{successQr}</h1>
           
           <button className="btn-primary" onClick={() => setSuccessQr(null)}>
              Print Another File
           </button>
        </div>
     </div>
  );

  // DASHBOARD VIEW
  return (
    <div className="app-container">
       {/* HEADER */}
       <div className="header">
          <div style={{display:'flex', alignItems:'center', gap:10}}>
             <div className="logo-box">PV</div>
             <div>
                <div style={{fontWeight:800, fontSize:16}}>PrintVend</div>
                <div style={{fontSize:11, opacity:0.6}}>Hello, {user.user_metadata.full_name?.split(' ')[0]}</div>
             </div>
          </div>
          <button className="coin-badge" onClick={handleLogout}>
             <div style={{background:'#f59e0b', width:8, height:8, borderRadius:'50%'}}></div>
             {wallet} Coins <LogOut size={12} style={{marginLeft:4, opacity:0.5}}/>
          </button>
       </div>

       {/* 1. UPLOAD SECTION */}
       <div className="card">
          {!file ? (
             <label className="upload-area">
                <Upload size={32} className="p-icon" style={{color:'var(--primary)', margin:'0 auto'}} />
                <p style={{fontWeight:700, margin:'10px 0'}}>Tap to Upload PDF</p>
                <p style={{fontSize:12, color:'var(--text-light)'}}>Max 10MB • PDF Only</p>
                <input type="file" accept="application/pdf" hidden onChange={(e) => {
                   if(e.target.files[0]) {
                      setFile(e.target.files[0]);
                      setSettings(s => ({...s, numPages: 1})); // Reset pages
                   }
                }} />
             </label>
          ) : (
             <div className="file-preview-row">
                <div className="file-icon-box"><FileText color="var(--primary)"/></div>
                <div style={{flex:1, overflow:'hidden'}}>
                   <div style={{fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{file.name}</div>
                   <div style={{fontSize:11, color:'var(--text-light)'}}>{(file.size/1024/1024).toFixed(2)} MB</div>
                </div>
                <button onClick={() => setFile(null)} className="btn-close">✕</button>
             </div>
          )}
       </div>

       {/* 2. SETTINGS SECTION */}
       <div className="card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:15}}>
             <h3 style={{margin:0}}>Settings</h3>
             <div className="rate-pill">
                Rate: <strong>${rate.toFixed(2)}</strong>/sheet
             </div>
          </div>

          {/* Color Toggle */}
          <div className="toggle-row">
             <button 
               className={`toggle-btn ${!settings.color ? 'active':''}`} 
               onClick={()=>setSettings({...settings, color:false})}>
               B&W
             </button>
             <button 
               className={`toggle-btn ${settings.color ? 'active':''}`} 
               onClick={()=>setSettings({...settings, color:true})}>
               Color
             </button>
          </div>

          {/* Side Toggle */}
          <div className="toggle-row">
             <button 
               className={`toggle-btn ${!settings.doubleSide ? 'active':''}`} 
               onClick={()=>setSettings({...settings, doubleSide:false})}>
               Single Side
             </button>
             <button 
               className={`toggle-btn ${settings.doubleSide ? 'active':''}`} 
               onClick={()=>setSettings({...settings, doubleSide:true})}>
               Double Side
             </button>
          </div>

          {/* Inputs */}
          <div className="input-group-row">
             <div style={{flex:1}}>
                <label className="input-label">Copies</label>
                <input type="number" min="1" className="glass-input" 
                   value={settings.copies} 
                   onChange={e=>setSettings({...settings, copies: e.target.value})}
                />
             </div>
             <div style={{flex:1}}>
                <label className="input-label">Total Pages in PDF</label>
                <input type="number" min="1" className="glass-input" 
                   value={settings.numPages} 
                   onChange={e=>setSettings({...settings, numPages: e.target.value})}
                />
             </div>
          </div>
       </div>

       {/* 3. PAYMENT SECTION */}
       <div className="card">
          <div className="bill-row">
             <span>Subtotal ({totalSheets} sheets)</span> 
             <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="bill-row">
             <span>Tax (18%)</span> 
             <span>{tax.toFixed(2)}</span>
          </div>
          
          {wallet > 0 && (
             <label className="coin-toggle-box">
                 <div style={{display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600}}>
                    <div className="coin-icon">C</div> Use {wallet} Coins
                 </div>
                 <input type="checkbox" checked={useCoins} onChange={e => setUseCoins(e.target.checked)}/>
             </label>
          )}
          
          {useCoins && discount > 0 && (
            <div className="bill-row" style={{color:'#d97706'}}>
               <span>Coin Discount</span> 
               <span>-{discount.toFixed(2)}</span>
            </div>
          )}

          <div className="bill-total">
             <span>Total Pay</span>
             <span>${total.toFixed(2)}</span>
          </div>

          <button className="btn-primary" disabled={!file || processing} onClick={handleProcess}>
             {processing ? <div className="spinner"></div> : `Pay & Print • $${total.toFixed(2)}`}
          </button>
       </div>

       {/* 4. RECENT ORDERS SECTION */}
       <h3 style={{marginLeft:10, marginBottom:10, fontSize:16}}>Recent Orders</h3>
       <div className="card" style={{padding:0, overflow:'hidden'}}>
          {orders.length === 0 ? (
             <div style={{padding:30, textAlign:'center', color:'var(--text-light)', fontSize:13}}>
                No orders history found.
             </div>
          ) : (
             <div style={{padding:'5px 20px'}}>
                {orders.map(order => (
                   <div key={order.order_id} className="order-item">
                      <div className="order-info">
                         <div className="order-qr">{order.qr_code}</div>
                         <div className="order-date">
                            {new Date(order.created_at).toLocaleDateString()} • {new Date(order.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                         </div>
                      </div>
                      <div className={`status-badge ${order.status}`}>
                         {order.status}
                      </div>
                   </div>
                ))}
             </div>
          )}
       </div>
    </div>
  );
}
