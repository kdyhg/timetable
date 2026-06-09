import crypto from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash:admin -- <password>");
  process.exit(1);
}

const iterations = 210_000;
const salt = crypto.randomBytes(16).toString("hex");
const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
console.log(`pbkdf2$${iterations}$${salt}$${digest}`);
