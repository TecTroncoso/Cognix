# Cognix

> Idioma: **Español** · [English](README.md)

**Cognix es una capa fina de launcher/integración sobre el agente Pi oficial.**
`cognix` te da una sesión de Pi funcionando con **gentle-pi + la extensión de
Cognix + los assets gestionados de gentle-ai**, y `cognix update` mantiene Pi,
gentle-pi y gentle-ai al día — siempre a través de los mecanismos oficiales de
cada proyecto.

## Qué es Cognix — y qué NO es

| Cognix SÍ es | Cognix NO es |
|---|---|
| Un launcher + bootstrap + CLI de integración para Pi | Un fork de Pi |
| Un paquete/extensión de Pi (se registra en el propio Pi) | Una copia vendorizada de Pi, gentle-pi o gentle-ai |
| Un paquete delgado distribuido por npm/GitHub | Un segundo gestor de paquetes para Pi |
| Quien dispara los `gentle-ai sync` documentados | Un updater paralelo (Pi/gentle-ai se actualizan solos) |
| | Quien elige tu persona, componentes o modo RDD — eso es decisión tuya, p. ej. vía la TUI de `gentle-ai` o `gentle-ai install --agent pi` |

**Pi sigue siendo el runtime.** Cognix decide *cuándo* pedir una operación;
cada proyecto decide *cómo* realizarla.

## Ownership (responsabilidades)

