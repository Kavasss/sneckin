const state = {
  config: null,
  user: null,
  products: [],
  cart: loadCart(),
  category: "all"
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  bindEvents();

  const [config, products] = await Promise.all([
    api("/api/config"),
    api("/api/products")
  ]);

  state.config = config;
  state.user = config.user;
  state.products = products.products;

  document.title = state.config.shopName;
  els.phoneLink.href = `tel:${state.config.phone.replace(/\s/g, "")}`;
  els.phoneLink.textContent = state.config.phone;

  renderAuthBox();
  renderCategories();
  renderProducts();
  renderCart();
}

function bindElements() {
  els.phoneLink = document.querySelector("#phoneLink");
  els.logoutButton = document.querySelector("#logoutButton");
  els.categoryFilters = document.querySelector("#categoryFilters");
  els.productGrid = document.querySelector("#productGrid");
  els.cartItems = document.querySelector("#cartItems");
  els.cartCount = document.querySelector("#cartCount");
  els.cartTotal = document.querySelector("#cartTotal");
  els.authBox = document.querySelector("#authBox");
  els.orderForm = document.querySelector("#orderForm");
  els.toast = document.querySelector("#toast");
}

function bindEvents() {
  els.logoutButton.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    renderAuthBox();
    toast("Вы вышли из аккаунта.");
  });

  els.orderForm.addEventListener("submit", submitOrder);
}

function renderCategories() {
  const categories = ["all", ...new Set(state.products.map((product) => product.category).filter(Boolean))];
  els.categoryFilters.innerHTML = categories
    .map((category) => {
      const label = category === "all" ? "Все" : category;
      const active = state.category === category ? "active" : "";
      return `<button class="${active}" type="button" data-category="${escapeAttr(category)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  els.categoryFilters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const products = state.products.filter((product) => {
    return product.available && (state.category === "all" || product.category === state.category);
  });

  if (products.length === 0) {
    els.productGrid.innerHTML = `<div class="empty-state">Пока нет позиций в этой категории.</div>`;
    return;
  }

  els.productGrid.innerHTML = products
    .map((product) => {
      return `
        <article class="product-card">
          <div class="product-media">
            <img src="${escapeAttr(product.image)}" alt="${escapeAttr(product.name)}">
          </div>
          <div class="product-info">
            <div>
              <span class="tag">${escapeHtml(product.category)}</span>
              <h3>${escapeHtml(product.name)}</h3>
              <p>${escapeHtml(product.description)}</p>
            </div>
            <div class="product-foot">
              <div>
                <strong>${formatMoney(product.price)}</strong>
                <span>${escapeHtml(product.unit)}</span>
              </div>
              <button class="add-button" type="button" data-id="${escapeAttr(product.id)}" title="Добавить" aria-label="Добавить ${escapeAttr(product.name)}">+</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  els.productGrid.querySelectorAll(".add-button").forEach((button) => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.id);
    });
  });
}

function renderCart() {
  const lines = getCartLines();
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  els.cartCount.textContent = String(totalQuantity);
  els.cartTotal.textContent = formatMoney(total);

  if (lines.length === 0) {
    els.cartItems.innerHTML = `<div class="empty-state compact">Корзина пустая.</div>`;
    return;
  }

  els.cartItems.innerHTML = lines
    .map((line) => {
      const product = line.product;
      return `
        <div class="cart-line">
          <img src="${escapeAttr(product.image)}" alt="">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${formatMoney(product.price)} / ${escapeHtml(product.unit)}</span>
          </div>
          <div class="quantity-controls" aria-label="Количество ${escapeAttr(product.name)}">
            <button type="button" data-action="decrease" data-id="${escapeAttr(product.id)}" aria-label="Уменьшить">-</button>
            <span>${line.quantity}</span>
            <button type="button" data-action="increase" data-id="${escapeAttr(product.id)}" aria-label="Увеличить">+</button>
          </div>
        </div>
      `;
    })
    .join("");

  els.cartItems.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const delta = button.dataset.action === "increase" ? 1 : -1;
      changeQuantity(button.dataset.id, delta);
    });
  });
}

