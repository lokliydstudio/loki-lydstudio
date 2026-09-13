# Jottacloud-bro

Dokumentindeksen leser bare filmetadata fra Jottacloud-mappen på studio-Macen. Den laster ikke opp dokumentinnhold, endrer ikke filer og hopper alltid over `Mikser (Cloud)`, `Prosjekter (Cloud)`, `CRM lydfiler` og mapper med passord eller innlogginger.

Alle indekserte rader får en privat dyplenke til den samme filen i Jottacloud. Lenken krever en innlogget Jottacloud-konto med tilgang til `Loki Lydstudio/Dokumenter (Cloud)` og gjør ikke filen offentlig. Leon eller Charles kan i tillegg bruke «Koble kopi» på en rad, eller «Last opp filer», for å lagre en privat kopi i Vercel Blob. En ny indekskjøring beholder allerede koblede private filer.

Test uten å sende data:

```sh
node bridge/jottacloud-index.js --dry-run
```

Ved produksjonskjøring settes `JOTTA_BRIDGE_SECRET` i prosessmiljøet. Den samme hemmeligheten lagres kryptert i Vercel. Jottacloud-passordet skal ikke inn i Vercel eller kildekoden.

## Lydarkiv

Lydspilleren strømmer fra den private Vercel-lagringen. Den separate lydsynken kopierer nye CRM-opplastinger til `Dokumenter (Cloud)/CRM lydfiler/<prosjekt>` slik at Jottacloud blir arkivet:

```sh
node bridge/jottacloud-audio-sync.js --dry-run
node bridge/jottacloud-audio-sync.js
```

Sett `JOTTA_AUDIO_ROOT` dersom arkivmappen skal ligge et annet sted. Skriptet trenger bare `JOTTA_BRIDGE_SECRET`; Jottacloud-passordet brukes fortsatt ikke av plattformen.
