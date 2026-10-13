import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { User, Transaction, Budget, Goal, Investment, Bill, AuditLog } from "./models.js";

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URLS = (process.env.CLIENT_URL || "http://localhost:5173").split(",").map(v => v.trim()).filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || "development_only_change_this_secret";
if (process.env.NODE_ENV === "production" && (!process.env.MONGODB_URI || JWT_SECRET === "development_only_change_this_secret" || JWT_SECRET.length < 32)) {
  console.error("Production requires MONGODB_URI and a JWT_SECRET of at least 32 characters.");
  process.exit(1);
}
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin(origin, callback) { if (!origin || CLIENT_URLS.includes(origin) || process.env.SERVE_CLIENT === "true") return callback(null, true); return callback(new Error("Origin is not allowed by CORS")); }, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 35, standardHeaders: true, legacyHeaders: false }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

const sign = user => jwt.sign({ id: user._id.toString(), role: user.role }, JWT_SECRET, { expiresIn: "7d" });
const safeUser = user => ({ id: user._id, name: user.name, email: user.email, username: user.username || "", currency: user.currency || "USD", role: user.role, status: user.status || "active", lastLoginAt: user.lastLoginAt || null });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ message: "Please sign in to continue." });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ message: "Account not found." });
    if (req.user.status === "suspended") return res.status(403).json({ message: "This account has been suspended. Contact support." });
    next();
  } catch { return res.status(401).json({ message: "Your session has expired. Please sign in again." }); }
}
const adminOnly = (req, res, next) => req.user?.role === "admin" ? next() : res.status(403).json({ message: "Administrator access required." });

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "FinTrack API" }));

app.post("/api/auth/signup", asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: "Name, email and password are required." });
  if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
  const normalized = email.toLowerCase().trim();
  if (await User.findOne({ email: normalized })) return res.status(409).json({ message: "An account with this email already exists." });
  const user = await User.create({ name: name.trim(), email: normalized, password: await bcrypt.hash(password, 12) });
  const now = new Date();
  const seed = [
    ["Whole Foods Market", "Food", "expense", 84.25, -6],
    ["Monthly salary", "Income", "income", 4820, -4],
    ["Netflix Subscription", "Subscriptions", "expense", 15.99, -3],
    ["Ride share", "Transport", "expense", 28.50, -2],
    ["Freelance project", "Income", "income", 1250, -1]
  ];
  await Transaction.insertMany(seed.map(([title, category, type, amount, days]) => ({ user: user._id, title, category, type, amount, date: new Date(now.getTime() + days * 86400000), status: "Success" })));
  await Budget.insertMany([
    { user: user._id, category: "Food", limit: 650 },
    { user: user._id, category: "Shopping", limit: 400 },
    { user: user._id, category: "Transport", limit: 250 },
    { user: user._id, category: "Subscriptions", limit: 120 }
  ]);
  await Goal.create({ user: user._id, name: "Emergency fund", target: 10000, saved: 3250, dueDate: new Date(now.getFullYear() + 1, now.getMonth(), 1) });
  await AuditLog.create({ actor: user._id, actorName: user.name, actorEmail: user.email, action: "registered account", resource: "auth", details: "New customer account created", outcome: "success" });
  res.status(201).json({ token: sign(user), user: safeUser(user) });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || req.body.username || "").toLowerCase().trim();
  const lookup = identifier.includes("@") ? { email: identifier } : { username: identifier };
  const user = await User.findOne(lookup).select("+password");
  // Same generic error avoids disclosing whether an account exists.
  if (!user) {
    await AuditLog.create({ actorName: "Unknown sign-in", actorEmail: identifier.slice(0, 160), action: "failed sign-in", resource: "auth", details: "Unknown username or email", outcome: "failure", ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64) }).catch(() => {});
    return res.status(401).json({ message: "Username/email or password is incorrect." });
  }
  if (user.status === "suspended") {
    await AuditLog.create({ actor: user._id, actorName: user.name, actorEmail: user.email, action: "suspended sign-in attempt", resource: "auth", details: "Suspended account attempted to sign in", outcome: "failure" }).catch(() => {});
    return res.status(403).json({ message: "This account has been suspended. Contact support." });
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) return res.status(423).json({ message: "Too many attempts. Try again in 15 minutes." });
  if (!(await bcrypt.compare(req.body.password || "", user.password))) {
    user.failedLogins += 1;
    if (user.failedLogins >= 5) { user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); user.failedLogins = 0; }
    await user.save();
    await AuditLog.create({ actor: user._id, actorName: user.name, actorEmail: user.email, action: "failed sign-in", resource: "auth", details: "Incorrect password supplied", outcome: "failure", ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64) }).catch(() => {});
    return res.status(401).json({ message: "Username/email or password is incorrect." });
  }
  user.failedLogins = 0; user.lockedUntil = undefined; user.lastLoginAt = new Date(); await user.save();
  await AuditLog.create({ actor: user._id, actorName: user.name, actorEmail: user.email, action: "signed in", resource: "auth", details: "Successful sign-in", outcome: "success", ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64) });
  res.json({ token: sign(user), user: safeUser(user) });
}));
app.get("/api/auth/me", auth, (req, res) => res.json({ user: safeUser(req.user) }));

