# Jottacloud-bro

Broen leser bare filmetadata fra Jottacloud-mappen på studio-Macen. Den laster ikke opp dokumentinnhold, endrer ikke filer og hopper alltid over `Mikser (Cloud)`, `Prosjekter (Cloud)` og mapper med passord eller innlogginger.

Test uten å sende data:

```sh
node bridge/jottacloud-index.js --dry-run
```

Ved produksjonskjøring settes `JOTTA_BRIDGE_SECRET` i prosessmiljøet. Den samme hemmeligheten lagres kryptert i Vercel. Jottacloud-passordet skal ikke inn i Vercel eller kildekoden.
