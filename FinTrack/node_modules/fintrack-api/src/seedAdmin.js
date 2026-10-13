import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./models.js";

const username = String(process.env.ADMIN_USERNAME || "admin").toLowerCase().trim();
const email = String(process.env.ADMIN_EMAIL || "admin@fintrack.local").toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || "Admin@123456";

if (password.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/fintrack");
  let user = await User.findOne({ $or: [{ username }, { email }] }).select("+password");
  if (!user) user = new User({ name: "FinTrack Admin", email, username });
  user.name = "FinTrack Admin";
  user.email = email;
  user.username = username;
  user.password = await bcrypt.hash(password, 12);
  user.role = "admin";
  user.status = "active";
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  await user.save();
  console.log("\nFinTrack administrator is ready.");
  console.log(`Username: ${username}`);
  console.log(`Email:    ${email}`);
  console.log("Password: (the ADMIN_PASSWORD in server/.env)");
  console.log("Login at http://localhost:5173/login and enter the username above.");
  console.log("For local/demo use only: change the default password before exposing this app to a network.\n");
} catch (error) {
  console.error("Could not provision admin:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
