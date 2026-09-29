# Jottacloud-bro

## Direkte opplasting og nedlasting i CRM

CRM-en lagrer opplastede filer privat umiddelbart. Studiobroen kopierer dem videre til `Dokumenter (Cloud)/CRM opplastinger/<fil-id>/` i den synkroniserte Jottacloud-mappen. For en Jottacloud-fil som bare er indeksert, trykker Leon eller Charles «Hent til CRM». Broen legger da en privat kopi i CRM, som kan åpnes og lastes ned uten separat Jottacloud-innlogging. Tilstandene «venter», «klar» og «feilet» vises på dokumentraden. Den originale Jottacloud-filen slettes eller overskrives aldri av en import. Nye CRM-opplastinger får en unik mappe for å unngå navnekollisjoner.

Jottacloud tilbyr ikke en offentlig fil-API til dette. Broen bruker derfor Macens synkroniserte mappe og må kjøre på en påslått Mac med Jottacloud-synk. Den bruker **ikke** Jottacloud-passordet. En separat `JOTTA_FILE_BRIDGE_SECRET` gir bare tilgang til dokumentbroen i Vercel, og samme verdi lagres som `loki-jotta-file-bridge` i macOS Nøkkelring. Aldri legg verdien i Git, en plist eller logg.

Etter at hemmeligheten er konfigurert på begge steder:

```sh
node bridge/install-jottacloud-bridge.js
```

Dette kopierer broens kjørbare filer til `~/Library/Application Support/LokiCRM/bridge-runtime` og oppretter to bruker-tjenester i macOS: filkø hvert 15. minutt og indeksoppdatering hver sjette time. Den stabile kjøremappen er nødvendig fordi macOS-tjenester kan stoppe ved oppstart fra synkroniserte mapper. Kjør installasjonsskriptet på nytt etter endringer i brokoden. Manuell kontroll: `node bridge/jottacloud-file-sync.js --dry-run` og `node bridge/jottacloud-index.js --dry-run`. Maksimal filstørrelse for CRM-kopi er 500 MB; større filer beholdes i Jottacloud og kan åpnes der. Mapper med passord/innlogging og de tidligere utelatte mappene ignoreres fortsatt.

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
