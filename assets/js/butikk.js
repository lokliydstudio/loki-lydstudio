/*
  Loki Lydstudio nettbutikk
  1. Oppdater priser her hvis prisene skal vises annerledes på nettsiden.
  2. Oppdater Stripe Price IDs i api/create-checkout-session.js før betaling aktiveres.
*/

const PRODUCTS = {
  'mixing-hour': {
    name: 'Miksing',
    unit: 'time',
    priceNok: 550,
    min: 1,
    max: 100
  },
  'mastering-song': {
    name: 'Mastring',
    unit: 'låt',
    priceNok: 750,
    min: 1,
    max: 50
  },
  'recording-hour': {
    name: 'Innspilling',
    unit: 'time',
    priceNok: 550,
    min: 1,
    max: 100
  },
  'production-hour': {
    name: 'Produksjon',
    unit: 'time',
    priceNok: 650,
    min: 1,
    max: 100
  }
};

const CART_STORAGE_KEY = 'loki_cart_v1';

const cartItemsEl = document.getElementById('cartItems');
const cartEmptyEl = document.getElementById('cartEmpty');
const cartTotalEl = document.getElementById('cartTotal');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutButton = document.getElementById('checkoutButton');
const checkoutStatus = document.getElementById('checkoutStatus');
const clearCartButton = document.getElementById('clearCartButton');

let cart = loadCart();

function formatNok(amount) {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0
  }).format(amount);
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function clampQuantity(productId, quantity) {
  const product = PRODUCTS[productId];
  const parsed = Number.parseInt(quantity, 10);
  if (!product || Number.isNaN(parsed)) return 1;
  return Math.min(Math.max(parsed, product.min), product.max);
}

function addToCart(productId, quantity) {
  const product = PRODUCTS[productId];
  if (!product) return;

  const safeQuantity = clampQuantity(productId, quantity);
  cart[productId] = clampQuantity(productId, (cart[productId] || 0) + safeQuantity);
  saveCart();
  renderCart();
}

function updateCartQuantity(productId, quantity) {
  const product = PRODUCTS[productId];
  if (!product) return;

  cart[productId] = clampQuantity(productId, quantity);
  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  delete cart[productId];
  saveCart();
  renderCart();
}

function clearCart() {
  cart = {};
  saveCart();
  renderCart();
}

function getCartLines() {
  return Object.entries(cart)
    .filter(([productId, quantity]) => PRODUCTS[productId] && quantity > 0)
    .map(([productId, quantity]) => ({
      id: productId,
      ...PRODUCTS[productId],
      quantity
    }));
}

function renderCart() {
  const lines = getCartLines();
  cartItemsEl.innerHTML = '';
  cartEmptyEl.style.display = lines.length ? 'none' : 'block';
  checkoutButton.disabled = lines.length === 0;

  let total = 0;

  lines.forEach((line) => {
    const lineTotal = line.priceNok * line.quantity;
    total += lineTotal;

    const item = document.createElement('div');
    item.className = 'cart-item';
    item.innerHTML = `
      <div class="cart-item-title">
        <span>${line.name}</span>
        <span>${formatNok(lineTotal)}</span>
      </div>
      <div class="product-unit">${formatNok(line.priceNok)} per ${line.unit}</div>
      <div class="cart-item-controls">
        <input type="number" min="${line.min}" max="${line.max}" value="${line.quantity}" aria-label="Antall ${line.name}">
        <button type="button" class="remove-button">Fjern</button>
      </div>
    `;

    item.querySelector('input').addEventListener('change', (event) => {
      updateCartQuantity(line.id, event.target.value);
    });

    item.querySelector('.remove-button').addEventListener('click', () => {
      removeFromCart(line.id);
    });

    cartItemsEl.appendChild(item);
  });

  cartTotalEl.textContent = formatNok(total);
}

function renderProductPrices() {
  Object.entries(PRODUCTS).forEach(([productId, product]) => {
    const priceEl = document.querySelector(`[data-price="${productId}"]`);
    if (priceEl) priceEl.textContent = formatNok(product.priceNok);
  });
}

document.querySelectorAll('[data-add-to-cart]').forEach((button) => {
  button.addEventListener('click', () => {
    const productId = button.dataset.addToCart;
    const qtyInput = document.getElementById(`qty-${productId}`);
    addToCart(productId, qtyInput ? qtyInput.value : 1);
  });
});

clearCartButton.addEventListener('click', clearCart);

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const lines = getCartLines();
  if (!lines.length) {
    checkoutStatus.textContent = 'Handlevognen er tom.';
    return;
  }

  checkoutButton.disabled = true;
  checkoutStatus.textContent = 'Sender deg videre til betaling...';

  const payload = {
    items: lines.map(({ id, quantity }) => ({ id, quantity })),
    customer: {
      name: document.getElementById('customerName').value,
      email: document.getElementById('customerEmail').value,
      notes: document.getElementById('projectNotes').value
    }
  };

  try {
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Kunne ikke starte betaling.');
    }

    window.location.href = data.url;
  } catch (error) {
    checkoutStatus.textContent = `${error.message} Sjekk at Stripe API er satt opp, eller kontakt oss direkte.`;
    checkoutButton.disabled = false;
  }
});

renderProductPrices();
renderCart();
