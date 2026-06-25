const state = {
  config: null,
  user: null,
  products: [],
  orders: [],
  imageObjectUrl: ""
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindElements();
  bindEvents();

  const config = await api("/api/config");
  state.config = config;
  state.user = config.user;

  document.title = `Кабинет ${state.config.shopName}`;
  renderAuth();
  await refreshAdminData();
}

function bindElements() {
  els.logoutButton = document.querySelector("#logoutButton");
  els.authBox = document.querySelector("#authBox");
  els.loginPanel = document.querySelector("#loginPanel");
  els.adminPanel = document.querySelector("#adminPanel");
  els.adminUser = document.querySelector("#adminUser");
  els.productForm = document.querySelector("#productForm");
  els.productId = document.querySelector("#productId");
  els.formTitle = document.querySelector("#formTitle");
  els.resetForm = document.querySelector("#resetForm");
  els.productCounter = document.querySelector("#productCounter");
  els.adminProducts = document.querySelector("#adminProducts");
  els.ordersList = document.querySelector("#ordersList");
  els.image = document.querySelector("#image");
  els.imagePreset = document.querySelector("#imagePreset");
  els.imageFile = document.querySelector("#imageFile");
  els.imagePreview = document.querySelector("#imagePreview");
  els.toast = document.querySelector("#toast");
}

function bindEvents() {
  els.logoutButton.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    renderAuth();
    toast("Вы вышли из аккаунта.");
  });

  els.productForm.addEventListener("submit", saveProduct);
  els.resetForm.addEventListener("click", resetProductForm);
  els.imagePreset.addEventListener("change", () => {
    if (!els.imagePreset.value) return;

    els.imageFile.value = "";
    setProductImage(els.imagePreset.value);
  });
  els.imageFile.addEventListener("change", previewSelectedImage);
}

async function refreshAdminData() {
  const products = await api("/api/products");
  state.products = products.products;
  renderProducts();

  if (state.user && state.user.role === "owner") {
    try {
      const orders = await api("/api/orders?limit=20");
      state.orders = orders.orders;
    } catch {
      state.orders = [];
    }
  }
  renderOrders();
}

function renderAuth() {
  const isOwner = state.user && state.user.role === "owner";
  els.logoutButton.classList.toggle("hidden", !state.user);
  els.loginPanel.classList.toggle("hidden", isOwner);
  els.adminPanel.classList.toggle("hidden", !isOwner);

  if (isOwner) {
    const username = state.user.username ? `@${state.user.username}` : state.user.firstName;
    els.adminUser.textContent = username || "Владелец";
    return;
  }

  els.adminUser.textContent = "";
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
      <strong>${state.config.telegramLoginReady ? "Вход владельца" : "Нужна настройка бота"}</strong>
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
      renderAuth();
      await refreshAdminData();
      toast("Вход выполнен.");
    });
  }
}

