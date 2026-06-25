const fs = require("fs/promises");
const path = require("path");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const STORE_FILE = path.join(__dirname, "..", "data", "store.json");
let cookie = "";
let createdProductId = "";
let createdOrderId = "";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  try {
    await expectStatus("/api/health", 200);

    const config = await request("/api/config");
    assert(config.status === 200, "config should be available");
    assert(config.json.shopName === "Sneckin", "shop name should be Sneckin");
    assert(config.json.devAuthAvailable === true, "dev auth should be enabled for smoke test");

    const home = await request("/");
    assert(home.status === 200 && home.text.includes("Sneckin"), "home page should render");

    const admin = await request("/admin");
    assert(admin.status === 200 && admin.text.includes("Кабинет Sneckin"), "admin page should render");

    const products = await request("/api/products");
    assert(products.status === 200, "products should load");
    assert(products.json.products.length >= 4, "seed products should exist");

    const unauthOrder = await request("/api/orders", {
      method: "POST",
      body: { items: [{ productId: products.json.products[0].id, quantity: 1 }] }
    });
    assert(unauthOrder.status === 401, "order should require auth");

    const login = await request("/api/auth/dev", {
      method: "POST",
      body: { code: "test-owner" }
    });
    assert(login.status === 200, "dev owner login should work");
    assert(login.json.user.role === "owner", "dev user should be owner");

    const created = await request("/api/products", {
      method: "POST",
      body: {
        name: "Smoke Test Snack",
        description: "Temporary smoke-test product",
        category: "Тест",
        unit: "1 шт",
        price: 1.23,
        image: "/assets/product-crunch-mix.png",
        available: true
      }
    });
    assert(created.status === 201, "owner should create product");
    createdProductId = created.json.product.id;

    const deleted = await request(`/api/products/${encodeURIComponent(createdProductId)}`, {
      method: "DELETE"
    });
    assert(deleted.status === 200, "owner should delete product");
    createdProductId = "";

    const order = await request("/api/orders", {
      method: "POST",
      body: {
        customerName: "Smoke Test",
        customerPhone: "+48 000 000 000",
        deliveryType: "Самовывоз",
        address: "",
        comment: "temporary smoke test",
        items: [{ productId: products.json.products[0].id, quantity: 2 }]
      }
    });
    assert(order.status === 201, "authenticated order should be created");
    assert(order.json.order.total > 0, "order should have server-calculated total");
    createdOrderId = order.json.order.id;

    console.log("Smoke test passed");
  } finally {
    await cleanup();
  }
}

async function expectStatus(pathname, status) {
  const response = await request(pathname);
  assert(response.status === status, `${pathname} should return ${status}`);
}

async function request(pathname, options = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (options.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: response.status, text, json };
}

async function cleanup() {
  if (createdProductId && cookie) {
    try {
      await request(`/api/products/${encodeURIComponent(createdProductId)}`, { method: "DELETE" });
    } catch {
      // Best-effort cleanup for smoke-test data.
    }
  }

  if (createdOrderId) {
    const store = JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
    store.orders = store.orders.filter((order) => order.id !== createdOrderId);
    await fs.writeFile(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