app.post("/api/auth/forgot-password", asyncRoute(async (req, res) => {
  const email = req.body.email?.toLowerCase().trim();
  const user = await User.findOne({ email });
  const response = { message: "If an account exists for that email, reset instructions have been prepared." };
  if (!user) return res.json(response);
  const token = crypto.randomBytes(32).toString("hex");
  user.resetTokenHash = crypto.createHash("sha256").update(token).digest("hex");
  user.resetTokenExpiry = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: "Reset your FinTrack password", text: `Reset your password within 30 minutes: ${resetUrl}`, html: `<p>Use the link below within 30 minutes to reset your FinTrack password.</p><p><a href="${resetUrl}">Reset password</a></p>` });
  } else if (process.env.NODE_ENV !== "production") response.devResetUrl = resetUrl;
  res.json(response);
}));
app.post("/api/auth/reset-password", asyncRoute(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) return res.status(400).json({ message: "A valid reset token and a password of at least 8 characters are required." });
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ resetTokenHash: hash, resetTokenExpiry: { $gt: new Date() } }).select("+password");
  if (!user) return res.status(400).json({ message: "This reset link is invalid or expired. Request a new one." });
  user.password = await bcrypt.hash(password, 12); user.resetTokenHash = undefined; user.resetTokenExpiry = undefined; await user.save();
  res.json({ message: "Password updated successfully. You can now sign in." });
}));