function renderAuthBox() {
  els.logoutButton.classList.toggle("hidden", !state.user);

  if (state.user) {
    const username = state.user.username ? `@${state.user.username}` : state.user.firstName;
    els.authBox.innerHTML = `
      <div class="auth-status">
        <span>Telegram</span>
        <strong>${escapeHtml(username || "Аккаунт")}</strong>
      </div>
    `;
    return;
  }

  const devBlock = state.config.devAuthAvailable
    ? `
      <form id="devLoginForm" class="dev-login">
        <input id="devCode" type="password" placeholder="Код владельца">
        <button type="submit">Войти</button>
      </form>
    `
    : "";

  els.authBox.innerHTML = `
    <div class="auth-status muted">
      <span>Telegram</span>
      <strong>${state.config.telegramLoginReady ? "Войдите перед заказом" : "Нужна настройка бота"}</strong>
    </div>
    <div id="telegramWidget"></div>
    ${devBlock}
  `;

  if (state.config.telegramLoginReady) mountTelegramWidget("#telegramWidget");

  const devLoginForm = document.querySelector("#devLoginForm");
  if (devLoginForm) {
    devLoginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.querySelector("#devCode").value;
      const response = await api("/api/auth/dev", { method: "POST", body: { code } });
      state.user = response.user;
      renderAuthBox();
      toast("Вход выполнен.");
    });
  }
}

async function submitOrder(event) {
  event.preventDefault();

  const lines = getCartLines();
  if (lines.length === 0) {
    toast("Добавьте снеки в корзину.");
    return;
  }

  if (!state.user) {
    toast("Войдите через Telegram перед заказом.");
    renderAuthBox();
    return;
  }

  const payload = {
    customerName: document.querySelector("#customerName").value,
    customerPhone: document.querySelector("#customerPhone").value,
    deliveryType: document.querySelector("#deliveryType").value,
    address: document.querySelector("#address").value,
    comment: document.querySelector("#comment").value,
    items: lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity
    }))
  };

  const submitButton = document.querySelector("#submitOrder");
  submitButton.disabled = true;
  submitButton.textContent = "Отправляем...";

  try {
    const response = await api("/api/orders", { method: "POST", body: payload });
    state.cart = {};
    saveCart();
    renderCart();
    els.orderForm.reset();
    document.querySelector("#customerPhone").value = "+48 ";

    if (response.telegram.sent) {
      toast("Заказ отправлен в Telegram.");
    } else {
      toast("Заказ сохранен. Telegram-группа еще не настроена.");
    }
  } catch (error) {
    toast(error.message || "Не удалось оформить заказ.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Оформить заказ";
  }
}

function addToCart(productId) {
  state.cart[productId] = (state.cart[productId] || 0) + 1;
  saveCart();
  renderCart();
  toast("Добавлено в корзину.");
}

function changeQuantity(productId, delta) {
  const nextQuantity = (state.cart[productId] || 0) + delta;
  if (nextQuantity <= 0) delete state.cart[productId];
  else state.cart[productId] = nextQuantity;
  saveCart();
  renderCart();
}

function getCartLines() {
  return Object.entries(state.cart)
    .map(([productId, quantity]) => {
      const product = state.products.find((item) => item.id === productId && item.available);
      if (!product) return null;
      return { product, quantity };
    })
    .filter(Boolean);
}

function mountTelegramWidget(selector) {
  window.onTelegramAuth = async (telegramUser) => {
    try {
      const response = await api("/api/auth/telegram", { method: "POST", body: telegramUser });
      state.user = response.user;
      renderAuthBox();
      toast("Вход выполнен.");
    } catch (error) {
      toast(error.message || "Telegram вход не выполнен.");
    }
  };

  const mount = document.querySelector(selector);
  mount.innerHTML = "";
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://telegram.org/js/telegram-widget.js?22";
  script.setAttribute("data-telegram-login", state.config.telegramBotUsername);
  script.setAttribute("data-size", "large");
  script.setAttribute("data-userpic", "false");
  script.setAttribute("data-radius", "8");
  script.setAttribute("data-request-access", "write");
  script.setAttribute("data-onauth", "onTelegramAuth(user)");
  mount.appendChild(script);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Ошибка запроса.");
  return payload;
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("sneckin_cart") || "{}");
  } catch {
    return {};
  }
}

function saveCart() {
  localStorage.setItem("sneckin_cart", JSON.stringify(state.cart));
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} ${state.config ? state.config.currency : "PLN"}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add("hidden"), 3400);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
