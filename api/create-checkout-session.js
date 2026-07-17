// Vercel/Node serverless function for Stripe Checkout.
// Installer: npm install stripe
// Miljøvariabel på serveren/Vercel: STRIPE_SECRET_KEY=sk_test_... eller sk_live_...

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Price IDs fra Stripe Dashboard.
// SECRET_KEY skal ikke ligge i HTML eller frontend. Legg den som miljøvariabel i Vercel.
const PRODUCTS = {
  'mixing-hour': {
    name: 'Miksing',
    unit: 'time',
    priceId: 'price_1TuCD620c7bh8VknKkVWHrAW',
    min: 1,
    max: 100
  },
  'mastering-song': {
    name: 'Mastring',
    unit: 'låt',
    priceId: 'price_1ThPxg20c7bh8VknaKgLCj4L',
    min: 1,
    max: 50
  },
  'recording-hour': {
    name: 'Innspilling',
    unit: 'time',
    priceId: 'price_1TuCBd20c7bh8VknC5ZkRHj4',
    min: 1,
    max: 100
  },
  'production-hour': {
    name: 'Produksjon',
    unit: 'time',
    priceId: 'price_1TuCCd20c7bh8Vkn0AJ9oulw',
    min: 1,
    max: 100
  }
};

function clampQuantity(product, quantity) {
  const parsed = Number.parseInt(quantity, 10);
  if (Number.isNaN(parsed)) return product.min;
  return Math.min(Math.max(parsed, product.min), product.max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY mangler på serveren.' });
  }

  try {
    const { items = [], customer = {} } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Handlevognen er tom.' });
    }

    const lineItems = items.map((item) => {
      const product = PRODUCTS[item.id];

      if (!product) {
        throw new Error(`Ukjent produkt: ${item.id}`);
      }

      if (!product.priceId || product.priceId.startsWith('price_BYTT_UT')) {
        throw new Error(`Mangler Stripe Price ID for ${product.name}.`);
      }

      const quantity = clampQuantity(product, item.quantity);

      return {
        price: product.priceId,
        quantity,
        adjustable_quantity: {
          enabled: true,
          minimum: product.min,
          maximum: product.max
        }
      };
    });

    const origin = req.headers.origin || 'https://lokilydstudio.no';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: customer.email || undefined,
      success_url: `${origin}/takk.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/nettbutikk.html`,
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      metadata: {
        customer_name: String(customer.name || '').slice(0, 200),
        project_notes: String(customer.notes || '').slice(0, 500)
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Kunne ikke opprette betaling.' });
  }
};
