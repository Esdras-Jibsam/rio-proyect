---
name: 'Frontend del chat'
description: 'Usar al crear o modificar la interfaz web del chatbot.'
applyTo: 'public/**'
---
# Reglas del frontend

* Solo HTML, CSS y JavaScript vanilla (ES2020+). Sin frameworks ni CDNs.
* Inserta el texto del bot con `textContent`, nunca con `innerHTML` (evita XSS).
* Guarda el `conversation_id` en una variable de JS; se reinicia al recargar.
* Lee `reply` y `conversation_id` de la respuesta y `detail` en los errores (contrato de copilot-instructions.md).
* Deshabilita el botón de enviar mientras espera respuesta y muestra "Escribiendo…".
* Diseño responsivo: debe verse y usarse bien a 360 px de ancho.
* Muestra siempre visible el aviso de transparencia de IA.
* Voz con la Web Speech API del navegador: botón para dictar y botón para escuchar la respuesta. Si el navegador no la soporta, oculta esos botones sin romper el chat.
* Usa variables CSS en `:root` para colores y tamaños.
* Etiquetas accesibles (aria-label) en botones e inputs.