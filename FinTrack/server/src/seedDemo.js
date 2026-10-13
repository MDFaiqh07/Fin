import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Transaction, Budget, Goal, Investment, Bill, AuditLog } from "./models.js";

const connection = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fintrack";
const password1 = process.env.DEMO_USER1_PASSWORD || "Lily@Fintrack123";
const password2 = process.env.DEMO_USER2_PASSWORD || "Noah@Fintrack123";
const adminUsername = String(process.env.ADMIN_USERNAME || "admin").toLowerCase();
const categories = ["Food", "Transport", "Shopping", "Housing", "Utilities", "Healthcare", "Entertainment", "Subscriptions", "Travel", "Education", "Income", "Freelance", "Investment", "Savings", "Family"];
const merchants = {
  Food: ["Whole Foods Market", "Local Cafe", "Fresh Market", "Dinner & Co", "Grocery Store"],
  Transport: ["Metro Transit", "Ride Share", "Fuel Station", "City Parking"],
  Shopping: ["Amazon Purchase", "Clothing Store", "Electronics Shop", "Home Goods"],
  Housing: ["Rent Payment", "Home Supplies"],
  Utilities: ["Electric Utility", "Internet Service", "Water Utility", "Mobile Plan"],
  Healthcare: ["Pharmacy", "Health Clinic", "Dental Care"],
  Entertainment: ["Cinema Tickets", "Streaming Rental", "Concert Tickets"],
  Subscriptions: ["Netflix Subscription", "Music Subscription", "Cloud Storage"],
  Travel: ["Hotel Booking", "Airline Ticket", "Travel Pass"],
  Education: ["Online Course", "Book Store", "Learning Platform"],
  Income: ["Monthly Salary", "Bonus Payment", "Interest Income"],
  Freelance: ["Freelance Invoice", "Consulting Project"],
  Investment: ["Dividend Payment", "Brokerage Deposit"]
};
const profileMerchants = {
  lily: {
    Food: ["Fresh Market", "Lunch Cafe", "Meal Delivery", "Coffee Before Stand-up", "Weekend Brunch"],
    Shopping: ["Online Clothing Store", "Home Office Store", "Electronics Shop", "Book Store"],
    Subscriptions: ["GitHub Subscription", "Cloud IDE Plan", "Music Subscription", "Streaming Service"],
    Education: ["Developer Course", "Technical Book Store", "Cloud Certification Exam"],
    Transport: ["Metro Transit", "Ride Share", "Fuel Station", "Office Parking"],
    Income: ["Monthly Software Developer Salary", "Annual Performance Bonus", "Expense Reimbursement"],
    Freelance: ["Code Review Contract", "Freelance Web Project"],
    Investment: ["Index Fund Contribution", "Brokerage Dividend"],
    Savings: ["Emergency Fund Transfer", "Travel Savings Transfer"],
    Family: ["Family Support Transfer", "Birthday Gift"]
  },
  noah: {
    Food: ["Grocery Store", "Office Lunch", "Meal Delivery", "Coffee Shop", "Dinner with Friends"],
    Shopping: ["Computer Accessories", "Hardware Store", "Online Marketplace", "Sportswear Store"],
    Subscriptions: ["Cloud Monitoring Tool", "Password Manager", "Streaming Service", "Music Subscription"],
    Education: ["Cloud Certification", "Systems Engineering Course", "Technical Book Store"],
    Transport: ["Fuel Station", "Metro Transit", "Ride Share", "Vehicle Maintenance"],
    Income: ["Monthly Systems Engineer Salary", "On-call Allowance", "Project Reimbursement"],
    Freelance: ["IT Support Contract", "Network Setup Project"],
    Investment: ["ETF Purchase", "Brokerage Dividend"],
    Savings: ["Emergency Savings Transfer", "New Equipment Savings"],
    Family: ["Shared Household Transfer", "Family Gift"]
  }
};
const rand = (seed) => { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };

