const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_DIR = path.join(ROOT_DIR, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

loadEnvFile(path.join(ROOT_DIR, ".env"));

const CONFIG = {
  shopName: process.env.SHOP_NAME || "Sneckin",
  phone: process.env.SHOP_PHONE || "+48690755658",
  currency: process.env.SHOP_CURRENCY || "PLN",
  telegramBotUsername: cleanBotUsername(process.env.TELEGRAM_BOT_USERNAME || ""),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramOwnerIds: parseCsv(process.env.TELEGRAM_OWNER_IDS || ""),
  telegramGroupChatId: process.env.TELEGRAM_GROUP_CHAT_ID || "",
  telegramGroupInviteUrl: process.env.TELEGRAM_GROUP_INVITE_URL || "https://t.me/+RE21y_qYc1dkNTg6",
  devAdminCode: process.env.DEV_ADMIN_CODE || "",
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex")
};

const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();
let storeQueue = Promise.resolve();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await routeApi(req, res, requestUrl);
      return;
    }

    await serveStatic(req, res, requestUrl);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);

    sendJson(res, statusCode, {
      error: error.code || "internal_error",
      message: error.statusCode ? error.message : "Что-то пошло не так на сервере."
    });
  }
});

server.listen(PORT, () => {
  console.log(`${CONFIG.shopName} is running at http://localhost:${PORT}`);
});

