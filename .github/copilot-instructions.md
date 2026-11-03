# Instrucciones del proyecto: Rio_Claro

## Qué es este proyecto
Proyecto del curso-Fundamentos de IA con Tecnologías  MICROSOFT-20260903_010033. El proyecto está desarrollado en HTML, CSS y JS llama a un backend en nodejs con express el cual conversa con un agenete  de Microsoft Foundry. Se despliega en un App Service de Azure (Linux, Node 24 LTS).

## Entorno de desarrollo
- Windows 11 con powerShell 7.3.6
- Node.js 24 LTS y npm 9.8.1, nada de typescript ni frameworks de frontend, solo HTML, CSS y JS vanilla.

## Stack y versiones
- Express 5, ES Modules (`"type": "module"`), `async/await`.
- SDK de Foundry: `@azure/ai-projects` 2.x (API "Foundry projects (new)").
No uses `@azure/ai-agents` ni la API 1.x.
- Autenticación: `DefaultAzureCredential` de `@azure/identity`.
- Variables de entorno en local con `node --env-file-if-exists=.env` (sin dotenv).

## Arquitectura (no la cambies sin preguntar)
- `server.js`: sirve `public/` en `/`, expone `POST /api/chat` y `GET /health`.
- `POST /api/invoices` guarda facturas en el sistema de archivos local privado y devuelve extracción local; `GET /api/invoices/config` indica las funciones disponibles.
- El apartado protegido de facturas lista `Documentos/Facturas` y las cargas locales, y ofrece vistas previas autenticadas; `POST /api/invoices/samples/:sampleId/analyze` y `/api/invoices/:invoiceId/analyze` analizan bajo demanda. Nunca publica documentos. Los PDF se leen con PDF.js y los escaneos/imágenes usan Tesseract.js con el modelo español instalado localmente; el procesamiento de facturas no llama a Azure ni al chatbot.
- La aplicación inicia en login y usa una base SQLite local (`node:sqlite`) con roles Administrador, Finanzas, Logística, Comercial e Invitado. Los permisos se verifican tanto en la interfaz como en cada endpoint.
- `GET /api/invoices`, `GET /api/suppliers`, `GET /api/deliveries`, `GET /api/sales` y sus rutas `/config` requieren el permiso correspondiente del rol autenticado. Las facturas y sus vistas previas nunca son públicas.
- `POST /api/auth/login` y `POST /api/auth/guest` crean sesiones JWT en cookies `HttpOnly`; `/api/auth/refresh` rota el refresh token y `/api/auth/logout` revoca la sesión.
- `npm run setup-access` crea los roles y cuentas iniciales con contraseñas aleatorias de un solo uso; exige cambiar la contraseña en el primer acceso. Guarda la base en `data/rio-claro.sqlite` o en la ruta indicada por `AUTH_DATABASE_PATH`, y genera `AUTH_TOKEN_SECRET` en `.env`.
- `GET /api/admin/users`, `GET /api/admin/roles` y `GET /api/admin/audit` requieren permisos administrativos. Los cambios de usuarios, contraseñas, roles, permisos e inicios/cierres de sesión quedan en auditoría.
- `GET /api/deliveries` entrega las entregas y la disponibilidad estimada con base en `Documentos/Entregas.md` e `InventarioGeneral.md`.
- `GET /api/sales` expone un resumen basado únicamente en entregas registradas como realizadas: entregas y unidades por mes, productos y clientes por volumen. La recaudación se muestra como no disponible cuando no hay cobros registrados. La gráfica circular muestra la proporción de unidades entregadas por producto.
- El navegador NUNCA habla directo con Foundry. Solo el backend.
- Conversación multi-turno: `openai.conversations.create()` y
`openai.responses.create({ conversation, input }, agentRef)`, donde
`agentRef = { body: { agent_reference: { name, type: "agent_reference" } } }`.
El `conversation_id` viaja entre frontend y backend en el JSON.
- El servidor escucha en `process.env.PORT` (App Service lo define).

## Seguridad
- Nunca escribas llaves, tokens ni endpoints reales en el código.
Todo sale de variables de entorno: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`.
- En Azure se usa identidad administrada (managed identity), no API keys.
- Las facturas solo se aceptan como PDF/JPG/PNG (máximo 10 MB y 20 páginas por PDF), requieren la sesión de Facturas y se guardan fuera de `public/` en el directorio privado local. No se envían a Foundry ni a Azure.
- Antes de guardar una factura, compara SHA-256 del archivo y, cuando la lectura tenga confianza suficiente, RFC del emisor y folio (o proveedor, folio, fecha y total). Rechaza duplicados con HTTP 409, informa el nombre de la factura ya guardada y no conserves una segunda copia. La comparación aplica a facturas cargadas, no a los ejemplos de la galería.
- La galería, las vistas previas y el análisis requieren la sesión de Facturas. El OCR con PDF.js/Tesseract.js funciona sin servicios remotos ni cargos de análisis. La extracción y consistencia aritmética son preliminares, no certifican CFDI/SAT ni sustituyen revisión contable.
- Configura `INVOICE_STORAGE_DIRECTORY` para elegir una ruta de almacenamiento persistente. En App Service Linux, usa una ruta bajo `/home` y confirma que el almacenamiento persistente de la aplicación está habilitado. Las cargas locales no se migran desde contenedores Blob anteriores. El chatbot de Foundry y el propio App Service pueden generar cargos independientes.
- SQLite almacena localmente usuarios, roles, sesiones, hashes bcrypt y auditoría, sin requerir un servidor de base de datos. `AUTH_DATABASE_PATH` es opcional; configura `AUTH_TOKEN_SECRET` fuera del código y nunca incluyas contraseñas o credenciales iniciales en el repositorio.
- Las sesiones duran hasta ocho horas, usan JWT de acceso y refresh en cookies `HttpOnly`, `SameSite=Strict` y `Secure` en producción. El access token dura 15 minutos; el refresh token se rota y se almacena como hash. No guardes tokens ni contraseñas en `localStorage`.
- Los estados de pago se calculan con fechas del archivo `Documentos/Proveedores.md` y fecha local de Ciudad de México. El documento es ficticio.
- El panel de entregas comparte ese acceso de personal; calcula asignaciones por fecha programada de entrega sin reservar existencias reales. Usa coincidencia exacta de nombre de producto y avisa si no encuentra el artículo. Ambos documentos son ficticios y tienen fecha de corte. El aviso de faltantes se prepara para compartir manualmente: no hay contactos ni envío automático configurados.
- Configura `INVOICE_STORAGE_DIRECTORY`, `AUTH_DATABASE_PATH` (opcional) y `AUTH_TOKEN_SECRET` fuera del código. Mantén `.env` fuera del repositorio. En App Service Linux configura la base SQLite bajo `/home` y habilita el almacenamiento persistente.
- `scripts/create-agent.js` carga `Documentos/InventarioGeneral.md` como contexto del agente; los datos del documento son ficticios y tienen fecha de corte, no son existencias reales ni disponibilidad en tiempo real.
- Valida la entrada (1 a 2000 caracteres) y responde 422 si no cumple.
- Si Foundry falla, responde 502 con un mensaje genérico; no filtres trazas.
## Estilo de código
- Comentarios en español neutro; nombres de variables en inglés.
- Cambios mínimos y enfocados: no reescribas archivos completos si basta editar.
## Cómo validar
- Local: `npm run dev` y abrir http://localhost:3000
- Salud: `Invoke-RestMethod http://localhost:3000/health` debe devolver `status: ok`
- Antes de desplegar, confirma que `package.json` incluye todo lo que se importa y que el script `start` es `node server.js`.