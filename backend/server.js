import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// Pricing Configuration
const RATES = { 
  bw_single: 1.5, bw_double: 1.0, 
  col_single: 5.0, col_double: 4.5 
};
const COIN_VAL = 0.1; // 1 Coin = 0.1 currency unit
const TAX_RATE = 0.18;

// --- 1. PROCESS PRINT ORDER ---
app.post("/api/process-print", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // 1. Safe JSON Parse
    let meta;
    try {
      meta = JSON.parse(req.body.meta || "{}");
    } catch (e) {
      return res.status(400).json({ error: "Invalid metadata" });
    }

    const { userId, userEmail, couponCode, useCoins, copies = 1, numPages = 1 } = meta;

    // 2. Check VIP Status
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const isVIP = profile?.role === 'VIP';

    // 3. Calculate Rates
    // Logic: If color=true, use Color rates. If doubleSide=true, use Double rates.
    const rateType = meta.color 
      ? (meta.doubleSide ? RATES.col_double : RATES.col_single)
      : (meta.doubleSide ? RATES.bw_double : RATES.bw_single);
    
    // Total Sheets calculation (User input "numPages" is pages in PDF)
    // If Double Sided: 10 pages = 5 sheets. 11 pages = 6 sheets.
    const sheetsPerCopy = meta.doubleSide ? Math.ceil(parseInt(numPages) / 2) : parseInt(numPages);
    const totalSheets = sheetsPerCopy * parseInt(copies);
    
    let subtotal = totalSheets * rateType;
    
    // VIP gets base printing free, but let's assume standard logic first
    if (isVIP) subtotal = 0;

    // Tax is added to the subtotal
    let total = subtotal + (subtotal * TAX_RATE);
    
    // 4. Coupons
    if (couponCode && !isVIP && total > 0) {
      const { data: c } = await supabase.from("coupons").select("*").eq("code", couponCode).single();
      if (c && c.active) {
        // Check one-time usage
        const { data: used } = await supabase.from("used_coupons").select("*").eq("user_id", userId).eq("coupon_code", couponCode).maybeSingle();
        
        if (!c.is_one_time || !used) {
           // Calculate discount
           const discountAmount = (total * c.discount_percent) / 100;
           total -= discountAmount;

           // If one-time, mark it used NOW (or after payment success, but here is safer for locking)
           if(c.is_one_time) {
             await supabase.from("used_coupons").insert([{ user_id: userId, coupon_code: couponCode }]);
           }
        }
      }
    }

    // 5. Wallet Coins
    let coinsRedeemed = 0;
    if (useCoins && total > 0 && !isVIP) {
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
      if (w && w.balance > 0) {
        // Max value we can cover with coins
        const coinValueAvailable = w.balance * COIN_VAL;
        const valueToCover = Math.min(total, coinValueAvailable);
        
        coinsRedeemed = valueToCover / COIN_VAL; // Convert back to coins
        total -= valueToCover;
      }
    }

    // 6. Generate QR & Filename
    const random6 = crypto.randomBytes(3).toString("hex").toUpperCase(); 
    const char7 = meta.color ? '1' : '0';
    const char8 = meta.doubleSide ? '1' : '0';
    const qrCode = `${random6}${char7}${char8}`; 
    const fileName = `${qrCode}_${Date.now()}.pdf`; 

    // 7. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("prints")
      .upload(fileName, req.file.buffer, { contentType: "application/pdf" });

    if (uploadError) throw new Error("Storage Upload Failed");

    // 8. Insert Order Record
    // "expires_at" is 1 hour from now
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    
    await supabase.from("orders").insert([{
      user_id: userId,
      user_email: userEmail,
      qr_code: qrCode,
      file_path: fileName,
      pages_selected: totalSheets, 
      color: meta.color,
      double_sided: meta.doubleSide,
      total_amount: Math.max(0, total).toFixed(2), // Ensure no negative
      status: "PAID",
      created_at: new Date(),
      expires_at: expiresAt,
      printed: false,
      expired: false
    }]);

    // 9. Wallet Transactions (Debit & Credit)
    if (coinsRedeemed > 0) {
      await supabase.from("wallet_transactions").insert([{ 
        user_id: userId, 
        amount: -coinsRedeemed, 
        type: "DEBIT", 
        note: `Paid for order ${qrCode}` 
      }]);
    }
    
    // Earn Cashback (1 coin per 10 currency units spent on subtotal)
    const earned = !isVIP ? Math.floor(subtotal / 10) : 0;
    if (earned > 0) {
      await supabase.from("wallet_transactions").insert([{ 
        user_id: userId, 
        amount: earned, 
        type: "EARN", 
        note: `Cashback for ${qrCode}` 
      }]);
    }
    
    // Update Wallet Balance
    if (coinsRedeemed > 0 || earned > 0) {
        // Fetch fresh balance first to be safe
        const { data: currentWallet } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
        const newBalance = (currentWallet?.balance || 0) - coinsRedeemed + earned;
        
        // Upsert ensures wallet exists if it didn't
        await supabase.from("wallets").upsert({ user_id: userId, balance: newBalance });
    }

    res.json({ success: true, qr: qrCode });

  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: e.message }); 
  }
});