async function routeApi(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    const session = getSession(req);
    sendJson(res, 200, {
      shopName: CONFIG.shopName,
      phone: CONFIG.phone,
      currency: CONFIG.currency,
      telegramBotUsername: CONFIG.telegramBotUsername,
      telegramLoginReady: Boolean(CONFIG.telegramBotUsername && CONFIG.telegramBotToken),
      telegramGroupReady: Boolean(CONFIG.telegramBotToken && CONFIG.telegramGroupChatId),
      telegramGroupInviteUrl: CONFIG.telegramGroupInviteUrl,
      devAuthAvailable: Boolean(CONFIG.devAdminCode),
      user: session ? session.user : null
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const session = getSession(req);
    sendJson(res, 200, { user: session ? session.user : null });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/telegram") {
    const payload = await readJsonBody(req);
    const verified = verifyTelegramAuth(payload);

    if (!verified.ok) {
      sendJson(res, 401, { error: "telegram_auth_failed", message: verified.message });
      return;
    }

    const telegramId = String(payload.id);
    const role = CONFIG.telegramOwnerIds.includes(telegramId) ? "owner" : "customer";
    const user = {
      id: telegramId,
      role,
      firstName: String(payload.first_name || ""),
      lastName: String(payload.last_name || ""),
      username: String(payload.username || ""),
      photoUrl: String(payload.photo_url || ""),
      source: "telegram"
    };

    setSessionCookie(res, createSession(user));
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/dev") {
    if (!CONFIG.devAdminCode) {
      sendJson(res, 404, { error: "not_found", message: "Локальный вход владельца не включен." });
      return;
    }

    const payload = await readJsonBody(req);
    if (String(payload.code || "") !== CONFIG.devAdminCode) {
      sendJson(res, 403, { error: "bad_dev_code", message: "Неверный код владельца." });
      return;
    }

    const user = {
      id: "dev-owner",
      role: "owner",
      firstName: "Sneckin",
      lastName: "Owner",
      username: "local-owner",
      photoUrl: "",
      source: "dev"
    };

    setSessionCookie(res, createSession(user));
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const sid = getCookie(req, "sid");
    if (sid) sessions.delete(sid);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/products") {
    const store = await readStore();
    sendJson(res, 200, { products: store.products });
    return;
  }

  if (req.method === "POST" && pathname === "/api/uploads") {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const upload = await readImageUpload(req);
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });

    const filename = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}${upload.extension}`;
    const targetPath = path.join(UPLOAD_DIR, filename);
    await fsp.writeFile(targetPath, upload.buffer);

    sendJson(res, 201, {
      imageUrl: `/uploads/${filename}`,
      originalName: upload.originalName,
      size: upload.buffer.length
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/products") {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const payload = await readJsonBody(req);
    const product = normalizeProduct(payload);

    const saved = await updateStore((store) => {
      const now = new Date().toISOString();
      const created = {
        id: `prd_${crypto.randomUUID()}`,
        ...product,
        createdAt: now,
        updatedAt: now
      };
      store.products.unshift(created);
      return created;
    });

    sendJson(res, 201, { product: saved });
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && req.method === "PATCH") {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const productId = decodeURIComponent(productMatch[1]);
    const payload = await readJsonBody(req);
    const productPatch = normalizeProduct(payload);

    const updated = await updateStore((store) => {
      const product = store.products.find((item) => item.id === productId);
      if (!product) {
        const error = new Error("not_found");
        error.statusCode = 404;
        throw error;
      }

      Object.assign(product, productPatch, { updatedAt: new Date().toISOString() });
      return product;
    });

    sendJson(res, 200, { product: updated });
    return;
  }

  if (productMatch && req.method === "DELETE") {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const productId = decodeURIComponent(productMatch[1]);
    const removed = await updateStore((store) => {
      const index = store.products.findIndex((item) => item.id === productId);
      if (index === -1) {
        const error = new Error("not_found");
        error.statusCode = 404;
        throw error;
      }

      const [product] = store.products.splice(index, 1);
      return product;
    });

    sendJson(res, 200, { product: removed });
    return;
  }

  if (req.method === "POST" && pathname === "/api/orders") {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 401, {
        error: "auth_required",
        message: "Войдите через Telegram, чтобы оформить заказ."
      });
      return;
    }

    const payload = await readJsonBody(req);
    const order = await createOrder(payload, session.user);
    const telegram = await sendOrderToTelegram(order);
    sendJson(res, 201, { order, telegram });
    return;
  }

  if (req.method === "GET" && pathname === "/api/orders") {
    const owner = requireOwner(req, res);
    if (!owner) return;

    const limit = Math.min(Number(requestUrl.searchParams.get("limit") || 30), 100);
    const store = await readStore();
    sendJson(res, 200, { orders: store.orders.slice(0, limit) });
    return;
  }

  sendJson(res, 404, { error: "not_found", message: "Такого API-адреса нет." });
}

async function serveStatic(req, res, requestUrl) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";

  const targetPath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!targetPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(targetPath);
    if (!stat.isFile()) throw new Error("not_file");

    const ext = path.extname(targetPath).toLowerCase();
    const isCodeAsset = [".html", ".css", ".js"].includes(ext);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": isCodeAsset ? "no-store" : "public, max-age=3600"
    });
    fs.createReadStream(targetPath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readImageUpload(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw httpError(400, "bad_upload", "Загрузите изображение через форму.");
  }

  const body = await readRawBody(req, MAX_UPLOAD_BYTES + 1024 * 128);
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = parseMultipartBody(body, boundary);
  const filePart = parts.find((part) => part.name === "image" && part.filename);

  if (!filePart || !filePart.data.length) {
    throw httpError(400, "image_required", "Выберите фото товара.");
  }

  if (filePart.data.length > MAX_UPLOAD_BYTES) {
    throw httpError(413, "image_too_large", "Фото должно быть не больше 5 МБ.");
  }

  const mimeType = filePart.contentType.toLowerCase();
  const detectedMime = detectImageMime(filePart.data);
  const extension = IMAGE_EXTENSIONS[detectedMime || mimeType];

  if (!extension) {
    throw httpError(400, "unsupported_image", "Можно загрузить JPG, PNG, WebP или GIF.");
  }

  return {
    buffer: filePart.data,
    contentType: detectedMime || mimeType,
    extension,
    originalName: cleanText(filePart.filename, 120)
  };
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "body_too_large", "Файл слишком большой.");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function parseMultipartBody(body, boundary) {
  const parts = [];
  let cursor = 0;

  while (cursor < body.length) {
    const start = body.indexOf(boundary, cursor);
    if (start === -1) break;

    const contentStart = start + boundary.length;
    if (body[contentStart] === 45 && body[contentStart + 1] === 45) break;

    let partStart = contentStart;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;

    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let dataEnd = nextBoundary;
    if (body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;

    const headers = parseMultipartHeaders(body.slice(partStart, headerEnd).toString("utf8"));
    const disposition = headers["content-disposition"] || "";
    const name = parseHeaderParam(disposition, "name");
    const filename = parseHeaderParam(disposition, "filename");

    parts.push({
      name,
      filename,
      contentType: headers["content-type"] || "application/octet-stream",
      data: body.slice(headerEnd + 4, dataEnd)
    });

    cursor = nextBoundary + boundary.length;
  }

  return parts;
}

function parseMultipartHeaders(rawHeaders) {
  const headers = {};
  for (const line of rawHeaders.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[key] = value;
  }
  return headers;
}

function parseHeaderParam(header, name) {
  const match = header.match(new RegExp(`${name}="([^"]*)"`, "i"));
  if (match) return match[1];

  const bareMatch = header.match(new RegExp(`${name}=([^;]+)`, "i"));
  return bareMatch ? bareMatch[1].trim() : "";
}

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.slice(0, 6).toString("ascii"))) return "image/gif";
  return "";
}

