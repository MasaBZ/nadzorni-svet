# Nadzorni svet – aplikacija za članico in predsednico nadzornih svetov

V aplikaciji lahko vodite več družb; vsaka ima ločene seje, sklepe, poslovanje, oceno direktorja in pretekle zapisnike. Med družbami preklapljate v glavi aplikacije, nove dodate v Nastavitvah → Družbe.

Aplikacija deluje na računalniku (Windows: Edge ali Chrome) in na iPhonu (Safari). Podatki so shranjeni na napravi, z OneDrivom pa se usklajujejo med napravami.

## Kaj je v mapi

| Datoteka | Namen |
|---|---|
| index.html, app.js | aplikacija |
| config.js | nastavitev Client ID za OneDrive |
| sw.js, manifest.webmanifest, icons/ | namestitev in delovanje brez povezave |
| vendor/ | knjižnice (prijava Microsoft, Word) |

## Enkratna nastavitev

### 1. Objava na spletnem naslovu (GitHub Pages, brezplačno)
1. Ustvarite račun na github.com.
2. Kliknite **New repository**, ime `nadzorni-svet`, izberite **Public**, nato **Create repository**.
3. Kliknite **uploading an existing file** in v okno povlecite **vso vsebino** razpakirane mape (tudi mapi `icons` in `vendor`). Kliknite **Commit changes**.
4. Odprite **Settings → Pages**. Pod *Branch* izberite `main` in `/ (root)` ter kliknite **Save**.
5. Čez minuto ali dve je aplikacija na naslovu `https://VAŠE-UPORABNIŠKO-IME.github.io/nadzorni-svet/`.

Javna je samo prazna aplikacija. Vaši podatki niso na GitHubu.

### 2. Registracija aplikacije pri Microsoftu (za OneDrive)
Aplikacija uporablja službeni račun **masa@op-bertok.si** (Microsoft 365 imenik op-bertok.si).
1. S službenim računom se prijavite na entra.microsoft.com (ali portal.azure.com) in odprite **Identity → Applications → App registrations → New registration**.
2. Ime: `Nadzorni svet`. Vrsta računov: **Accounts in this organizational directory only (op-bertok.si only – Single tenant)**.
3. Redirect URI: izberite **Single-page application (SPA)** in vpišite naslov iz koraka 1, npr. `https://VAŠE-UPORABNIŠKO-IME.github.io/nadzorni-svet/` (s poševnico na koncu).
4. Kliknite **Register** in skopirajte **Application (client) ID**.
5. V aplikaciji odprite **Nastavitve → OneDrive → Napredno: Client ID**, ga prilepite in shranite. Nato kliknite **Prijava z Microsoftovim računom** in se prijavite z masa@op-bertok.si. Ob prvi prijavi potrdite dovoljenje za dostop do mape aplikacije v OneDrivu.

Podatki se shranjujejo v vaš službeni OneDrive, v mapo **Aplikacije → Nadzorni svet** (v angleškem vmesniku *Apps → Nadzorni svet*).

### 3. Claude (neobvezno)
Brez ključa: aplikacija pripravi navodilo, ki ga prilepite v svojo aplikacijo Claude, odgovor pa prilepite nazaj (gumb **Kopiraj navodilo**).
Z API ključem (console.anthropic.com, plačilo po porabi) Claude piše neposredno v aplikaciji: **Nastavitve → Claude**.

### 4. Namestitev
- **Windows:** odprite naslov v Edgeu ali Chromu in kliknite **Namesti aplikacijo** (zgoraj desno v aplikaciji ali ikona v naslovni vrstici).
- **iPhone:** odprite naslov v Safariju, tapnite **Deli → Dodaj na začetni zaslon**. Aplikacijo odpirajte vedno z ikone.

### 5. Prenos podatkov iz različice v Claudu
V aplikaciji v Claudu: **Nastavitve → Izvozi vse podatke**. V novi aplikaciji: **Nastavitve → Varnostna kopija → Uvozi podatke**. Uvoz samodejno ustvari družbo z nazivom iz izvoza.

## Potek seje
1. **Seje → Nova seja**: dnevni red, vabilo (Word).
2. Na seji: **Začni snemanje** (telefon na mizi, zaslon odklenjen, aplikacija v ospredju). Po koncu **Ustavi in shrani**; posnetek se naloži v OneDrive (Aplikacije → Nadzorni svet → Posnetki).
3. Prepis: v Wordu za splet **Narekuj → Prepis → Naloži zvok**, prepis shranite kot .docx in ga naložite v korak 4.
4. **Pripravi osnutek zapisnika**, preglejte mesta [PREVERI], prenesite Word.
5. **Izlušči sklepe** in jih dodajte v evidenco.

## Posodobitve
Novo različico naložite v isti GitHub repozitorij (zamenjate datoteke). Aplikacija jo prevzame ob naslednjem odprtju.