// --- 2. GET USER DATA (Wallet & Orders) ---
app.get("/api/user-data/:uid", async (req, res) => {
    try {
        const { uid } = req.params;
        
        // Parallel fetch for speed
        const [walletRes, ordersRes] = await Promise.all([
            supabase.from("wallets").select("balance").eq("user_id", uid).single(),
            supabase.from("orders").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(10)
        ]);

        res.json({
            wallet: walletRes.data?.balance || 0,
            orders: ordersRes.data || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 3. KIOSK CONSUME (The "Print" Action) ---
app.post("/api/print/consume", async (req, res) => {
  try {
    const { qr } = req.body;
    
    const { data: order } = await supabase.from("orders").select("*").eq("qr_code", qr).single();
    
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.printed) return res.status(400).json({ error: "Already used" });
    if (order.expired || new Date(order.expires_at) < new Date()) {
        // Mark as expired if not already
        await supabase.from("orders").update({ expired: true, status: "EXPIRED" }).eq("qr_code", qr);
        return res.status(400).json({ error: "Code expired" });
    }

    // Valid Print:
    // 1. Mark status
    await supabase.from("orders").update({ 
        status: "PRINTED", 
        printed: true, 
        printed_at: new Date() 
    }).eq("qr_code", qr);

    // 2. DELETE FILE (Privacy Feature)
    if (order.file_path) {
        await supabase.storage.from("prints").remove([order.file_path]);
    }
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 4. CRON / CLEANUP (Manual trigger or scheduled) ---
// In a real app, use Supabase Edge Functions. Here, we expose an endpoint 
// that the frontend or a cron service can hit to clean old files.
app.get("/api/cleanup", async (req, res) => {
    const now = new Date().toISOString();
    
    // Find expired orders that aren't marked expired yet
    const { data: expiredOrders } = await supabase.from("orders")
        .select("file_path, order_id")
        .lt("expires_at", now)
        .eq("expired", false)
        .eq("printed", false); // Only unprinted ones need cleanup

    if (expiredOrders && expiredOrders.length > 0) {
        const files = expiredOrders.map(o => o.file_path).filter(Boolean);
        const ids = expiredOrders.map(o => o.order_id);

        // Delete files
        if (files.length > 0) await supabase.storage.from("prints").remove(files);
        
        // Update DB
        /* Note: Supabase doesn't support bulk update with 'in' easily in JS client for updates 
           without iterating, but 'update' with a filter works */
        // We will just do a loop or simple query for now
        for (const id of ids) {
             await supabase.from("orders").update({ expired: true, status: 'EXPIRED' }).eq("order_id", id);
        }
    }
    res.json({ cleaned: expiredOrders?.length || 0 });
});

app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
