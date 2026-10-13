import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  currency: { type: String, default: "USD" },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  status: { type: String, enum: ["active", "suspended"], default: "active" },
  lastLoginAt: Date,
  resetTokenHash: String,
  resetTokenExpiry: Date,
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true },
  category: { type: String, default: "Other" },
  type: { type: String, enum: ["income", "expense"], default: "expense" },
  amount: { type: Number, required: true, min: 0.01 },
  date: { type: Date, default: Date.now },
  status: { type: String, enum: ["Success", "Pending", "Failed"], default: "Success" },
  note: { type: String, default: "" }
}, { timestamps: true });

const budgetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  category: { type: String, required: true },
  limit: { type: Number, required: true, min: 1 },
  month: { type: String, default: () => new Date().toISOString().slice(0, 7) }
}, { timestamps: true });

const goalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  target: { type: Number, required: true, min: 1 },
  saved: { type: Number, default: 0, min: 0 },
  dueDate: Date,
  color: { type: String, default: "#43d4df" }
}, { timestamps: true });

const investmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  symbol: { type: String, default: "" },
  type: { type: String, default: "Stock" },
  invested: { type: Number, required: true, min: 0 },
  current: { type: Number, required: true, min: 0 }
}, { timestamps: true });

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  actorName: { type: String, default: "System" },
  actorEmail: { type: String, default: "" },
  action: { type: String, required: true, index: true },
  resource: { type: String, required: true, index: true },
  resourceId: { type: String, default: "" },
  details: { type: String, default: "" },
  outcome: { type: String, enum: ["success", "failure"], default: "success" },
  ipAddress: { type: String, default: "" }
}, { timestamps: true });

const billSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  payee: { type: String, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  dueDate: { type: Date, required: true },
  recurrence: { type: String, enum: ["Once", "Weekly", "Monthly"], default: "Once" },
  status: { type: String, enum: ["Scheduled", "Paid", "Failed"], default: "Scheduled" }
}, { timestamps: true });

export const User = mongoose.model("User", userSchema);
export const Transaction = mongoose.model("Transaction", transactionSchema);
export const Budget = mongoose.model("Budget", budgetSchema);
export const Goal = mongoose.model("Goal", goalSchema);
export const Investment = mongoose.model("Investment", investmentSchema);
export const Bill = mongoose.model("Bill", billSchema);
export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
