# kinoverse para LG webOS

[English below](#english)

Esta es la app de kinoverse (Kino) para los televisores LG con webOS. El televisor muestra lo que tienes en tu celular: los
mismos perfiles, los mismos plugins y tu Continuar viendo. El celular hace el trabajo y el TV solo lo muestra.

La app es un "cascarón": cada vez que la abres, carga la versión más nueva desde `kinoverse.app`. Así **no tienes que
reinstalarla para recibir mejoras**. Si un día no hay internet, usa la copia que trae adentro.

**Descarga el IPK:** [Releases ▸ la última](https://github.com/kinotvapp/kinoverse-webos/releases/latest)
(`com.kinotvapp.kino_<versión>_all.ipk`).

---

## Instálala en tu LG con el Developer Mode

LG solo deja instalar apps de fuera de su tienda con su modo desarrollador. Es gratis y oficial, y se configura una sola vez.

Necesitas:

- el TV LG y el computador **en la misma red** (el mismo wifi, o cable al mismo router);
- una cuenta de LG (sirve la misma de la LG Content Store);
- un computador con Windows, Mac o Linux.

### Paso 1. Activa el Developer Mode en el TV

1. Si no tienes cuenta, créala en <https://webostv.developer.lge.com> (arriba a la derecha: **Sign In ▸ Create Account**).
2. En el TV, abre la **LG Content Store**, busca **Developer Mode** e instálala.
3. Abre **Developer Mode** e inicia sesión con tu cuenta de LG.
4. Activa **Dev Mode Status**. El TV te pide reiniciar: acepta.
5. Cuando vuelva a encender, abre otra vez **Developer Mode** y activa **Key Server**.
6. Deja esa pantalla abierta. Ahí ves dos datos que vas a usar:
   - la **IP** del TV (por ejemplo, `192.168.1.50`);
   - la **Passphrase**, seis letras y números (por ejemplo, `A1B2C3`).

### Paso 2. Prepara el computador

1. Instala **Node.js** (la versión LTS) desde <https://nodejs.org>.
2. Abre una terminal (en Windows, **PowerShell**) e instala las herramientas de LG:

   ```bash
   npm install -g @webos-tools/cli
   ```

3. Revisa que quedaron instaladas:

   ```bash
   ares --version
   ```

### Paso 3. Conecta el computador con el TV

Cambia `192.168.1.50` por la IP que ves en el Developer Mode del TV:

```bash
ares-setup-device -a lg -i "host=192.168.1.50" -i "port=9922" -i "username=prisoner"
```

Ahora pide la llave del TV. El comando te pregunta la **Passphrase**: escríbela tal como aparece en el TV, con las mismas
mayúsculas:

```bash
ares-novacom --device lg --getkey
```

Prueba la conexión. Debe responder con los datos del TV, sin error:

```bash
ares-device -i -d lg
```

### Paso 4. Instala la app

1. Descarga el IPK de [Releases](https://github.com/kinotvapp/kinoverse-webos/releases/latest).
2. En la terminal, ve a la carpeta donde quedó (por ejemplo, `cd Downloads`) e instálalo:

   ```bash
   ares-install --device lg com.kinotvapp.kino_0.2.1_all.ipk
   ```

3. Ábrela desde el computador, o búscala en el TV con el nombre **kinoverse**:

   ```bash
   ares-launch --device lg com.kinotvapp.kino
   ```

### Paso 5. Emparéjala con tu celular

1. En el celular, abre Kino ▸ **⋮** ▸ **Enviar a la TV**. Aparece un código de cinco números.
2. En el TV, escribe ese código y confirma.
3. Elige tu perfil, y listo.

El celular tiene que estar en la misma red que el TV, con Kino abierto.

### Importante: el Developer Mode vence

La sesión del Developer Mode dura un tiempo limitado; el contador se ve en la app **Developer Mode** del TV. **Antes de que
llegue a cero, abre Developer Mode y pulsa _Extend_.**

Si se vence, el TV borra las apps instaladas así y tienes que repetir el paso 4. Los pasos 1 a 3 siguen hechos, salvo que la
IP del TV cambie.

### Si algo falla

| Lo que pasa | Qué hacer |
| --- | --- |
| `ares-novacom --getkey` no conecta | Revisa que **Key Server** esté activado y que el TV y el computador estén en la misma red. |
| La Passphrase no sirve | Apaga y vuelve a encender **Key Server** en el TV: genera una nueva. |
| `ares-install` no encuentra el TV | La IP del TV cambió: mírala en Developer Mode y repite el paso 3. |
| La app ya no aparece en el TV | Se venció el Developer Mode: pulsa **Extend** y repite el paso 4. |
| El código no empareja | El celular y el TV deben estar en la misma red, con Kino abierto en el celular. |

---

## Compílala tú (para desarrolladores)

Necesitas Node.js y las herramientas de LG del paso 2, con el TV configurado como `lg` (paso 3).

```bash
npm install
node build.mjs --package            # arma dist/com.kinotvapp.kino_<versión>_all.ipk
node build.mjs --install            # la arma, la instala en el TV `lg` y la abre
```

Qué hay en cada carpeta:

- `web/`: el cliente web de Kino, el mismo que sirven el celular y `kinoverse.app/tv`.
- `shell/`: la página que lleva la app instalada. Carga el programa de `https://kinoverse.app/tv/webos/` y, si no lo logra
  en 8 segundos, usa la copia local (`?local=1`).
- `app/appinfo.json`: el id (`com.kinotvapp.kino`), el nombre (kinoverse) y la versión.
- `brand/logo.svg`: el logo de kinoverse que muestra la app (la página del celular sigue con el de Kino).
- `build/remote/`: lo que se publica en `kinoverse.app/tv/webos/`.

Opciones: `--web=<carpeta>` usa otra copia del cliente web, y `--device=<nombre>` otro TV.

webOS trae Chromium 79, que no acepta módulos ES desde `file://`. Por eso `build.mjs` junta `app.js` y sus imports en un
solo script clásico. También agrega `file:` junto a `'self'` en la política de seguridad de la página.

Para depurar en el TV:

```bash
ares-inspect -d lg com.kinotvapp.kino
```

---

<a id="english"></a>

# kinoverse for LG webOS

This is the kinoverse (Kino) app for LG webOS TVs. The TV shows what is on your phone: the same profiles, the same plugins
and your Continue watching. The phone does the work; the TV only shows it.

The app is a shell: every time it opens, it loads the newest version from `kinoverse.app`. So **you never reinstall it to
get updates**. With no internet, it uses the copy it carries.

**Download the IPK:** [Releases ▸ latest](https://github.com/kinotvapp/kinoverse-webos/releases/latest).

## Install it on your LG with Developer Mode

You need:

- the TV and a computer on the **same network**;
- an LG account;
- Windows, macOS or Linux.

1. **On the TV:**
   - Create an account at <https://webostv.developer.lge.com> if you have none.
   - Install **Developer Mode** from the LG Content Store, open it and sign in.
   - Turn on **Dev Mode Status** and let the TV restart.
   - Open Developer Mode again and turn on **Key Server**.
   - Note the TV's **IP** and the **Passphrase** shown there.
2. **On the computer:** install Node.js LTS from <https://nodejs.org>, then run:

   ```bash
   npm install -g @webos-tools/cli
   ```

3. **Connect** (use your TV's IP):

   ```bash
   ares-setup-device -a lg -i "host=192.168.1.50" -i "port=9922" -i "username=prisoner"
   ares-novacom --device lg --getkey     # type the Passphrase exactly as the TV shows it
   ares-device -i -d lg                  # must answer with the TV's details
   ```

4. **Install and open:**

   ```bash
   ares-install --device lg com.kinotvapp.kino_0.2.1_all.ipk
   ares-launch --device lg com.kinotvapp.kino
   ```

5. **Pair:**
   - On the phone, open Kino ▸ **⋮** ▸ **Send to the TV**.
   - Type the five-digit code on the TV and pick your profile.
   - The phone must be on the same network, with Kino open.

**Developer Mode expires.** Open the Developer Mode app before its counter reaches zero and press **Extend**. If it expires,
the TV removes the app and you repeat step 4.

## Build it yourself

```bash
npm install
node build.mjs --package     # dist/com.kinotvapp.kino_<version>_all.ipk
node build.mjs --install     # build, install on the TV `lg` and open it
```

- `web/` is Kino's web client.
- `shell/` is the installed app's page. It loads the program from `https://kinoverse.app/tv/webos/` and falls back to its
  own copy after 8 seconds.
- `--web=<dir>` uses another copy of the web client, and `--device=<name>` another TV.