app.use("/api", auth);
// Append an audit event for successful authenticated write operations. Request bodies are intentionally not stored.
app.use("/api", (req, res, next) => {
  const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
  if (!writeMethods.has(req.method) || req.path.startsWith("/admin/activity")) return next();
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || !req.user) return;
    const parts = req.path.split("/").filter(Boolean);
    const resource = parts[0] || "api";
    const resourceId = parts[1] && !["profile", "password"].includes(parts[1]) ? parts[1] : "";
    const methodAction = ({ POST: "created", PATCH: "updated", PUT: "updated", DELETE: "deleted" })[req.method];
    AuditLog.create({
      actor: req.user._id, actorName: req.user.name, actorEmail: req.user.email,
      action: `${methodAction} ${resource}`,
      resource, resourceId,
      details: `${req.method} ${req.path}`.slice(0, 240),
      outcome: "success", ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].slice(0, 64)
    }).catch(err => console.error("Audit log write failed:", err.message));
  });
  next();
});
app.get("/api/overview", asyncRoute(async (req, res) => {
  const user = req.user._id;
  const [transactions, budgets, goals, investments, bills] = await Promise.all([
    Transaction.find({ user }).sort({ date: -1 }).limit(200),
    Budget.find({ user }).sort({ category: 1 }),
    Goal.find({ user }).sort({ createdAt: -1 }),
    Investment.find({ user }).sort({ createdAt: -1 }),
    Bill.find({ user }).sort({ dueDate: 1 })
  ]);
  const income = transactions.filter(t => t.type === "income" && t.status !== "Failed").reduce((s,t)=>s+t.amount,0);
  const expenses = transactions.filter(t => t.type === "expense" && t.status !== "Failed").reduce((s,t)=>s+t.amount,0);
  const currentMonth = new Date().toISOString().slice(0,7);
  const mt = transactions.filter(t => new Date(t.date).toISOString().slice(0,7) === currentMonth);
  const monthIncome = mt.filter(t=>t.type==="income" && t.status!=="Failed").reduce((s,t)=>s+t.amount,0);
  const monthExpenses = mt.filter(t=>t.type==="expense" && t.status!=="Failed").reduce((s,t)=>s+t.amount,0);
  const spentByCategory = {};
  mt.filter(t=>t.type==="expense" && t.status!=="Failed").forEach(t=>{spentByCategory[t.category]=(spentByCategory[t.category]||0)+t.amount;});
  const anchor = new Date();
  const monthly = Array.from({length:12},(_,i)=>{
    const month=new Date(anchor.getFullYear(),anchor.getMonth()-11+i,1), key=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,"0")}`;
    const set=transactions.filter(t=>new Date(t.date).toISOString().slice(0,7)===key);
    return {month:month.toLocaleString("en-US",{month:"short"}),income:set.filter(t=>t.type==="income"&&t.status!=="Failed").reduce((s,t)=>s+t.amount,0),expenses:set.filter(t=>t.type==="expense"&&t.status!=="Failed").reduce((s,t)=>s+t.amount,0)};
  });
  res.json({ transactions, budgets, goals, investments, bills, stats:{balance:income-expenses,income,expenses,monthIncome,monthExpenses,spentByCategory}, monthly });
}));
app.get("/api/transactions", asyncRoute(async (req,res)=>{
  const filter={user:req.user._id};
  if(req.query.type&&["income","expense"].includes(req.query.type))filter.type=req.query.type;
  if(req.query.category)filter.category=req.query.category;
  if(req.query.search)filter.title={$regex:String(req.query.search).slice(0,80),$options:"i"};
  res.json({transactions:await Transaction.find(filter).sort({date:-1})});
}));
app.post("/api/transactions", asyncRoute(async (req,res)=>{
  const {title,category,type,amount,date,status,note}=req.body;
  if(!title?.trim()||!Number.isFinite(Number(amount))||Number(amount)<=0)return res.status(400).json({message:"Description and a positive amount are required."});
  const transaction=await Transaction.create({user:req.user._id,title:title.trim(),category:category||"Other",type:type||"expense",amount:Number(amount),date:date?new Date(date):new Date(),status:status||"Success",note:note||""});
  res.status(201).json({transaction});
}));
app.patch("/api/transactions/:id", asyncRoute(async(req,res)=>{
  const allowed={}; for(const k of ["title","category","type","amount","date","status","note"])if(req.body[k]!==undefined)allowed[k]=req.body[k];
  const transaction=await Transaction.findOneAndUpdate({_id:req.params.id,user:req.user._id},allowed,{new:true,runValidators:true});
  if(!transaction)return res.status(404).json({message:"Transaction not found."}); res.json({transaction});
}));
app.delete("/api/transactions/:id", asyncRoute(async(req,res)=>{
  const r=await Transaction.deleteOne({_id:req.params.id,user:req.user._id});if(!r.deletedCount)return res.status(404).json({message:"Transaction not found."});res.json({message:"Transaction deleted."});
}));

app.get("/api/budgets",asyncRoute(async(req,res)=>res.json({budgets:await Budget.find({user:req.user._id}).sort({category:1})})));
app.post("/api/budgets",asyncRoute(async(req,res)=>{
  const {category,limit,month}=req.body;if(!category||!Number.isFinite(Number(limit))||Number(limit)<=0)return res.status(400).json({message:"Category and positive limit are required."});
  const budget=await Budget.findOneAndUpdate({user:req.user._id,category,month:month||new Date().toISOString().slice(0,7)},{$set:{limit:Number(limit)}},{new:true,upsert:true,runValidators:true});res.status(201).json({budget});
}));
app.delete("/api/budgets/:id",asyncRoute(async(req,res)=>{const r=await Budget.deleteOne({_id:req.params.id,user:req.user._id});if(!r.deletedCount)return res.status(404).json({message:"Budget not found."});res.json({message:"Budget deleted."});}));

app.get("/api/goals",asyncRoute(async(req,res)=>res.json({goals:await Goal.find({user:req.user._id}).sort({createdAt:-1})})));
app.post("/api/goals",asyncRoute(async(req,res)=>{
  const {name,target,saved,dueDate,color}=req.body;if(!name?.trim()||!Number.isFinite(Number(target))||Number(target)<=0)return res.status(400).json({message:"Goal name and a positive target are required."});
  const goal=await Goal.create({user:req.user._id,name:name.trim(),target:Number(target),saved:Number(saved||0),dueDate:dueDate||undefined,color:color||"#43d4df"});res.status(201).json({goal});
}));
app.patch("/api/goals/:id",asyncRoute(async(req,res)=>{
  const allowed={};for(const k of ["name","target","saved","dueDate","color"])if(req.body[k]!==undefined)allowed[k]=req.body[k];
  const goal=await Goal.findOneAndUpdate({_id:req.params.id,user:req.user._id},allowed,{new:true,runValidators:true});if(!goal)return res.status(404).json({message:"Goal not found."});res.json({goal});
}));
app.delete("/api/goals/:id",asyncRoute(async(req,res)=>{const r=await Goal.deleteOne({_id:req.params.id,user:req.user._id});if(!r.deletedCount)return res.status(404).json({message:"Goal not found."});res.json({message:"Goal deleted."});}));

app.get("/api/investments",asyncRoute(async(req,res)=>res.json({investments:await Investment.find({user:req.user._id}).sort({createdAt:-1})})));
app.post("/api/investments",asyncRoute(async(req,res)=>{
  const {name,symbol,type,invested,current}=req.body;if(!name?.trim()||!Number.isFinite(Number(invested))||Number(invested)<0||!Number.isFinite(Number(current))||Number(current)<0)return res.status(400).json({message:"Name and valid invested/current values are required."});
  const investment=await Investment.create({user:req.user._id,name:name.trim(),symbol:symbol||"",type:type||"Stock",invested:Number(invested),current:Number(current)});res.status(201).json({investment});
}));
app.delete("/api/investments/:id",asyncRoute(async(req,res)=>{const r=await Investment.deleteOne({_id:req.params.id,user:req.user._id});if(!r.deletedCount)return res.status(404).json({message:"Investment not found."});res.json({message:"Investment deleted."});}));

app.get("/api/bills",asyncRoute(async(req,res)=>res.json({bills:await Bill.find({user:req.user._id}).sort({dueDate:1})})));
app.post("/api/bills",asyncRoute(async(req,res)=>{
  const {payee,amount,dueDate,recurrence}=req.body;if(!payee?.trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!dueDate)return res.status(400).json({message:"Payee, positive amount and due date are required."});
  const bill=await Bill.create({user:req.user._id,payee:payee.trim(),amount:Number(amount),dueDate,recurrence:recurrence||"Once"});res.status(201).json({bill});
}));
app.post("/api/bills/:id/pay",asyncRoute(async(req,res)=>{
  const bill=await Bill.findOne({_id:req.params.id,user:req.user._id});if(!bill)return res.status(404).json({message:"Bill not found."});
  if(bill.status==="Paid")return res.status(400).json({message:"This bill has already been paid."});
  // Demo-only simulated gateway; never moves real money.
  bill.status="Paid";await bill.save();
  await Transaction.create({user:req.user._id,title:`Bill payment — ${bill.payee}`,category:"Bills",type:"expense",amount:bill.amount,date:new Date(),status:"Success",note:"Simulated sandbox payment"});
  res.json({bill,message:"Sandbox payment simulated successfully. No real money moved."});
}));
app.delete("/api/bills/:id",asyncRoute(async(req,res)=>{const r=await Bill.deleteOne({_id:req.params.id,user:req.user._id,status:"Scheduled"});if(!r.deletedCount)return res.status(404).json({message:"Scheduled bill not found."});res.json({message:"Scheduled bill cancelled."});}));

app.patch("/api/settings/profile",asyncRoute(async(req,res)=>{
  const {name,currency}=req.body;if(name?.trim())req.user.name=name.trim();if(currency&&["USD","INR","EUR","GBP","CAD","AUD"].includes(currency))req.user.currency=currency;await req.user.save();res.json({user:safeUser(req.user)});
}));
app.patch("/api/settings/password",asyncRoute(async(req,res)=>{
  const {currentPassword,newPassword}=req.body;const user=await User.findById(req.user._id).select("+password");
  if(!(await bcrypt.compare(currentPassword||"",user.password)))return res.status(400).json({message:"Current password is incorrect."});
  if(!newPassword||newPassword.length<8)return res.status(400).json({message:"New password must be at least 8 characters."});
  user.password=await bcrypt.hash(newPassword,12);await user.save();res.json({message:"Password changed successfully."});
}));

app.get("/api/admin/overview", adminOnly, asyncRoute(async (req, res) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [
    totalUsers, activeUsers, suspendedUsers, newUsersThisMonth, totalTransactions,
    transactionAmounts, investmentSummary, pendingBills, totalBills, userCount,
    recentUsers, recentTransactions, recentActivity, monthlyRows
  ] = await Promise.all([
    User.countDocuments({ role: "user" }),
    User.countDocuments({ role: "user", status: "active", lastLoginAt: { $gte: thirtyDaysAgo } }),
    User.countDocuments({ role: "user", status: "suspended" }),
    User.countDocuments({ role: "user", createdAt: { $gte: monthStart } }),
    Transaction.countDocuments(),
    Transaction.aggregate([{ $match: { status: { $ne: "Failed" } } }, { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Investment.aggregate([{ $group: { _id: null, invested: { $sum: "$invested" }, current: { $sum: "$current" }, holdings: { $sum: 1 } } }]),
    Bill.countDocuments({ status: "Scheduled" }),
    Bill.countDocuments(),
    User.countDocuments(),
    User.find().select("name email username role status lastLoginAt createdAt").sort({ createdAt: -1 }).limit(8).lean(),
    Transaction.find().sort({ date: -1 }).limit(10).populate("user", "name email username").lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(10).lean(),
    Transaction.aggregate([
      { $match: { date: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) }, status: { $ne: "Failed" } } },
      { $group: { _id: { month: { $dateToString: { format: "%Y-%m", date: "$date" } }, type: "$type" }, total: { $sum: "$amount" } } },
      { $sort: { "_id.month": 1 } }
    ])
  ]);
  const totals = { income: 0, expenses: 0, volume: 0, successfulCount: 0 };
  transactionAmounts.forEach(row => { if (row._id === "income") totals.income = row.total; if (row._id === "expense") totals.expenses = row.total; totals.volume += row.total; totals.successfulCount += row.count; });
  const inv = investmentSummary[0] || { invested: 0, current: 0, holdings: 0 };
  const monthly = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const rows = monthlyRows.filter(r => r._id.month === key);
    return { month: d.toLocaleString("en-US", { month: "short" }), income: rows.filter(r => r._id.type === "income").reduce((s,r)=>s+r.total,0), expenses: rows.filter(r => r._id.type === "expense").reduce((s,r)=>s+r.total,0) };
  });
  res.json({ stats: { totalUsers, activeUsers, suspendedUsers, newUsersThisMonth, totalTransactions, income: totals.income, expenses: totals.expenses, netRecordedBalance: totals.income - totals.expenses, transactionVolume: totals.volume, totalInvested: inv.invested, portfolioValue: inv.current, portfolioGain: inv.current - inv.invested, investmentHoldings: inv.holdings, pendingBills, totalBills, allAccounts: userCount }, monthly, recentUsers, recentTransactions, recentActivity });
}));

app.get("/api/admin/users", adminOnly, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.search) {
    const q = String(req.query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }, { username: { $regex: q, $options: "i" } }];
  }
  if (req.query.status && ["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.role && ["user", "admin"].includes(req.query.role)) filter.role = req.query.role;
  const users = await User.find(filter).select("name email username role status lastLoginAt createdAt").sort({ createdAt: -1 }).limit(200).lean();
  res.json({ users });
}));
app.patch("/api/admin/users/:id", adminOnly, asyncRoute(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: "User not found." });
  if (String(target._id) === String(req.user._id) && (req.body.status === "suspended" || req.body.role === "user")) return res.status(400).json({ message: "You cannot suspend or demote your own admin account." });
  if (req.body.role && !["user", "admin"].includes(req.body.role)) return res.status(400).json({ message: "Invalid role." });
  if (req.body.status && !["active", "suspended"].includes(req.body.status)) return res.status(400).json({ message: "Invalid account status." });
  if (target.role === "admin" && req.body.role === "user") {
    const admins = await User.countDocuments({ role: "admin" });
    if (admins <= 1) return res.status(400).json({ message: "At least one administrator must remain." });
  }
  if (req.body.role) target.role = req.body.role;
  if (req.body.status) target.status = req.body.status;
  await target.save();
  res.json({ user: safeUser(target), message: "User account updated." });
}));
app.get("/api/admin/transactions", adminOnly, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.type && ["income", "expense"].includes(req.query.type)) filter.type = req.query.type;
  if (req.query.status && ["Success", "Pending", "Failed"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) filter.title = { $regex: String(req.query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  const transactions = await Transaction.find(filter).sort({ date: -1 }).limit(2000).populate("user", "name email username").lean();
  res.json({ transactions });
}));
app.get("/api/admin/investments", adminOnly, asyncRoute(async (req, res) => {
  const investments = await Investment.find().sort({ updatedAt: -1 }).limit(1000).populate("user", "name email username").lean();
  res.json({ investments });
}));
app.get("/api/admin/activity", adminOnly, asyncRoute(async (req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(250).lean();
  res.json({ logs });
}));

// In the Render single-service deployment, Express also serves the built React SPA.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
if (process.env.SERVE_CLIENT === "true") {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDist, "index.html"), err => { if (err) next(err); });
  });
}
app.use((err,_req,res,_next)=>{
  console.error(err);
  if(err?.code===11000)return res.status(409).json({message:"That record already exists."});
  if(err?.name==="ValidationError"||err?.name==="CastError")return res.status(400).json({message:err.message});
  res.status(err?.message?.includes("CORS") ? 403 : 500).json({message:err?.message?.includes("CORS") ? "Origin not allowed." : "Something went wrong. Please try again."});
});

// Export the app for tests/tools; only open a listening socket when run as the service.
export default app;
if (process.env.NODE_ENV !== "test") {
  mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fintrack")
    .then(() => app.listen(PORT, () => console.log(`FinTrack API listening on port ${PORT}`)))
    .catch(err => { console.error("MongoDB connection failed:", err.message); process.exit(1); });
}