| Componente | Responsable |
|---|---|
| Runtime del agente | **Pi** |
| Instalación de Pi | mecanismo oficial de Pi (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`) |
| Actualización de Pi | **Pi** (`pi update --self`) |
| Instalación de gentle-pi | **Pi** (`pi install npm:gentle-pi`) |
| Actualización de gentle-pi | **Pi** (`pi update npm:gentle-pi`) |
| Gestión de paquetes de Pi | **Pi** |
| Instalación del binario gentle-ai | **canales oficiales de gentle-ai** (Homebrew / install.sh / `go install`) |
| Actualización de gentle-ai | **gentle-ai** (`gentle-ai upgrade`) |
| Assets gestionados de gentle-ai | **gentle-ai** (`gentle-ai sync`) |
| Integración Cognix ↔ Pi | **Cognix** |
| Extensión de Cognix | **Cognix** |
| Distribución de Cognix | **npm + GitHub** |
| Actualización de Cognix | **npm** (`npm install -g cognix`) |

> Cognix no implementa lógica que duplique la instalación, actualización o
> descubrimiento de paquetes que ya proporciona Pi.

## Requisitos

- Node.js **22.19+** con npm en el PATH (solo se usa para instalar Pi si falta).
- Pi se instala solo en la primera ejecución si no está presente.
- gentle-ai también se instala solo en la primera ejecución, por su canal
  oficial: Homebrew (macOS), el `install.sh` oficial (macOS/Linux) o
  `go install` (Windows — requiere **Go 1.25.10+**; los binarios de Windows
  están temporalmente no disponibles upstream hasta que vuelva la firma
  Authenticode). Si gentle-ai no puede instalarse, Cognix avisa con claridad y
  continúa: el núcleo Pi+gentle-pi funciona sin él.

## Instalación de Cognix

```bash
npm install -g cognix                      # registro npm (una vez publicado)
npm install -g github:TecTroncoso/Cognix   # directo desde GitHub (compila vía el hook prepare de npm; requiere Node 22.19+)
```

También con la forma explícita git, o fijando rama/commit/tag:

```bash
npm install -g git+https://github.com/TecTroncoso/Cognix.git
npm install -g github:TecTroncoso/Cognix#main
npm install -g github:TecTroncoso/Cognix#<tag-o-commit>
```

### Desde el código fuente (desarrollo)

```bash
git clone https://github.com/TecTroncoso/Cognix.git
cd Cognix
npm install
npm run build
npm link   # deja `cognix` disponible globalmente desde este checkout
```

## Comandos

```bash
cognix                 # arranca una sesión de Pi (bootstrap de Pi + gentle-pi + cognix + gentle-ai en la primera ejecución)
cognix update          # pi update --self · pi update/install npm:gentle-pi · gentle-ai upgrade · gentle-ai sync · re-verificación
cognix doctor          # diagnóstico de solo lectura: versiones, rutas, registros, scope de gentle-ai
cognix --help          # ayuda de este CLI
cognix --version       # versiones de cognix / pi / gentle-pi / gentle-ai
```

### Passthrough (paso directo de argumentos)

Todo argumento que Cognix no reconoce se reenvía a Pi **sin cambios**; su
stdin/stdout/stderr y exit code se heredan:

```bash
cognix --mode rpc        # == pi --mode rpc
cognix -p "explica src"  # == pi -p "explica src"
cognix -c                # == pi --continue
cognix -- --help         # ayuda del propio pi (cognix es dueño de --help)
cognix -- list           # pi list
```

Los mensajes de estado de Cognix van a **stderr**, así que el stdout de Pi
sigue siendo un canal limpio en los modos print/JSON/RPC.

### Política de pins

Si la configuración de Pi fija gentle-pi (p. ej. `npm:gentle-pi@3.7.0`,
normalmente escrito por las herramientas de gentle-ai para emparejar
releases), `cognix update` **respeta el pin** y lo informa. Para moverlo
intencionadamente: `pi install npm:gentle-pi`. Los pins son una decisión
explícita del usuario/herramienta — Cognix nunca los reescribe en silencio.

## Cómo funciona

1. **Localiza Pi** — `COGNIX_PI` → escaneo de PATH → rutas conocidas
   (Windows: `%APPDATA%\npm\pi.cmd`; Unix: `/usr/local/bin`, `/usr/bin`,
   `~/.local/bin`, `~/.npm-global/bin`). Verificado con `pi --version`.
2. **Instala Pi si falta** — `npm install -g --ignore-scripts
   @earendil-works/pi-coding-agent` (mecanismo oficial documentado).
3. **Asegura gentle-pi** — `pi install npm:gentle-pi` cuando no hay
   declaración; las declaraciones existentes (npm con pin o sin pin, y
   paquetes por ruta) se reutilizan tal cual. Una entrada por ruta rota de
   gentle-pi se elimina y se reinstala.
4. **Registra Cognix** — `pi install <ruta absoluta del paquete cognix
   instalado>` (mecanismo oficial de paquete por ruta local de Pi; la
   extensión siempre coincide con la versión de la CLI instalada, una sola
   copia del código en disco).
5. **Asegura gentle-ai (binario)** — `COGNIX_GENTLE_AI` → PATH →
   `~/go/bin`, prefijos de brew, `/usr/local/bin`, `~/.local/bin`. Si falta,
   se instala por el canal oficial. Si no es posible → aviso y continúa,
   nunca bloquea.
6. **Sync cuando algo cambió** — los pasos documentados post-actualización:
   `gentle-ai sync` después de cambios del binario gentle-ai, y
   `gentle-ai sync --agent pi` después de instalar/reparar gentle-pi (la
   forma documentada de apuntar a pi explícitamente). Los fallos de sync se
   muestran como advertencias, nunca son fatales.
7. **Lanza el `pi` real** con tus argumentos; su exit code se convierte en
   el de cognix.

Todo es idempotente: una segunda ejecución de `cognix` con todo sano realiza
**cero** instalaciones y **cero** syncs.

## Variables de entorno

| Variable | Efecto |
|---|---|
| `COGNIX_PI` | Ruta explícita al ejecutable de pi (override para dev/testing) |
| `COGNIX_GENTLE_AI` | Ruta explícita al ejecutable de gentle-ai (override para dev/testing) |
| `PI_CODING_AGENT_DIR` | Override propio de Pi del directorio del agente (por defecto `~/.pi/agent`) |
| `GENTLE_AI_YES=1` | Interruptor propio de gentle-ai: auto-acepta su prompt de self-update en scripts |

## Deshacer el registro de Cognix

Cognix no es más que una declaración normal de paquete por ruta local dentro
de la configuración de Pi:

```bash
cognix doctor          # muestra la ruta registrada
pi remove <esa ruta>   # eliminación de paquete propia de Pi
npm uninstall -g cognix
```

Cognix no deja nada más; el estado propio de Pi (sesiones, credenciales,
gentle-pi) permanece en `~/.pi/agent`, y los assets gestionados de gentle-ai
permanecen en `~/.gentle-ai` (se eliminan con `gentle-ai uninstall` — comando
propio de gentle-ai — no por Cognix).

## Notas multiplataforma

- Windows: los CLIs globales de npm son shims `.cmd` — Node no puede
  spawnearlos directamente, así que Cognix los ejecuta a través de `cmd.exe`
  con una única línea de comando pre-comillada (los argumentos con espacios,
  comillas y backslashes finales sobreviven). `pi.ps1` nunca se usa como
  objetivo de spawn.
- macOS/Linux: ejecutables planos resueltos desde PATH y rutas conocidas.
- Los exit codes se propagan; el stdio y el entorno del hijo se heredan; las
  señales llegan al hijo a través de la consola/grupo de procesos compartido.

## Troubleshooting

| Síntoma | Causa probable / arreglo |
|---|---|
| `npm is required to install Pi` | Instala Node.js ≥ 22.19 (incluye npm), o instala Pi manualmente (`curl -fsSL https://pi.dev/install.sh \| sh` en macOS/Linux) y vuelve a ejecutar `cognix`. |
| `Found pi at … but it failed to run` | Instalación rota/parcial: reinstala con `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. Si definiste `COGNIX_PI`, corrígelo o quítalo. |
| `installed … but the pi executable could not be found` | El PATH no se refrescó tras la primera instalación global de npm: abre una terminal nueva, o define `COGNIX_PI` con la ruta del shim de pi. |
| `Pi settings … are not valid JSON` | Repara a mano o restaura `~/.pi/agent/settings.json` (el propio Pi también rechaza settings mal formados). |
| `gentle-pi is pinned to X` durante update | Intencional: el pin se respeta. Muévelo con `pi install npm:gentle-pi`. |
| `could not install gentle-ai automatically … Go is not on PATH` (Windows) | El canal oficial de gentle-ai en Windows compila desde fuente: instala Go 1.25.10+ (`winget install GoLang.Go`), o define `COGNIX_GENTLE_AI` con un binario existente. El núcleo funciona igualmente. |
| `gentle-ai upgrade exited …` | El updater propio de gentle-ai falló: ejecútalo tú mismo (`gentle-ai upgrade`) para ver su guía (ejecuciones no-TTY auto-rechazan; `GENTLE_AI_YES=1` auto-acepta; los rate limits de GitHub necesitan `GH_TOKEN`). |
| `gentle-ai sync … exited …` | Los assets no se refrescaron; ejecuta a mano el comando mostrado. Hasta que sync tenga éxito, las operaciones de revisión RDD de gentle-pi fallan en cerrado (diseño suyo). |
| `cognix package: stale registration(s)` en doctor | El prefijo de npm se movió; ejecuta `cognix update` (auto-repara) o `pi remove <ruta antigua>`. |
| pi no está en los agentes registrados de gentle-ai | Opcional: `gentle-ai install --agent pi` para que gentle-ai gestione Pi por completo (stack de paquetes, persona, componentes). Cognix sincroniza los assets de pi con `sync --agent pi` de todas formas. |

## Desarrollo

```bash
npm install        # dependencias de desarrollo (solo locales)
npm test           # build + suite de unidad (node:test; fakes + directorios temporales; sin red)
npm run e2e        # e2e REAL aislado y opt-in: PI_CODING_AGENT_DIR temporal, auto-limpiante
npm run typecheck  # tsc --noEmit
npm run build      # tsc -> dist/
```

La suite de unidades nunca instala nada y nunca toca tu `~/.pi` real. El script
e2e instala gentle-pi *en un home de agente temporal* vía el Pi real, prueba
bootstrap + idempotencia + passthrough, y borra el home temporal al terminar.
Se salta limpiamente cuando pi/npm o la red no están disponibles.

Ver [docs/architecture.md](docs/architecture.md) para el informe completo de
investigación y las decisiones de delegación en las que descansa este diseño.