async function createOrder(payload, user) {
  const customerName = cleanText(payload.customerName, 80);
  const customerPhone = cleanText(payload.customerPhone, 40);
  const address = cleanText(payload.address, 240);
  const comment = cleanText(payload.comment, 500);
  const deliveryType = cleanText(payload.deliveryType || "pickup", 40);

  if (!customerName) throw httpError(400, "customer_name_required", "Укажите имя.");
  if (!customerPhone) throw httpError(400, "customer_phone_required", "Укажите телефон.");
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw httpError(400, "empty_cart", "Корзина пустая.");
  }

  return updateStore((store) => {
    const items = [];

    for (const line of payload.items) {
      const product = store.products.find((item) => item.id === String(line.productId) && item.available);
      if (!product) continue;

      const quantity = Math.max(1, Math.min(99, Number.parseInt(line.quantity, 10) || 1));
      items.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        price: product.price,
        quantity,
        lineTotal: roundMoney(product.price * quantity)
      });
    }

    if (items.length === 0) {
      throw httpError(400, "empty_cart", "В корзине нет доступных товаров.");
    }

    const total = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
    const now = new Date().toISOString();
    const order = {
      id: `ord_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
      createdAt: now,
      status: "new",
      currency: CONFIG.currency,
      total,
      customer: {
        name: customerName,
        phone: customerPhone,
        address,
        comment,
        deliveryType,
        telegram: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName
        }
      },
      items
    };

    store.orders.unshift(order);
    return order;
  });
}

function normalizeProduct(payload) {
  const name = cleanText(payload.name, 80);
  const description = cleanText(payload.description, 400);
  const category = cleanText(payload.category || "Снеки", 60);
  const unit = cleanText(payload.unit || "1 шт", 40);
  const image = cleanText(payload.image || "/assets/product-crunch-mix.png", 240);
  const price = roundMoney(Number(payload.price));
  const available = Boolean(payload.available);

  if (!name) throw httpError(400, "product_name_required", "Введите название позиции.");
  if (!Number.isFinite(price) || price <= 0) {
    throw httpError(400, "product_price_required", "Цена должна быть больше нуля.");
  }

  return { name, description, category, unit, image, price, available };
}

async function sendOrderToTelegram(order) {
  if (!CONFIG.telegramBotToken || !CONFIG.telegramGroupChatId) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  const message = formatOrderMessage(order);

  try {
    const response = await telegramApi("sendMessage", {
      chat_id: CONFIG.telegramGroupChatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    return { sent: Boolean(response.ok), response };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

function formatOrderMessage(order) {
  const customer = order.customer;
  const telegramName = customer.telegram.username
    ? `@${customer.telegram.username}`
    : `${customer.telegram.firstName || ""} ${customer.telegram.lastName || ""}`.trim() || customer.telegram.id;

  const itemLines = order.items
    .map((item) => {
      const total = formatMoney(item.lineTotal, order.currency);
      return `- ${escapeHtml(item.quantity)} x ${escapeHtml(item.name)} (${escapeHtml(item.unit)}) - ${escapeHtml(total)}`;
    })
    .join("\n");

  return [
    `<b>Новый заказ ${escapeHtml(CONFIG.shopName)}</b>`,
    `Номер: <code>${escapeHtml(order.id)}</code>`,
    `Дата: ${escapeHtml(new Date(order.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Warsaw" }))}`,
    "",
    `<b>Клиент</b>`,
    `Имя: ${escapeHtml(customer.name)}`,
    `Телефон: ${escapeHtml(customer.phone)}`,
    `Telegram: ${escapeHtml(telegramName)} (${escapeHtml(customer.telegram.id)})`,
    `Способ: ${escapeHtml(customer.deliveryType)}`,
    customer.address ? `Адрес: ${escapeHtml(customer.address)}` : "",
    customer.comment ? `Комментарий: ${escapeHtml(customer.comment)}` : "",
    "",
    `<b>Позиции</b>`,
    itemLines,
    "",
    `<b>Итого: ${escapeHtml(formatMoney(order.total, order.currency))}</b>`
  ]
    .filter(Boolean)
    .join("\n");
}

function telegramApi(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${CONFIG.telegramBotToken}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 10000
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) reject(new Error(parsed.description || "Telegram API error"));
            else resolve(parsed);
          } catch {
            reject(new Error("Telegram API returned an unreadable response"));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Telegram API request timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function verifyTelegramAuth(payload) {
  if (!CONFIG.telegramBotToken) {
    return { ok: false, message: "TELEGRAM_BOT_TOKEN не настроен." };
  }

  if (!payload || !payload.hash || !payload.id || !payload.auth_date) {
    return { ok: false, message: "Telegram вернул неполные данные входа." };
  }

  const authAgeSeconds = Math.floor(Date.now() / 1000) - Number(payload.auth_date);
  if (!Number.isFinite(authAgeSeconds) || authAgeSeconds > 24 * 60 * 60) {
    return { ok: false, message: "Сессия Telegram устарела, попробуйте войти снова." };
  }

  const checkString = Object.keys(payload)
    .filter((key) => key !== "hash" && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(CONFIG.telegramBotToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  const actual = String(payload.hash);

  if (!safeEqualHex(expected, actual)) {
    return { ok: false, message: "Подпись Telegram не прошла проверку." };
  }

  return { ok: true };
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function createSession(user) {
  const sid = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  sessions.set(sid, { user, expiresAt });
  return sid;
}

function getSession(req) {
  const sid = getCookie(req, "sid");
  if (!sid) return null;

  const session = sessions.get(sid);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }

  return session;
}

function requireOwner(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: "auth_required", message: "Войдите через Telegram." });
    return null;
  }

  if (session.user.role !== "owner") {
    sendJson(res, 403, { error: "owner_required", message: "Нужен доступ владельца." });
    return null;
  }

  return session.user;
}

function setSessionCookie(res, sid) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getCookie(req, name) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[name] || "";
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "body_too_large", "Слишком большой запрос.");
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "bad_json", "Некорректный JSON.");
  }
}

async function readStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const raw = await fsp.readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  parsed.products = Array.isArray(parsed.products) ? parsed.products : [];
  parsed.orders = Array.isArray(parsed.orders) ? parsed.orders : [];
  return parsed;
}

function updateStore(mutator) {
  const job = storeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });

  storeQueue = job.catch(() => undefined);
  return job;
}

async function writeStore(store) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmpFile = `${STORE_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmpFile, `${JSON.stringify(store, null, 2)}\n`);
  await fsp.rename(tmpFile, STORE_FILE);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanBotUsername(username) {
  return String(username || "").trim().replace(/^@/, "");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function formatMoney(value, currency) {
  return `${roundMoney(value).toFixed(2)} ${currency}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) process.env[key] = value;
  }
}

process.on("uncaughtException", (error) => {
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});
