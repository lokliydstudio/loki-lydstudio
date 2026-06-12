# Loki Lydstudio – nettbutikk

Dette oppsettet gir en enkel nettbutikk for tjenester:

- Miksing per time
- Mastring per låt
- Innspilling per time
- Produksjon per time

Kundene kan legge flere tjenester i handlevogn, endre antall og gå til betaling via Stripe Checkout.

## Filer

- `nettbutikk.html` – butikksiden kundene besøker
- `assets/js/butikk.js` – produktliste, priser og handlevogn i nettleseren
- `api/create-checkout-session.js` – sikker serverless backend som lager Stripe Checkout-betaling
- `takk.html` – siden kunden sendes til etter vellykket betaling
- `index.html` – forsiden, oppdatert med lenke til nettbutikk
- `package.json` – avhengigheter for Vercel/Node

## Viktig før betaling fungerer

Du må opprette produktene/prisene i Stripe Dashboard og bytte ut `price_BYTT_UT_...` i:

`api/create-checkout-session.js`

Eksempel:

```js
priceId: 'price_123456789'
```

Du må også sette miljøvariabel på serveren:

```bash
STRIPE_SECRET_KEY=sk_live_...
```

Ikke legg `STRIPE_SECRET_KEY` i HTML eller frontend-JavaScript.

## Anbefalt publisering

Dette oppsettet er laget for Vercel, fordi mappen `api/` fungerer som serverless backend der.

1. Last opp prosjektet til GitHub.
2. Koble repoet til Vercel.
3. Legg inn `STRIPE_SECRET_KEY` under Environment Variables i Vercel.
4. Opprett produkter i Stripe og lim inn ekte Price IDs i `api/create-checkout-session.js`.
5. Test med Stripe testnøkler først.
6. Bytt til live-nøkler når alt er klart.

## Endre prisene som vises på nettsiden

Prisene som vises ligger i:

`assets/js/butikk.js`

Eksempel:

```js
priceNok: 950
```

Husk at prisen i Stripe Dashboard må matche prisen du viser på nettsiden.

## Vipps

Vipps kan legges til senere, men krever egen API-integrasjon eller en nettbutikkplattform/plugin. For denne versjonen er Stripe Checkout valgt fordi det er enklest å koble trygt til en statisk nettside med liten serverless backend.