function renderProducts() {
  els.productCounter.textContent = String(state.products.length);

  if (!state.products.length) {
    els.adminProducts.innerHTML = `<div class="empty-state compact">Каталог пустой.</div>`;
    return;
  }

  els.adminProducts.innerHTML = state.products
    .map((product) => {
      return `
        <article class="admin-product">
          <img src="${escapeAttr(product.image)}" alt="">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(product.category)} · ${escapeHtml(product.unit)} · ${formatMoney(product.price)}</span>
            <em>${product.available ? "на сайте" : "скрыто"}</em>
          </div>
          <div class="admin-actions">
            <button type="button" data-action="edit" data-id="${escapeAttr(product.id)}" title="Редактировать" aria-label="Редактировать">...</button>
            <button type="button" data-action="delete" data-id="${escapeAttr(product.id)}" title="Удалить" aria-label="Удалить">x</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.adminProducts.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const product = state.products.find((item) => item.id === button.dataset.id);
      if (!product) return;

      if (button.dataset.action === "edit") {
        editProduct(product);
        return;
      }

      await deleteProduct(product);
    });
  });
}

function renderOrders() {
  if (!state.user || state.user.role !== "owner") {
    els.ordersList.innerHTML = "";
    return;
  }

  if (!state.orders.length) {
    els.ordersList.innerHTML = `<div class="empty-state compact">Заказов пока нет.</div>`;
    return;
  }

  els.ordersList.innerHTML = state.orders
    .map((order) => {
      const items = order.items.map((item) => `${item.quantity} x ${item.name}`).join(", ");
      return `
        <article class="order-row">
          <div>
            <strong>${escapeHtml(order.customer.name)}</strong>
            <span>${escapeHtml(items)}</span>
          </div>
          <div>
            <strong>${formatMoney(order.total)}</strong>
            <span>${escapeHtml(new Date(order.createdAt).toLocaleString("ru-RU"))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

async function saveProduct(event) {
  event.preventDefault();

  if (!state.user || state.user.role !== "owner") {
    toast("Нужен доступ владельца.");
    return;
  }

  const id = els.productId.value;
  const url = id ? `/api/products/${encodeURIComponent(id)}` : "/api/products";
  const method = id ? "PATCH" : "POST";
  const saveButton = els.productForm.querySelector('button[type="submit"]');
  const originalButtonText = saveButton.textContent;

  try {
    saveButton.disabled = true;

    let imageUrl = els.image.value || "/assets/product-crunch-mix.png";
    if (els.imageFile.files && els.imageFile.files[0]) {
      saveButton.textContent = "Загружаем фото...";
      const upload = await uploadImage(els.imageFile.files[0]);
      imageUrl = upload.imageUrl;
      setProductImage(imageUrl);
    }

    const payload = {
      name: document.querySelector("#name").value,
      price: Number(document.querySelector("#price").value),
      category: document.querySelector("#category").value,
      unit: document.querySelector("#unit").value,
      image: imageUrl,
      description: document.querySelector("#description").value,
      available: document.querySelector("#available").checked
    };

    saveButton.textContent = "Сохраняем...";
    await api(url, { method, body: payload });
    resetProductForm();
    await refreshAdminData();
    toast("Позиция сохранена.");
  } catch (error) {
    toast(error.message || "Не удалось сохранить позицию.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalButtonText;
  }
}

function editProduct(product) {
  els.productId.value = product.id;
  els.formTitle.textContent = "Редактировать";
  document.querySelector("#name").value = product.name;
  document.querySelector("#price").value = product.price;
  document.querySelector("#category").value = product.category;
  document.querySelector("#unit").value = product.unit;
  setProductImage(product.image);
  setPresetForImage(product.image);
  els.imageFile.value = "";
  document.querySelector("#description").value = product.description;
  document.querySelector("#available").checked = product.available;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProduct(product) {
  const confirmed = window.confirm(`Удалить "${product.name}"?`);
  if (!confirmed) return;

  try {
    await api(`/api/products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
    await refreshAdminData();
    toast("Позиция удалена.");
  } catch (error) {
    toast(error.message || "Не удалось удалить позицию.");
  }
}

function resetProductForm() {
  els.productForm.reset();
  els.productId.value = "";
  els.formTitle.textContent = "Новая позиция";
  document.querySelector("#category").value = "Снеки";
  document.querySelector("#unit").value = "100 г";
  document.querySelector("#available").checked = true;
  els.imageFile.value = "";
  setProductImage("/assets/product-crunch-mix.png");
  setPresetForImage("/assets/product-crunch-mix.png");
}

function previewSelectedImage() {
  const file = els.imageFile.files && els.imageFile.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    els.imageFile.value = "";
    toast("Выберите файл изображения.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    els.imageFile.value = "";
    toast("Фото должно быть не больше 5 МБ.");
    return;
  }

  if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
  state.imageObjectUrl = URL.createObjectURL(file);
  els.imagePreview.src = state.imageObjectUrl;
  els.imagePreset.value = "";
}

function setProductImage(imageUrl) {
  els.image.value = imageUrl;
  els.imagePreview.src = imageUrl;

  if (state.imageObjectUrl) {
    URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = "";
  }
}

function setPresetForImage(imageUrl) {
  const hasPreset = [...els.imagePreset.options].some((option) => option.value === imageUrl);
  els.imagePreset.value = hasPreset ? imageUrl : "";
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: formData
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Не удалось загрузить фото.");
  return payload;
}

function mountTelegramWidget(selector) {
  window.onTelegramAuth = async (telegramUser) => {
    try {
      const response = await api("/api/auth/telegram", { method: "POST", body: telegramUser });
      state.user = response.user;
      renderAuth();
      await refreshAdminData();
      if (state.user.role !== "owner") toast("Этот Telegram не добавлен как владелец.");
      else toast("Вход выполнен.");
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