async function upsertDemo({ name, username, email, password, seed, incomeScale, spendScale }) {
  let user = await User.findOne({ $or: [{ username }, { email }] }).select("+password");
  if (!user) user = new User({ name, username, email });
  user.name = name; user.username = username; user.email = email; user.password = await bcrypt.hash(password, 12); user.role = "user"; user.status = "active"; user.currency = "USD"; user.lastLoginAt = new Date(); user.failedLogins = 0; user.lockedUntil = undefined;
  await user.save();

  // Rebuild only this demo user's records, so the seed can be safely re-run.
  await Promise.all([Transaction.deleteMany({ user: user._id }), Budget.deleteMany({ user: user._id }), Goal.deleteMany({ user: user._id }), Investment.deleteMany({ user: user._id }), Bill.deleteMany({ user: user._id })]);
  const random = rand(seed); const now = new Date(); const transactions = [];
  for (let i = 0; i < 1000; i++) {
    const roll = random();
    // About two years of activity: recurring salary credits plus occasional
    // contract income/investment activity, with the rest spent on daily life.
    let category;
    if (i % 42 === 0) category = "Income";
    else if (i % 97 === 0) category = "Freelance";
    else if (i % 61 === 0) category = "Investment";
    else {
      const everyday = ["Food", "Transport", "Shopping", "Housing", "Utilities", "Healthcare", "Entertainment", "Subscriptions", "Travel", "Education", "Savings", "Family"];
      category = everyday[Math.floor(random() * everyday.length)];
    }
    const type = ["Income", "Freelance"].includes(category) || (category === "Investment" && random() > 0.45) ? "income" : "expense";
    const amount = type === "income"
      ? (category === "Income" ? 1800 + random() * 3600 : 80 + random() * 1600) * incomeScale
      : (8 + Math.pow(random(), 2.15) * 520) * spendScale;
    const daysAgo = Math.floor(random() * 730);
    const date = new Date(now.getTime() - daysAgo * 86400000 - Math.floor(random() * 86400000));
    const statusRoll = random();
    const status = statusRoll < 0.935 ? "Success" : statusRoll < 0.98 ? "Pending" : "Failed";
    const titleList = profileMerchants[username]?.[category] || merchants[category] || [category + " transaction"];
    transactions.push({ user: user._id, title: titleList[Math.floor(random() * titleList.length)], category, type, amount: Math.round(amount * 100) / 100, date, status, note: `${username === "lily" ? "Software developer" : "IT systems engineer"} demo activity ${String(i + 1).padStart(4, "0")}` });
  }
  for (let i = 0; i < transactions.length; i += 300) await Transaction.insertMany(transactions.slice(i, i + 300), { ordered: false });

  await Budget.insertMany([
    { user: user._id, category: "Food", limit: 720 }, { user: user._id, category: "Shopping", limit: 450 },
    { user: user._id, category: "Transport", limit: 280 }, { user: user._id, category: "Subscriptions", limit: 140 },
    { user: user._id, category: "Entertainment", limit: 220 }, { user: user._id, category: "Travel", limit: 900 }
  ]);
  await Goal.insertMany([
    { user: user._id, name: "Emergency fund", target: 15000, saved: 6400 + seed % 2000, dueDate: new Date(now.getFullYear() + 1, now.getMonth(), 1), color: "#43d4df" },
    { user: user._id, name: "Travel fund", target: 5000, saved: 1800 + seed % 700, dueDate: new Date(now.getFullYear(), now.getMonth() + 8, 1), color: "#a78bfa" },
    { user: user._id, name: "New laptop", target: 2200, saved: 750 + seed % 300, dueDate: new Date(now.getFullYear(), now.getMonth() + 4, 1), color: "#f5b84b" }
  ]);
  await Investment.insertMany([
    { user: user._id, name: "S&P 500 Index Fund", symbol: "VOO", type: "ETF", invested: 5200 * incomeScale, current: 5840 * incomeScale },
    { user: user._id, name: "Apple Inc.", symbol: "AAPL", type: "Stock", invested: 2100 * incomeScale, current: 2385 * incomeScale },
    { user: user._id, name: "Microsoft Corp.", symbol: "MSFT", type: "Stock", invested: 1850 * incomeScale, current: 1775 * incomeScale },
    { user: user._id, name: "Treasury Bond Fund", symbol: "BND", type: "Bond ETF", invested: 3000 * incomeScale, current: 3090 * incomeScale },
    { user: user._id, name: "Global Equity ETF", symbol: "VT", type: "ETF", invested: 1250 * incomeScale, current: 1390 * incomeScale }
  ]);
  await Bill.insertMany([
    { user: user._id, payee: "Rent / Mortgage", amount: 1450 * spendScale, dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 1), recurrence: "Monthly", status: "Scheduled" },
    { user: user._id, payee: "Electricity", amount: 95 * spendScale, dueDate: new Date(now.getTime() + 6 * 86400000), recurrence: "Monthly", status: "Scheduled" },
    { user: user._id, payee: "Internet", amount: 65 * spendScale, dueDate: new Date(now.getTime() + 10 * 86400000), recurrence: "Monthly", status: "Scheduled" },
    { user: user._id, payee: "Phone plan", amount: 48 * spendScale, dueDate: new Date(now.getTime() - 4 * 86400000), recurrence: "Monthly", status: "Paid" }
  ]);
  await AuditLog.create({ actor: user._id, actorName: user.name, actorEmail: user.email, action: "demo data seeded", resource: "demo", details: "Generated 1,000 synthetic IT-professional transactions plus budgets, goals, investments and bills", outcome: "success" });
  console.log(`${username}: seeded 1,000 transactions, 6 budgets, 3 goals, 5 holdings, 4 bills`);
}

try {
  await mongoose.connect(connection);
  const admin = await User.findOne({ username: adminUsername, role: "admin" });
  if (!admin) throw new Error(`Admin account '${adminUsername}' was not found. Run npm run admin:seed first.`);
  await upsertDemo({ name: "Lily Rose", username: "lily", email: "lily@fintrack.local", password: password1, seed: 1471, incomeScale: 1, spendScale: 1 });
  await upsertDemo({ name: "Noah Carter", username: "noah", email: "noah@fintrack.local", password: password2, seed: 2947, incomeScale: 0.82, spendScale: 0.78 });
  await AuditLog.create({ actor: admin._id, actorName: admin.name, actorEmail: admin.email, action: "demo accounts provisioned", resource: "demo", details: "Seeded two demo IT professionals with 1,000 transactions each", outcome: "success" });
  console.log("\nFinTrack demo accounts are ready. These are fictional demo records:");
  console.log("Lily Rose | username: lily | email: lily@fintrack.local | password: " + password1);
  console.log("Noah Carter | username: noah | email: noah@fintrack.local | password: " + password2);
  console.log("Admin can inspect all 2,000 transactions in the Control panel. Use Logout to switch accounts.\n");
} catch (error) {
  console.error("Could not seed demo accounts:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
