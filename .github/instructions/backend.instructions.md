---
name: 'Backend Express'
description: 'Usar al crear o modificar el backend Node.js que llama a Microsoft Foundry.'
applyTo: 'server.js,auth.js,auth-store.js,scripts/**'
---
# Reglas del backend

* Crea el `AIProjectClient` y el cliente de OpenAI una sola vez al iniciar, no en cada request.
* Referencia al agente en cada `responses.create` con `{ body: { agent_reference: { name: AGENT_NAME, type: "agent_reference" } } }`. Nunca uses la propiedad `agent` (la API la rechaza con 400).
* Respeta el contrato de /api/chat de copilot-instructions.md: respuesta `{ reply, conversation_id }` y errores `{ detail }`.
* Usa `async/await` y envuelve las llamadas al SDK en `try/catch` y responde 502 genérico.
* Resuelve rutas de archivos con `import.meta.dirname`, no con el directorio actual.
* Lee las variables FOUNDRY_PROJECT_ENDPOINT, FOUNDRY_AGENT_NAME y FOUNDRY_MODEL_DEPLOYMENT; no inventes otros nombres.
* scripts/create-agent.js crea el agente con kind "prompt" y debe incluir en sus instrucciones la regla de alcance (solo temas del proyecto Río Claro) y las reglas de IA responsable.
* Las facturas se guardan en una carpeta privada local fuera de `public/`; configura opcionalmente `INVOICE_STORAGE_DIRECTORY`. En Azure App Service Linux, usa una ruta bajo `/home` con almacenamiento persistente habilitado.
* La carga acepta solo PDF/JPG/PNG de hasta 10 MB, verifica tipo y firma del archivo, y exige una sesión autenticada del apartado Facturas. No expongas listado ni descarga pública ni envíes el archivo al chatbot.
* La galería de ejemplos/cargas, las vistas previas y el análisis exigen la sesión de Facturas. El análisis utiliza PDF.js/Tesseract.js y el modelo español instalado localmente, sin enviar documentos a Azure ni a Foundry. Acepta PDF/JPG/PNG de hasta 10 MB y limita PDF a 20 páginas para controlar el procesamiento local. La validación es preliminar y nunca debe afirmarse como validación fiscal ante el SAT.
* Antes de guardar, rechaza como duplicados las cargas con SHA-256 coincidente o con identidad de factura de alta confianza coincidente (RFC del emisor + folio; respaldo: proveedor + folio + fecha + total). Responde HTTP 409, informa qué documento existente coincidió y no guardes la nueva carga. Serializa escrituras para evitar que dos cargas simultáneas pasen la comprobación; los ejemplos de la galería no cuentan como cargas previas.
* No agregues llamadas a servicios de OCR remotos ni almacenamiento de facturas en Azure. Las cargas previas en Blob no se migran automáticamente; el chatbot de Foundry y App Service conservan costos independientes.
* scripts/create-agent.js incluye `Documentos/InventarioGeneral.md` en las instrucciones del agente. El documento es ficticio y tiene fecha de corte; nunca presentes sus cantidades como inventario real o disponibilidad en tiempo real.
* Autentica usuarios mediante SQLite local (`node:sqlite`) y JWT en cookies `HttpOnly`; valida permisos por rol en cada endpoint. Ocultar secciones en el frontend nunca sustituye la autorización del backend.
* Usa bcrypt para hashes; configura opcionalmente `AUTH_DATABASE_PATH` y define `AUTH_TOKEN_SECRET` fuera del código. La base predeterminada está en `data/rio-claro.sqlite`, fuera de `public/`; en App Service Linux usa una ruta persistente bajo `/home`. `npm run setup-access` crea las cuentas iniciales con claves aleatorias de un solo uso y obliga a cambiarlas en el primer acceso. `npm run reset-access` rota claves e invalida sesiones. Nunca guardes contraseñas ni tokens en el repositorio o `localStorage`.
* Los JWT de acceso duran 15 minutos; los refresh duran hasta ocho horas, se rotan y su identificador se almacena como hash. Usa cookies `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
* Finanzas accede a facturas y proveedores (`invoices`, `suppliers`); Logística a entregas (`deliveries`); Comercial a ventas (`sales`); Invitado solo al chatbot (`chatbot`); Administrador tiene acceso total.
* El registro de pagos se sirve desde `Documentos/Proveedores.md` solo mediante `/api/suppliers` con permiso `suppliers`. Calcula estado por fecha de pago y fecha límite respecto a la fecha local de Ciudad de México; el archivo es ficticio.
* El panel `GET /api/deliveries` requiere el permiso `deliveries` para servir pedidos cotejados con el inventario; asigna existencias por fecha programada de entrega y no debe presentarlas como reservas o stock en tiempo real. No inventes contactos ni afirmes que se notificó a un proveedor; el aviso se comparte manualmente.
* El panel de ventas `GET /api/sales` requiere el permiso `sales` y cuenta únicamente registros con estado de entrega realizado. Agrupa ventas registradas, unidades, productos y clientes; no presentes entregas como pagos cobrados. Si faltan precios o costos, informa que recaudación y margen no se pueden calcular, sin inventar cifras.
* No agregues dependencias nuevas sin mencionarlas en el plan.