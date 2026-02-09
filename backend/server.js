import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase Admin Client (Service Role)
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Memory Storage for File Uploads
const upload = multer({ storage: multer.memoryStorage() });

// Pricing & Logic Configuration
const RATES = { 
  bw_single: 1.5, bw_double: 1.0, 
  col_single: 5.0, col_double: 4.5 
};
const COIN_VAL = 0.1; // 1 Coin = 0.1 currency unit (e.g., Rupees/Dollars)
const TAX_RATE = 0.18; // 18% Tax

// --- 1. PROCESS PRINT ORDER ---
app.post("/api/process-print", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Parse Metadata
    let meta = {};
    try { meta = JSON.parse(req.body.meta || "{}"); } catch (e) {}
    
    const { userId, userEmail, couponCode, useCoins, copies = 1, numPages = 1 } = meta;

    // 1. Check User & VIP Status
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const isVIP = profile?.role === 'VIP';

    // 2. Calculate Cost
    // Logic: If user selected Color, use color rates. Double side is cheaper per sheet.
    const rateType = meta.color 
      ? (meta.doubleSide ? RATES.col_double : RATES.col_single)
      : (meta.doubleSide ? RATES.bw_double : RATES.bw_single);
    
    // Sheets Calculation:
    // If double sided, 10 pages = 5 sheets. 11 pages = 6 sheets.
    const sheetsPerCopy = meta.doubleSide ? Math.ceil(parseInt(numPages) / 2) : parseInt(numPages);
    const totalSheets = sheetsPerCopy * parseInt(copies);
    
    let subtotal = totalSheets * rateType;
    if (isVIP) subtotal = 0; // VIPs print free

    let total = subtotal + (subtotal * TAX_RATE);
    
    // 3. Apply Coupons
    if (couponCode && !isVIP && total > 0) {
      const { data: c } = await supabase.from("coupons").select("*").eq("code", couponCode).single();
      if (c && c.active) {
        const { data: used } = await supabase.from("used_coupons").select("*").eq("user_id", userId).eq("coupon_code", couponCode).maybeSingle();
        if (!c.is_one_time || !used) {
           total -= (total * c.discount_percent) / 100;
           // If one-time use, record it
           if(c.is_one_time) await supabase.from("used_coupons").insert([{ user_id: userId, coupon_code: couponCode }]);
        }
      }
    }

    // 4. Use Wallet Coins
    let coinsRedeemed = 0;
    if (useCoins && total > 0 && !isVIP) {
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
      if (w && w.balance > 0) {
        const coinValueAvailable = w.balance * COIN_VAL;
        const valueToCover = Math.min(total, coinValueAvailable);
        coinsRedeemed = valueToCover / COIN_VAL; 
        total -= valueToCover;
      }
    }

    // 5. Generate Secure QR & Filename
    const random6 = crypto.randomBytes(3).toString("hex").toUpperCase(); 
    const char7 = meta.color ? '1' : '0';
    const char8 = meta.doubleSide ? '1' : '0';
    const qrCode = `${random6}${char7}${char8}`; 
    const fileName = `${qrCode}_${Date.now()}.pdf`; 

    // 6. Upload File
    const { error: uploadError } = await supabase.storage
      .from("prints")
      .upload(fileName, req.file.buffer, { contentType: "application/pdf" });

    if (uploadError) throw new Error("File upload failed: " + uploadError.message);

    // 7. Create Order in Database
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 Hour Expiry
    
    await supabase.from("orders").insert([{
      user_id: userId,
      user_email: userEmail,
      qr_code: qrCode,
      file_path: fileName,
      pages_selected: totalSheets, 
      color: meta.color,
      double_sided: meta.doubleSide,
      total_amount: Math.max(0, total).toFixed(2),
      status: "PAID",
      created_at: new Date(),
      expires_at: expiresAt,
      printed: false,
      expired: false
    }]);

    // 8. Update Wallet (Debit & Earn)
    // Debit
    if (coinsRedeemed > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: -coinsRedeemed, type: "DEBIT", note: `Paid for ${qrCode}` }]);
    }
    // Earn Cashback (1 coin per 10 units spent)
    const earned = !isVIP ? Math.floor(subtotal / 10) : 0;
    if (earned > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: earned, type: "EARN", note: `Cashback ${qrCode}` }]);
    }
    // Update Balance
    if (coinsRedeemed > 0 || earned > 0) {
        const { data: cw } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
        const newBal = (cw?.balance || 0) - coinsRedeemed + earned;
        await supabase.from("wallets").upsert({ user_id: userId, balance: newBal });
    }

    res.json({ success: true, qr: qrCode });

  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: e.message }); 
  }
});

// --- 2. GET USER DATA ---
app.get("/api/user-data/:uid", async (req, res) => {
    try {
        const { uid } = req.params;
        const [walletRes, ordersRes] = await Promise.all([
            supabase.from("wallets").select("balance").eq("user_id", uid).single(),
            supabase.from("orders").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(10)
        ]);
        res.json({
            wallet: walletRes.data?.balance || 0,
            orders: ordersRes.data || []
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 3. KIOSK CONSUME (PRINT) ---
app.post("/api/print/consume", async (req, res) => {
  try {
    const { qr } = req.body;
    const { data: order } = await supabase.from("orders").select("*").eq("qr_code", qr).single();
    
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.printed) return res.status(400).json({ error: "Already Used" });
    if (new Date(order.expires_at) < new Date()) {
        await supabase.from("orders").update({ expired: true, status: "EXPIRED" }).eq("qr_code", qr);
        return res.status(400).json({ error: "Code Expired" });
    }

    // Mark Printed & Delete File
    await supabase.from("orders").update({ status: "PRINTED", printed: true, printed_at: new Date() }).eq("qr_code", qr);
    
    if (order.file_path) {
        await supabase.storage.from("prints").remove([order.file_path]);
    }
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 4. ADMIN STATS ---
app.get("/api/admin/stats", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const { data: orders } = await supabase.from("orders").select("total_amount, created_at").gte("created_at", today.toISOString());
    const revenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    
    res.json({ dayRevenue: revenue, dayCount: orders.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
