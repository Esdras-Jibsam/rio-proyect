const chatForm = document.querySelector("#chat-form");
const chatHistory = document.querySelector("#chat-history");
const chatStatus = document.querySelector("#chat-status");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const sendLabel = document.querySelector("#send-label");
const dictateButton = document.querySelector("#dictate-button");
const themeToggle = document.querySelector("#theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const loginScreen = document.querySelector("#login-screen");
const authenticatedApp = document.querySelector("#authenticated-app");
const loginForm = document.querySelector("#login-form");
const loginUsername = document.querySelector("#login-username");
const loginPassword = document.querySelector("#login-password");
const loginButton = document.querySelector("#login-button");
const guestLoginButton = document.querySelector("#guest-login-button");
const loginStatus = document.querySelector("#login-status");
const accountIdentity = document.querySelector("#account-identity");
const logoutButton = document.querySelector("#logout-button");
const changePasswordButton = document.querySelector("#change-password-button");
const forcedPasswordPanel = document.querySelector("#forced-password-panel");
const forcedPasswordForm = document.querySelector("#forced-password-form");
const forcedPasswordSubmit = document.querySelector("#forced-password-submit");
const forcedPasswordStatus = document.querySelector("#forced-password-status");
const currentPassword = document.querySelector("#current-password");
const newPassword = document.querySelector("#new-password");
const confirmPassword = document.querySelector("#confirm-password");
const appContent = document.querySelector("#app-content");
const invoiceForm = document.querySelector("#invoice-form");
const invoiceFile = document.querySelector("#invoice-file");
const invoiceLoadButton = document.querySelector("#invoice-load-button");
const invoiceUploadButton = document.querySelector("#invoice-upload-button");
const invoiceStatus = document.querySelector("#invoice-status");
const invoiceRecords = document.querySelector("#invoice-records");
const invoicePreview = document.querySelector("#invoice-preview");
const invoiceAnalysis = document.querySelector("#invoice-analysis");
const supplierLoadButton = document.querySelector("#supplier-load-button");
const supplierStatus = document.querySelector("#supplier-status");
const supplierResults = document.querySelector("#supplier-results");
const supplierStatusFilter = document.querySelector("#supplier-status-filter");
const supplierRecords = document.querySelector("#supplier-records");
const supplierReferenceDate = document.querySelector("#supplier-reference-date");
const deliveryLoadButton = document.querySelector("#delivery-load-button");
const deliveryStatus = document.querySelector("#delivery-status");
const deliveryResults = document.querySelector("#delivery-results");
const deliveryReferenceDate = document.querySelector("#delivery-reference-date");
const deliveryQuestionForm = document.querySelector("#delivery-question-form");
const deliveryQuestion = document.querySelector("#delivery-question");
const deliveryDictateButton = document.querySelector("#delivery-dictate-button");
const deliveryAskButton = document.querySelector("#delivery-ask-button");
const deliveryAnswer = document.querySelector("#delivery-answer");
const deliveryFilter = document.querySelector("#delivery-filter");
const deliveryRecords = document.querySelector("#delivery-records");
const deliveryPrepareNotification = document.querySelector(
  "#delivery-prepare-notification",
);
const deliveryNotification = document.querySelector("#delivery-notification");
const deliveryNotificationStatus = document.querySelector(
  "#delivery-notification-status",
);
const deliveryNotificationMessage = document.querySelector(
  "#delivery-notification-message",
);
const deliveryShareButton = document.querySelector("#delivery-share-button");
const salesLoadButton = document.querySelector("#sales-load-button");
const salesStatus = document.querySelector("#sales-status");
const salesResults = document.querySelector("#sales-results");
const salesReferenceDate = document.querySelector("#sales-reference-date");
const salesMonthChart = document.querySelector("#sales-month-chart");
const salesProductChart = document.querySelector("#sales-product-chart");
const salesProductPie = document.querySelector("#sales-product-pie");
const salesPieTotal = document.querySelector("#sales-pie-total");
const salesPieLegend = document.querySelector("#sales-pie-legend");
const salesCustomerChart = document.querySelector("#sales-customer-chart");
const salesDataNote = document.querySelector("#sales-data-note");
const accessSections = {
  invoices: {
    permission: "invoices",
    userStatus: document.querySelector("#invoice-user-status"),
    loadButton: invoiceLoadButton,
    status: invoiceStatus,
  },
  suppliers: {
    permission: "suppliers",
    userStatus: document.querySelector("#supplier-user-status"),
    loadButton: supplierLoadButton,
    status: supplierStatus,
  },
  deliveries: {
    permission: "deliveries",
    userStatus: document.querySelector("#delivery-user-status"),
    loadButton: deliveryLoadButton,
    status: deliveryStatus,
  },
  sales: {
    permission: "sales",
    userStatus: document.querySelector("#sales-user-status"),
    loadButton: salesLoadButton,
    status: salesStatus,
  },
};

let conversationId = null;
let supplierPayments = [];
let deliveryReport = null;
let salesReport = null;
let currentUser = null;
let invoiceGalleryEnabled = false;
let invoiceUploadEnabled = false;
let invoiceAnalysisEnabled = false;
let invoicePreviewUrl = null;
const accessState = Object.fromEntries(
  Object.keys(accessSections).map((section) => [
    section,
    { enabled: false, authenticated: false },
  ]),
);

function getSavedTheme() {
  try {
    return localStorage.getItem("rio-claro-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function setTheme(theme, { save = false } = {}) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  for (const logo of document.querySelectorAll(".brand-mark")) {
    logo.src = isDark ? "/logo-dark.svg" : "/logo.svg";
  }
  themeToggle.setAttribute("aria-pressed", String(isDark));
  const action = isDark ? "Cambiar a tema claro" : "Activar modo oscuro";
  themeToggle.setAttribute("aria-label", action);
  themeToggle.title = action;
  themeColorMeta.content = isDark ? "#091a28" : "#f1f7fa";

  if (save) {
    try {
      localStorage.setItem("rio-claro-theme", isDark ? "dark" : "light");
    } catch {
      // El tema sigue funcionando aunque el navegador no permita guardar preferencias.
    }
  }
}

setTheme(getSavedTheme());
themeToggle.addEventListener("click", () => {
  const nextTheme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme, { save: true });
});

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const canSpeak =
  "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

if (SpeechRecognition) {
  dictateButton.hidden = false;
}

function setAccessState(section) {
  const state = accessState[section];
  const controls = accessSections[section];
  const authenticated = Boolean(
    currentUser?.permissions.includes(controls.permission),
  );
  state.enabled = authenticated;
  state.authenticated = authenticated;
  controls.loadButton.disabled = !authenticated;
  controls.userStatus.textContent = authenticated
    ? `Acceso autorizado: ${currentUser.role}.`
    : "";

  if (section === "invoices") {
    invoiceFile.disabled = !invoiceUploadEnabled || !authenticated;
    invoiceUploadButton.disabled = !invoiceUploadEnabled || !authenticated;
  }
}

let refreshRequest = null;

async function authenticatedFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  if (response.status !== 401 || url.startsWith("/api/auth/")) {
    return response;
  }
  refreshRequest ??= fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  }).finally(() => {
    refreshRequest = null;
  });
  const refreshed = await refreshRequest;
  if (!refreshed.ok) {
    showSignedOut();
    throw new Error("La sesión terminó. Inicia sesión de nuevo.");
  }
  return fetch(url, { credentials: "same-origin", ...options });
}

async function accessFetch(section, url, options = {}) {
  const response = await authenticatedFetch(url, options);
  if (response.status === 401) {
    showSignedOut();
    throw new Error("La sesión terminó. Inicia sesión de nuevo.");
  }
  if (response.status === 403) {
    const result = await response.clone().json().catch(() => ({}));
    if (result.code === "PASSWORD_CHANGE_REQUIRED") {
      showPasswordChange(true);
    }
  }
  return response;
}

async function loadSectionData(section) {
  if (section === "invoices") {
    await loadInvoiceGallery();
  } else if (section === "suppliers") {
    await loadSupplierPayments();
  } else if (section === "deliveries") {
    await loadDeliveryReadiness();
  } else if (section === "sales") {
    await loadSalesPerformance();
  }
}

async function configureInvoiceUpload() {
  try {
    const response = await authenticatedFetch("/api/invoices/config");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail ?? "No se pudo consultar la configuración.");
    }

    invoiceGalleryEnabled = result.galleryEnabled === true;
    invoiceUploadEnabled = result.enabled === true;
    invoiceAnalysisEnabled = result.analysisEnabled === true;
    invoiceLoadButton.disabled =
      !invoiceGalleryEnabled || !accessState.invoices.authenticated;
    invoiceFile.disabled =
      !invoiceUploadEnabled || !accessState.invoices.authenticated;
    invoiceUploadButton.disabled =
      !invoiceUploadEnabled || !accessState.invoices.authenticated;
    invoiceUploadButton.textContent = invoiceAnalysisEnabled
      ? "Guardar y analizar"
      : "Guardar sin extracción";
  } catch (error) {
    invoiceStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo consultar la configuración de carga.";
    invoiceStatus.dataset.state = "error";
  }
}

function setSignedIn(user) {
  currentUser = user;
  loginScreen.hidden = true;
  authenticatedApp.hidden = false;
  const displayName = user.isGuest ? "Invitado" : `${user.name} | ${user.role}`;
  accountIdentity.textContent = displayName;
  changePasswordButton.hidden = user.isGuest;
  for (const element of document.querySelectorAll("[data-permission]")) {
    element.hidden = !user.permissions.includes(element.dataset.permission);
  }
  document.querySelector("#module-navigation").hidden =
    user.mustChangePassword;
  for (const section of Object.keys(accessSections)) {
    setAccessState(section);
  }
  forcedPasswordPanel.hidden = !user.mustChangePassword;
  appContent.hidden = user.mustChangePassword;
  if (!user.mustChangePassword) {
    applyProtectedRoute();
  }
}

function showPasswordChange(required = false) {
  forcedPasswordPanel.hidden = false;
  appContent.hidden = true;
  document.querySelector("#password-cancel").hidden = required;
  forcedPasswordStatus.textContent = required
    ? "Debes cambiar tu contraseña para continuar."
    : "";
  forcedPasswordStatus.dataset.state = "";
  currentPassword.focus();
}

function showSignedOut() {
  const welcome = chatHistory.querySelector(".message-assistant")?.cloneNode(true);
  chatHistory.replaceChildren(...(welcome ? [welcome] : []));
  conversationId = null;
  messageInput.value = "";
  chatStatus.textContent = "";
  invoiceRecords.replaceChildren();
  clearInvoicePreview();
  invoiceAnalysis.replaceChildren();
  invoiceAnalysis.hidden = true;
  invoiceFile.value = "";
  invoiceStatus.textContent = "";
  supplierPayments = [];
  supplierResults.hidden = true;
  supplierRecords.replaceChildren();
  supplierReferenceDate.textContent = "";
  supplierStatusFilter.value = "all";
  document.querySelectorAll(".supplier-summary strong").forEach((value) => {
    value.textContent = "0";
  });
  deliveryReport = null;
  deliveryResults.hidden = true;
  deliveryRecords.replaceChildren();
  deliveryNotification.hidden = true;
  deliveryNotificationStatus.textContent = "";
  deliveryNotificationMessage.value = "";
  deliveryAnswer.textContent = "";
  deliveryQuestion.value = "";
  deliveryReferenceDate.textContent = "";
  document.querySelectorAll(".delivery-summary strong").forEach((value) => {
    value.textContent = "0";
  });
  salesReport = null;
  salesResults.hidden = true;
  salesReferenceDate.textContent = "";
  salesPieTotal.textContent = "0";
  document.querySelectorAll(".sales-summary strong").forEach((value) => {
    value.textContent = "0";
  });
  for (const chart of [
    salesMonthChart,
    salesProductChart,
    salesPieLegend,
    salesCustomerChart,
  ]) {
    chart.replaceChildren();
  }
  salesDataNote.textContent = "";
  for (const controls of Object.values(accessSections)) {
    controls.status.textContent = "";
    controls.status.dataset.state = "";
    controls.userStatus.textContent = "";
  }
  userTableBody.replaceChildren();
  auditTableBody.replaceChildren();
  userEditor.hidden = true;
  createUserForm.reset();
  forcedPasswordForm.reset();
  forcedPasswordStatus.textContent = "";
  forcedPasswordStatus.dataset.state = "";
  forcedPasswordPanel.hidden = true;
  appContent.hidden = false;
  document.querySelector("#module-navigation").hidden = false;
  adminUserStatus.textContent = "";
  roleStatus.textContent = "";
  accountIdentity.textContent = "";
  loginStatus.textContent = "";
  loginStatus.dataset.state = "";
  currentUser = null;
  invoiceGalleryEnabled = false;
  invoiceUploadEnabled = false;
  invoiceAnalysisEnabled = false;
  authenticatedApp.hidden = true;
  loginScreen.hidden = false;
  loginPassword.value = "";
  for (const section of Object.keys(accessState)) {
    setAccessState(section);
  }
}

function applyProtectedRoute() {
  const permissionForPath = new Map([
    ["/facturas", "invoices"],
    ["/proveedores", "suppliers"],
    ["/entregas", "deliveries"],
    ["/ventas", "sales"],
    ["/administracion/usuarios", "user_admin"],
    ["/configuracion", "settings"],
    ["/auditoria", "audit"],
    ["/asistente", "chatbot"],
  ]);
  const requiredPermission = permissionForPath.get(window.location.pathname);
  if (requiredPermission && !currentUser.permissions.includes(requiredPermission)) {
    window.location.replace("/acceso-denegado");
    return;
  }
  const sectionForPath = new Map([
    ["/facturas", ".invoice-section"],
    ["/proveedores", ".supplier-section"],
    ["/entregas", ".delivery-section"],
    ["/ventas", ".sales-section"],
  ]);
  const targetSelector =
    sectionForPath.get(window.location.pathname) ??
    ({
      "/administracion/usuarios": "#admin-users-panel",
      "/configuracion": "#settings-panel",
      "/auditoria": "#audit-panel",
      "/asistente": ".chat-card",
    }[window.location.pathname]);
  if (targetSelector) {
    const target = document.querySelector(targetSelector);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
    }
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (window.location.pathname === "/acceso-denegado") {
    chatStatus.textContent = "No tienes permiso para acceder a ese apartado.";
  }
}

async function initializeAccess() {
  const refreshResponse = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!refreshResponse.ok) {
    showSignedOut();
    return;
  }
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok || !result.authenticated) {
    showSignedOut();
    return;
  }
  setSignedIn(result.user);
  if (result.user.mustChangePassword) {
    showPasswordChange(true);
    return;
  }
  if (accessState.invoices.authenticated) {
    await configureInvoiceUpload();
  }
  await Promise.all(
    Object.keys(accessSections)
      .filter((section) => accessState[section].authenticated)
      .map((section) => loadSectionData(section)),
  );
  await initializeAdministration();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginStatus.textContent = "Verificando credenciales…";
  loginStatus.dataset.state = "";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: loginUsername.value,
        password: loginPassword.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail ?? "No se pudo iniciar sesión.");
    }
    loginPassword.value = "";
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok || !session.authenticated) {
      throw new Error("No se pudo establecer la sesión.");
    }
    setSignedIn(session.user);
    if (session.user.mustChangePassword) {
      showPasswordChange(true);
    } else {
      if (accessState.invoices.authenticated) {
        await configureInvoiceUpload();
      }
      await Promise.all(
        Object.keys(accessSections)
          .filter((section) => accessState[section].authenticated)
          .map((section) => loadSectionData(section)),
      );
      await initializeAdministration();
    }
  } catch (error) {
    loginStatus.textContent =
      error instanceof Error ? error.message : "No se pudo iniciar sesión.";
    loginStatus.dataset.state = "error";
  } finally {
    loginButton.disabled = false;
  }
});

guestLoginButton.addEventListener("click", async () => {
  guestLoginButton.disabled = true;
  loginStatus.textContent = "Iniciando sesión de invitado…";
  loginStatus.dataset.state = "";
  try {
    const response = await fetch("/api/auth/guest", {
      method: "POST",
      credentials: "same-origin",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail ?? "No se pudo iniciar sesión como invitado.");
    }
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok || !session.authenticated) {
      throw new Error("No se pudo establecer la sesión de invitado.");
    }
    setSignedIn(session.user);
    createMessage("assistant", result.message);
  } catch (error) {
    loginStatus.textContent =
      error instanceof Error ? error.message : "No se pudo iniciar sesión como invitado.";
    loginStatus.dataset.state = "error";
  } finally {
    guestLoginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    showSignedOut();
    window.history.replaceState(null, "", "/login");
  }
});

changePasswordButton.addEventListener("click", () => showPasswordChange(false));
document.querySelector("#password-cancel").addEventListener("click", () => {
  forcedPasswordPanel.hidden = true;
  appContent.hidden = false;
});

forcedPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (newPassword.value !== confirmPassword.value) {
    forcedPasswordStatus.textContent = "Las contraseñas nuevas no coinciden.";
    forcedPasswordStatus.dataset.state = "error";
    return;
  }
  forcedPasswordSubmit.disabled = true;
  try {
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail ?? "No se pudo cambiar la contraseña.");
    }
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    const sessionResponse = await fetch("/api/auth/session", {
      credentials: "same-origin",
    });
    const session = await sessionResponse.json();
    setSignedIn(session.user);
    forcedPasswordPanel.hidden = true;
    appContent.hidden = false;
    if (accessState.invoices.authenticated) {
      await configureInvoiceUpload();
    }
    await Promise.all(
      Object.keys(accessSections)
        .filter((section) => accessState[section].authenticated)
        .map((section) => loadSectionData(section)),
    );
    await initializeAdministration();
  } catch (error) {
    forcedPasswordStatus.textContent =
      error instanceof Error ? error.message : "No se pudo cambiar la contraseña.";
    forcedPasswordStatus.dataset.state = "error";
  } finally {
    forcedPasswordSubmit.disabled = false;
  }
});

for (const [section, controls] of Object.entries(accessSections)) {
  controls.loadButton.addEventListener("click", () => {
    void loadSectionData(section);
  });
}

void initializeAccess();

const createUserForm = document.querySelector("#create-user-form");
const newUserRole = document.querySelector("#new-user-role");
const adminUserStatus = document.querySelector("#admin-user-status");
const userTableBody = document.querySelector("#user-table-body");
const userEditor = document.querySelector("#user-editor");
const rolePermissionsForm = document.querySelector("#role-permissions-form");
const rolePermissionsSelect = document.querySelector("#role-permissions-select");
const rolePermissionOptions = document.querySelector("#role-permission-options");
const roleStatus = document.querySelector("#role-status");
const auditTableBody = document.querySelector("#audit-table-body");
const editablePermissions = [
  ["chatbot", "Asistente virtual"],
  ["invoices", "Facturas"],
  ["suppliers", "Proveedores y pagos"],
  ["deliveries", "Entregas e inventario"],
  ["sales", "Ventas y desempeño"],
];
let adminUiInitialized = false;
let adminRoles = [];

async function adminFetch(url, options = {}) {
  const response = await authenticatedFetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.detail ?? "No se pudo completar la operación.");
  }
  return result;
}

function createRoleOptions(select, selectedRole = "") {
  select.replaceChildren();
  for (const role of ["Finanzas", "Logística", "Comercial", "Administrador"]) {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    option.selected = role === selectedRole;
    select.append(option);
  }
}

function createTableCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text ?? "—";
  return cell;
}

function createActionButton(label, action, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", callback);
  action.append(button);
}

function displayDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-MX");
}

async function loadAdminUsers() {
  const { users } = await adminFetch("/api/admin/users");
  userTableBody.replaceChildren();
  for (const user of users) {
    const row = document.createElement("tr");
    row.append(
      createTableCell(user.name),
      createTableCell(user.username),
      createTableCell(user.email),
      createTableCell(user.role),
      createTableCell(user.status),
      createTableCell(displayDate(user.lastAccess)),
    );
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const cell = document.createElement("td");
    cell.append(actions);
    const isCarlos =
      currentUser.username.toLocaleLowerCase("es-MX") === "carlos";
    const isEsdras = user.username.toLocaleLowerCase("es-MX") === "esdras";
    if (!(isCarlos && isEsdras)) {
      createActionButton("Editar", actions, () => showUserEditor(user));
      createActionButton(
        user.status === "activo" ? "Desactivar" : "Reactivar",
        actions,
        async () => {
          await updateAdminUser(user.id, {
            status: user.status === "activo" ? "inactivo" : "activo",
          });
        },
      );
      createActionButton("Restablecer contraseña", actions, async () => {
        try {
          const { temporaryPassword } = await adminFetch(
            `/api/admin/users/${encodeURIComponent(user.id)}/reset-password`,
            { method: "POST" },
          );
          adminUserStatus.textContent =
            `Contraseña temporal de ${user.username} (se muestra una vez): ${temporaryPassword}`;
          adminUserStatus.dataset.state = "success";
        } catch (error) {
          adminUserStatus.textContent = error.message;
          adminUserStatus.dataset.state = "error";
        }
      });
    }
    if (!isCarlos) {
      createActionButton("Eliminar", actions, async () => {
        if (!window.confirm(`¿Eliminar permanentemente a ${user.username}?`)) {
          return;
        }
        try {
          await adminFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
            method: "DELETE",
          });
          await loadAdminUsers();
        } catch (error) {
          adminUserStatus.textContent = error.message;
          adminUserStatus.dataset.state = "error";
        }
      });
    }
    row.append(cell);
    userTableBody.append(row);
  }
}

function createEditorField(labelText, name, value, type = "text") {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value ?? "";
  label.append(input);
  return label;
}

function showUserEditor(user) {
  userEditor.replaceChildren();
  userEditor.hidden = false;
  const form = document.createElement("form");
  form.className = "user-editor";
  form.append(
    createEditorField("Nombre completo", "name", user.name),
    createEditorField("Usuario", "username", user.username),
    createEditorField("Correo electrónico", "email", user.email, "email"),
    createEditorField("Departamento", "department", user.department),
  );
  const roleLabel = document.createElement("label");
  roleLabel.append(document.createTextNode("Rol"));
  const roleSelect = document.createElement("select");
  roleSelect.name = "role";
  createRoleOptions(roleSelect, user.role);
  roleLabel.append(roleSelect);
  form.append(roleLabel);
  const actions = document.createElement("div");
  actions.className = "editor-actions";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Guardar cambios";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => {
    userEditor.hidden = true;
  });
  actions.append(save, cancel);
  form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    try {
      const updated = await updateAdminUser(user.id, {
        ...values,
        email: values.email || null,
        department: values.department || null,
      });
      if (updated) {
        userEditor.hidden = true;
      }
    } catch (error) {
      adminUserStatus.textContent = error.message;
      adminUserStatus.dataset.state = "error";
    }
  });
  userEditor.append(form);
}

async function updateAdminUser(userId, values) {
  try {
    await adminFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    adminUserStatus.textContent = "Los datos del usuario se actualizaron.";
    adminUserStatus.dataset.state = "success";
    await loadAdminUsers();
    return true;
  } catch (error) {
    adminUserStatus.textContent = error.message;
    adminUserStatus.dataset.state = "error";
    return false;
  }
}

async function loadAdminRoles() {
  const { roles } = await adminFetch("/api/admin/roles");
  adminRoles = roles.filter(
    ({ name }) => name !== "Administrador" && name !== "Invitado",
  );
  newUserRole.replaceChildren();
  for (const role of roles.filter(
    ({ name }) =>
      name !== "Invitado" &&
      (name !== "Administrador" ||
        currentUser.permissions.includes("role_admin")),
  )) {
    const option = document.createElement("option");
    option.value = role.name;
    option.textContent = role.name;
    newUserRole.append(option);
  }
  rolePermissionsSelect.replaceChildren();
  for (const role of adminRoles) {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.name;
    rolePermissionsSelect.append(option);
  }
  renderRolePermissions();
}

function renderRolePermissions() {
  const role = adminRoles.find(({ id }) => id === rolePermissionsSelect.value);
  rolePermissionOptions.replaceChildren();
  const legend = document.createElement("legend");
  legend.textContent = "Permisos de módulos";
  rolePermissionOptions.append(legend);
  for (const [permission, labelText] of editablePermissions) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "permission";
    input.value = permission;
    input.checked = role?.permissions.includes(permission) ?? false;
    label.append(input, document.createTextNode(labelText));
    rolePermissionOptions.append(label);
  }
}

async function loadAuditEntries() {
  const { entries } = await adminFetch("/api/admin/audit");
  auditTableBody.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("tr");
    row.append(
      createTableCell(entry.username),
      createTableCell(entry.action),
      createTableCell(displayDate(entry.dateTime)),
      createTableCell(entry.ip),
      createTableCell(entry.detail),
    );
    auditTableBody.append(row);
  }
}

async function initializeAdministration() {
  if (!currentUser) {
    return;
  }
  if (!adminUiInitialized) {
    createRoleOptions(newUserRole, "Finanzas");
    createUserForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(createUserForm));
      try {
        const result = await adminFetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        adminUserStatus.textContent =
          `Usuario creado. Contraseña temporal de ${values.username} (se muestra una vez): ${result.temporaryPassword}`;
        adminUserStatus.dataset.state = "success";
        createUserForm.reset();
        await loadAdminUsers();
      } catch (error) {
        adminUserStatus.textContent = error.message;
        adminUserStatus.dataset.state = "error";
      }
    });
    rolePermissionsSelect.addEventListener("change", renderRolePermissions);
    rolePermissionsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const role = adminRoles.find(
        ({ id }) => id === rolePermissionsSelect.value,
      );
      if (!role) {
        return;
      }
      const permissions = [
        ...rolePermissionOptions.querySelectorAll(
          'input[name="permission"]:checked',
        ),
      ].map(({ value }) => value);
      try {
        await adminFetch(
          `/api/admin/roles/${encodeURIComponent(role.id)}/permissions`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permissions }),
          },
        );
        roleStatus.textContent = `Permisos actualizados para ${role.name}.`;
        roleStatus.dataset.state = "success";
        await loadAdminRoles();
      } catch (error) {
        roleStatus.textContent = error.message;
        roleStatus.dataset.state = "error";
      }
    });
    adminUiInitialized = true;
  }
  const tasks = [];
  if (currentUser.permissions.includes("user_admin")) {
    tasks.push(loadAdminUsers());
  }
  if (currentUser.permissions.includes("user_admin")) {
    tasks.push(loadAdminRoles());
  }
  if (currentUser.permissions.includes("audit")) {
    tasks.push(loadAuditEntries());
  }
  await Promise.all(tasks);
}

function scrollToLatestMessage() {
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

function createMessage(role, text, { tools = false } = {}) {
  const isAssistant = role === "assistant";
  const article = document.createElement("article");
  article.className = `message ${isAssistant ? "message-assistant" : "message-user"}`;

  if (isAssistant) {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const logo = document.createElement("img");
    logo.className = "avatar-logo";
    logo.src = "/logo.svg";
    logo.alt = "";
    avatar.append(logo);
    article.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";

  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = isAssistant ? "Río Claro" : "Tú";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);
  content.append(label, bubble);

  if (isAssistant && tools && canSpeak) {
    const actions = document.createElement("div");
    actions.className = "message-tools";
    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.textContent = "Escuchar";
    speakButton.setAttribute("aria-label", "Escuchar respuesta");
    speakButton.addEventListener("click", () => speakReply(text));
    actions.append(speakButton);
    content.append(actions);
  }

  article.append(content);
  chatHistory.append(article);
  scrollToLatestMessage();
  return article;
}

function createTypingMessage() {
  const article = document.createElement("article");
  article.className = "message message-assistant";
  article.setAttribute("aria-label", "Río Claro está escribiendo");

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  const logo = document.createElement("img");
  logo.className = "avatar-logo";
  logo.src = "/logo.svg";
  logo.alt = "";
  avatar.append(logo);

  const content = document.createElement("div");
  content.className = "message-content";
  const label = document.createElement("p");
  label.className = "message-label";
  label.textContent = "Río Claro";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", "Escribiendo…");
  const indicator = document.createElement("span");
  indicator.className = "typing-indicator";
  indicator.setAttribute("aria-hidden", "true");
  for (let dot = 0; dot < 3; dot += 1) {
    indicator.append(document.createElement("span"));
  }
  bubble.append(indicator);
  content.append(label, bubble);
  article.append(avatar, content);
  chatHistory.append(article);
  scrollToLatestMessage();
  return article;
}

function speakReply(text) {
  if (!canSpeak) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-ES";
  window.speechSynthesis.speak(utterance);
}

function addInvoiceText(parent, tagName, className, value) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = value;
  parent.append(element);
  return element;
}

function createInvoiceCard(record, source) {
  const article = document.createElement("article");
  article.className = "invoice-record";
  addInvoiceText(article, "h3", "invoice-record-title", record.label);
  addInvoiceText(article, "p", "invoice-record-name", record.fileName);

  const actions = document.createElement("div");
  actions.className = "invoice-record-actions";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "icon-button";
  previewButton.textContent = "Ver factura";
  previewButton.setAttribute("aria-label", `Ver ${record.fileName}`);
  previewButton.addEventListener("click", () => {
    void showInvoicePreview(record, source);
  });
  actions.append(previewButton);

  if (invoiceAnalysisEnabled) {
    const analyzeButton = document.createElement("button");
    analyzeButton.type = "button";
    analyzeButton.className = "icon-button";
    analyzeButton.textContent = "Extraer y validar";
    analyzeButton.setAttribute("aria-label", `Extraer y validar ${record.fileName}`);
    analyzeButton.addEventListener("click", () => {
      const endpoint =
        source === "sample"
          ? `/api/invoices/samples/${encodeURIComponent(record.id)}/analyze`
          : `/api/invoices/${encodeURIComponent(record.id)}/analyze`;
      void analyzeInvoice(endpoint);
    });
    actions.append(analyzeButton);
  }

  article.append(actions);
  return article;
}

function renderInvoiceRecords(samples, uploads) {
  const entries = [
    ...samples.map((record) => ({
      ...record,
      label: record.label,
      source: "sample",
    })),
    ...uploads.map((record) => ({
      ...record,
      label: "Factura guardada",
      source: "upload",
    })),
  ];
  invoiceRecords.replaceChildren(
    ...entries.map(({ source, ...record }) =>
      createInvoiceCard(record, source),
    ),
  );
  if (entries.length === 0) {
    addInvoiceText(
      invoiceRecords,
      "p",
      "invoice-empty",
      "No hay ejemplos ni facturas guardadas para mostrar.",
    );
  }
}

function clearInvoicePreview() {
  invoicePreview.hidden = true;
  invoicePreview.replaceChildren();
  if (invoicePreviewUrl) {
    URL.revokeObjectURL(invoicePreviewUrl);
    invoicePreviewUrl = null;
  }
}


async function loadInvoiceGallery() {
  if (!invoiceGalleryEnabled || invoiceLoadButton.disabled) {
    return false;
  }

  invoiceLoadButton.disabled = true;
  invoiceStatus.textContent = "Consultando ejemplos y facturas guardadas…";
  invoiceStatus.dataset.state = "";
  invoiceRecords.replaceChildren();
  clearInvoicePreview();
  invoiceAnalysis.hidden = true;
  invoiceAnalysis.replaceChildren();

  try {
    const sampleResponse = await accessFetch("invoices", "/api/invoices/samples");
    const sampleResult = await sampleResponse.json();
    if (!sampleResponse.ok) {
      throw new Error(
        typeof sampleResult.detail === "string"
          ? sampleResult.detail
          : "No se pudieron consultar los ejemplos.",
      );
    }

    let uploads = [];
    if (invoiceUploadEnabled) {
      const uploadResponse = await accessFetch("invoices", "/api/invoices");
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(
          typeof uploadResult.detail === "string"
            ? uploadResult.detail
            : "No se pudieron consultar las facturas guardadas.",
        );
      }
      uploads = uploadResult.records;
    }

    renderInvoiceRecords(sampleResult.records, uploads);
    invoiceStatus.textContent = invoiceAnalysisEnabled
      ? "Ejemplos y facturas cargados. Elige una para verla o extraer sus datos localmente."
      : "Ejemplos y facturas cargados. La extracción no está configurada.";
    invoiceStatus.dataset.state = invoiceAnalysisEnabled ? "success" : "warning";
    return true;
  } catch (error) {
    invoiceStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudieron consultar las facturas. Inténtalo más tarde.";
    invoiceStatus.dataset.state = "error";
    return false;
  } finally {
    invoiceLoadButton.disabled = !accessState.invoices.authenticated;
  }
}

async function showInvoicePreview(record, source) {
  invoiceStatus.textContent = `Abriendo ${record.fileName}…`;
  invoiceStatus.dataset.state = "";
  clearInvoicePreview();

  const endpoint =
    source === "sample"
      ? `/api/invoices/samples/${encodeURIComponent(record.id)}`
      : `/api/invoices/${encodeURIComponent(record.id)}/file`;
  try {
    const response = await accessFetch("invoices", endpoint);
    if (!response.ok) {
      const result = await response.json();
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo abrir la factura.",
      );
    }

    const file = await response.blob();
    invoicePreviewUrl = URL.createObjectURL(file);
    invoicePreview.replaceChildren();
    addInvoiceText(invoicePreview, "h3", "invoice-preview-title", record.fileName);
    if (file.type === "application/pdf") {
      const frame = document.createElement("iframe");
      frame.className = "invoice-preview-frame";
      frame.src = invoicePreviewUrl;
      frame.title = `Vista previa de ${record.fileName}`;
      frame.referrerPolicy = "no-referrer";
      invoicePreview.append(frame);
    } else if (file.type === "image/jpeg" || file.type === "image/png") {
      const image = document.createElement("img");
      image.className = "invoice-preview-image";
      image.src = invoicePreviewUrl;
      image.alt = `Vista previa de ${record.fileName}`;
      invoicePreview.append(image);
    } else {
      throw new Error("El formato de factura no se puede previsualizar.");
    }
    invoicePreview.hidden = false;
    invoiceStatus.textContent = `Vista previa: ${record.fileName}.`;
    invoiceStatus.dataset.state = "success";
  } catch (error) {
    invoiceStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo abrir la factura. Inténtalo más tarde.";
    invoiceStatus.dataset.state = "error";
  }
}

function formatInvoiceAmount(value) {
  if (!value || typeof value.amount !== "number") {
    return "No detectado";
  }
  if (
    typeof value.currencyCode === "string" &&
    /^[A-Z]{3}$/.test(value.currencyCode)
  ) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: value.currencyCode,
    }).format(value.amount);
  }
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 2,
  }).format(value.amount);
}

function renderInvoiceAnalysis(result) {
  invoiceAnalysis.replaceChildren();
  invoiceAnalysis.hidden = false;
  addInvoiceText(
    invoiceAnalysis,
    "h3",
    `invoice-analysis-title invoice-analysis-${result.status}`,
    result.label,
  );

  const invoice = result.invoice;
  const fields = document.createElement("dl");
  fields.className = "invoice-analysis-fields";
  const fieldValues = [
    ["Folio", invoice.invoiceNumber ?? "No detectado"],
    ["Fecha", invoice.issueDate ?? "No detectada"],
    ["Proveedor", invoice.vendorName ?? "No detectado"],
    ["RFC del proveedor", invoice.vendorTaxId ?? "No detectado"],
    ["Cliente", invoice.customerName ?? "No detectado"],
    ["Subtotal", formatInvoiceAmount(invoice.subtotal)],
    ["Impuestos", formatInvoiceAmount(invoice.tax)],
    ["Total", formatInvoiceAmount(invoice.total)],
    ["Saldo", formatInvoiceAmount(invoice.amountDue)],
  ];
  for (const [label, value] of fieldValues) {
    addInvoiceText(fields, "dt", "", label);
    addInvoiceText(fields, "dd", "", value);
  }

  const checks = document.createElement("ul");
  checks.className = "invoice-analysis-checks";
  for (const check of result.checks) {
    const item = document.createElement("li");
    item.dataset.state = check.status;
    item.textContent = `${check.label}: ${check.message}`;
    checks.append(item);
  }
  invoiceAnalysis.append(fields);
  if (invoice.items.length > 0) {
    addInvoiceText(invoiceAnalysis, "h4", "invoice-items-title", "Partidas");
    const items = document.createElement("div");
    items.className = "invoice-items";
    for (const [index, item] of invoice.items.entries()) {
      const article = document.createElement("article");
      article.className = "invoice-item";
      addInvoiceText(
        article,
        "p",
        "invoice-item-description",
        item.description ?? `Partida ${index + 1}`,
      );
      const detailValues = [
        `Cantidad: ${item.quantity ?? "No detectada"}`,
        `Precio unitario: ${formatInvoiceAmount(item.unitPrice)}`,
        `Importe: ${formatInvoiceAmount(item.amount)}`,
      ];
      addInvoiceText(article, "p", "invoice-item-details", detailValues.join(" · "));
      items.append(article);
    }
    invoiceAnalysis.append(items);
  }
  invoiceAnalysis.append(checks);
  addInvoiceText(invoiceAnalysis, "p", "invoice-analysis-disclaimer", result.disclaimer);
}

async function analyzeInvoice(endpoint) {
  if (!invoiceAnalysisEnabled) {
    return;
  }

  invoiceStatus.textContent = "Extrayendo y revisando los datos de la factura…";
  invoiceStatus.dataset.state = "";
  invoiceAnalysis.hidden = true;

  try {
    const response = await accessFetch("invoices", endpoint, { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo extraer la factura.",
      );
    }

    renderInvoiceAnalysis(result);
    invoiceStatus.textContent = "Extracción finalizada. Revisa los campos detectados.";
    invoiceStatus.dataset.state = result.status === "valid" ? "success" : "warning";
  } catch (error) {
    invoiceStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo extraer la factura. Inténtalo más tarde.";
    invoiceStatus.dataset.state = "error";
  }
}

function formatSupplierDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("es-MX", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getSupplierStatusLabel(status) {
  return {
    paid: "Pagado",
    pending: "Pendiente",
    overdue: "Vencido",
  }[status];
}

function createSupplierRecord(record) {
  const article = document.createElement("article");
  article.className = "supplier-record";

  const header = document.createElement("div");
  header.className = "supplier-record-header";
  const supplierName = document.createElement("h3");
  supplierName.className = "supplier-name";
  supplierName.textContent = record.supplier;

  const status = document.createElement("span");
  status.className = `supplier-status-badge supplier-status-${record.status}`;
  status.textContent = getSupplierStatusLabel(record.status);
  header.append(supplierName, status);

  const description = document.createElement("p");
  description.className = "supplier-description";
  description.textContent = record.description;

  const details = document.createElement("dl");
  details.className = "supplier-details";
  const amountLabel = document.createElement("dt");
  amountLabel.textContent = "Importe";
  const amountValue = document.createElement("dd");
  amountValue.textContent = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(record.amount);
  const dueLabel = document.createElement("dt");
  dueLabel.textContent = "Fecha límite";
  const dueValue = document.createElement("dd");
  dueValue.textContent = formatSupplierDate(record.dueDate);
  details.append(amountLabel, amountValue, dueLabel, dueValue);

  const message = document.createElement("p");
  message.className = `supplier-record-message supplier-message-${record.status}`;
  if (record.status === "paid") {
    message.textContent = record.paidDate
      ? `Pagado el ${formatSupplierDate(record.paidDate)}.`
      : "Pago registrado.";
  } else if (record.status === "pending") {
    message.textContent =
      record.daysUntilDue === 0
        ? "El pago vence hoy."
        : `Faltan ${record.daysUntilDue} ${record.daysUntilDue === 1 ? "día" : "días"} para el vencimiento.`;
  } else {
    message.textContent = `Pago vencido desde el ${formatSupplierDate(record.dueDate)}.`;
  }

  article.append(header, description, details, message);
  return article;
}

function renderSupplierRecords() {
  const selectedStatus = supplierStatusFilter.value;
  const visibleRecords =
    selectedStatus === "all"
      ? supplierPayments
      : supplierPayments.filter(({ status }) => status === selectedStatus);
  supplierRecords.replaceChildren(
    ...visibleRecords.map((record) => createSupplierRecord(record)),
  );
}

function formatSalesMonth(value) {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString("es-MX", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function renderSalesChart(container, records, { labelKey, valueKey, unit }) {
  container.replaceChildren();
  const visibleRecords = records.slice(0, 6);
  if (visibleRecords.length === 0) {
    addInvoiceText(
      container,
      "p",
      "sales-chart-empty",
      "No hay entregas realizadas en el periodo disponible.",
    );
    return;
  }

  const maxValue = Math.max(
    1,
    ...visibleRecords.map((record) => record[valueKey]),
  );
  container.setAttribute("role", "list");
  for (const record of visibleRecords) {
    const row = document.createElement("div");
    row.className = "sales-chart-row";
    row.setAttribute("role", "listitem");
    const heading = document.createElement("div");
    heading.className = "sales-chart-row-heading";
    const label = document.createElement("span");
    label.className = "sales-chart-label";
    label.textContent =
      labelKey === "month"
        ? formatSalesMonth(record[labelKey])
        : record[labelKey];
    label.title = label.textContent;
    const value = document.createElement("span");
    value.className = "sales-chart-value";
    value.textContent = `${new Intl.NumberFormat("es-MX").format(record[valueKey])} ${unit}`;
    heading.append(label, value);

    const track = document.createElement("div");
    track.className = "sales-chart-track";
    track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("div");
    bar.className = "sales-chart-bar";
    bar.style.setProperty(
      "--sales-chart-width",
      `${Math.max(3, (record[valueKey] / maxValue) * 100)}%`,
    );
    track.append(bar);
    row.append(heading, track);
    container.append(row);
  }
}

function renderSalesProductPie(records) {
  const colors = [
    "#087f72",
    "#d89536",
    "#4c70a5",
    "#b46a71",
    "#72964b",
    "#8a6bb1",
    "#d17b42",
    "#4d9ba4",
    "#a88a4c",
    "#687b91",
  ];
  const total = records.reduce((sum, record) => sum + record.unitsSold, 0);
  salesPieTotal.textContent = new Intl.NumberFormat("es-MX").format(total);
  salesPieLegend.replaceChildren();

  if (total <= 0 || records.length === 0) {
    salesProductPie.style.backgroundImage = "none";
    salesProductPie.setAttribute(
      "aria-label",
      "No hay unidades entregadas para mostrar",
    );
    addInvoiceText(
      salesPieLegend,
      "li",
      "sales-pie-empty",
      "No hay unidades entregadas para mostrar.",
    );
    return;
  }

  let currentPercentage = 0;
  const segments = [];
  for (const [index, record] of records.entries()) {
    const percentage = (record.unitsSold / total) * 100;
    const nextPercentage = currentPercentage + percentage;
    const color = colors[index % colors.length];
    segments.push(`${color} ${currentPercentage}% ${nextPercentage}%`);

    const item = document.createElement("li");
    item.className = "sales-pie-item";
    const marker = document.createElement("span");
    marker.className = "sales-pie-marker";
    marker.style.backgroundColor = color;
    marker.setAttribute("aria-hidden", "true");
    const details = document.createElement("span");
    details.className = "sales-pie-details";
    const label = document.createElement("span");
    label.className = "sales-pie-label";
    label.textContent = record.product;
    const value = document.createElement("span");
    value.className = "sales-pie-value";
    const formattedPercentage = new Intl.NumberFormat("es-MX", {
      maximumFractionDigits: 1,
    }).format(percentage);
    value.textContent =
      `${new Intl.NumberFormat("es-MX").format(record.unitsSold)} unidades · ${formattedPercentage}%`;
    details.append(label, value);
    item.append(marker, details);
    salesPieLegend.append(item);
    currentPercentage = nextPercentage;
  }

  salesProductPie.style.backgroundImage =
    `conic-gradient(${segments.join(", ")})`;
  salesProductPie.setAttribute(
    "aria-label",
    `Distribución de ${new Intl.NumberFormat("es-MX").format(total)} unidades entregadas entre ${records.length} productos`,
  );
}

function renderSalesPerformance(report) {
  salesReport = report;
  document.querySelector("#sales-count-delivered").textContent =
    new Intl.NumberFormat("es-MX").format(report.completedDeliveryCount);
  document.querySelector("#sales-units-sold").textContent =
    new Intl.NumberFormat("es-MX").format(report.unitsSold);
  document.querySelector("#sales-revenue").textContent =
    report.collectedRevenue === null
      ? "Sin datos"
      : new Intl.NumberFormat("es-MX", {
          style: "currency",
          currency: report.currency ?? "MXN",
        }).format(report.collectedRevenue);
  salesReferenceDate.textContent = report.deliveriesReferenceDate
    ? `Registro al ${formatDeliveryDate(report.deliveriesReferenceDate)}`
    : "";
  renderSalesChart(salesMonthChart, report.salesByMonth, {
    labelKey: "month",
    valueKey: "orderCount",
    unit: "entregas",
  });
  renderSalesChart(salesProductChart, report.topProducts, {
    labelKey: "product",
    valueKey: "unitsSold",
    unit: "unidades",
  });
  renderSalesProductPie(report.topProducts);
  renderSalesChart(salesCustomerChart, report.topCustomers, {
    labelKey: "customer",
    valueKey: "unitsSold",
    unit: "unidades",
  });
  salesDataNote.textContent = [
    report.salesDateBasis,
    report.fictional
      ? "El registro fuente contiene información ficticia."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  salesStatus.textContent = report.fictional
    ? "Reporte actualizado con datos ficticios de ejemplo; no es un registro contable."
    : "Reporte actualizado a partir de las entregas registradas.";
  salesStatus.dataset.state = report.fictional ? "warning" : "success";
  salesResults.hidden = false;
}

async function loadSalesPerformance() {
  if (!accessState.sales.authenticated) {
    return;
  }

  salesLoadButton.disabled = true;
  salesStatus.textContent = "Calculando el resumen de ventas realizadas…";
  salesStatus.dataset.state = "";
  salesResults.hidden = true;

  try {
    const response = await accessFetch("sales", "/api/sales");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo consultar el reporte de ventas.",
      );
    }

    renderSalesPerformance(result);
  } catch (error) {
    salesStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo consultar el reporte de ventas. Inténtalo más tarde.";
    salesStatus.dataset.state = "error";
  } finally {
    salesLoadButton.disabled = !accessState.sales.authenticated;
  }
}

function formatDeliveryDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("es-MX", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDeliveryBadgeLabel(fulfillment) {
  return {
    ready: "Se puede surtir",
    shortage: "Faltante",
    delivered: "Entregado",
    unknown: "Sin coincidencia",
  }[fulfillment];
}

function createDeliveryRecord(record) {
  const article = document.createElement("article");
  article.className = "delivery-record";

  const header = document.createElement("div");
  header.className = "delivery-record-header";
  const customer = document.createElement("h3");
  customer.className = "delivery-customer";
  customer.textContent = record.customer;
  const badge = document.createElement("span");
  badge.className = `delivery-badge delivery-badge-${record.fulfillment}`;
  badge.textContent = getDeliveryBadgeLabel(record.fulfillment);
  header.append(customer, badge);

  const product = document.createElement("p");
  product.className = "delivery-product";
  product.textContent = `${record.product} · ${record.status}`;

  const details = document.createElement("dl");
  details.className = "delivery-details";
  const detailPairs = [
    ["Solicitado", `${record.quantity} unidades`],
    ["SKU", record.sku ?? "Sin coincidencia"],
    ["Entrega programada", formatDeliveryDate(record.deliveryDate)],
  ];
  if (record.availableForOrder !== null) {
    detailPairs.push([
      "Disponible para este pedido",
      `${record.availableForOrder} unidades`,
    ]);
  }
  if (record.fulfillment === "shortage") {
    detailPairs.push(["Faltan", `${record.shortage} unidades`]);
  } else if (record.fulfillment === "ready") {
    detailPairs.push(["Asignadas", `${record.allocatedQuantity} unidades`]);
  }
  for (const [label, value] of detailPairs) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }

  const message = document.createElement("p");
  message.className = `delivery-record-message delivery-message-${record.fulfillment}`;
  if (record.fulfillment === "ready") {
    message.textContent =
      "Las existencias alcanzan para este pedido según la asignación por fecha de entrega.";
  } else if (record.fulfillment === "shortage") {
    message.textContent = `No alcanza el inventario asignable: faltan ${record.shortage} unidades.`;
  } else if (record.fulfillment === "unknown") {
    message.textContent =
      "No se encontró una coincidencia exacta del producto en el inventario.";
  } else {
    message.textContent = "Esta entrega ya aparece como completada en el registro.";
  }

  article.append(header, product, details, message);
  return article;
}

function renderDeliveryRecords() {
  if (!deliveryReport) {
    return;
  }
  const selectedFulfillment = deliveryFilter.value;
  const visibleRecords =
    selectedFulfillment === "all"
      ? deliveryReport.records
      : deliveryReport.records.filter(
          ({ fulfillment }) => fulfillment === selectedFulfillment,
        );
  deliveryRecords.replaceChildren(
    ...visibleRecords.map((record) => createDeliveryRecord(record)),
  );
  deliveryPrepareNotification.hidden = deliveryReport.counts.shortage === 0;
}

const deliveryQuestionStopWords = new Set([
  "a",
  "al",
  "algun",
  "alguna",
  "algunas",
  "algunos",
  "como",
  "con",
  "cual",
  "cuales",
  "cuando",
  "cuanto",
  "cuantos",
  "de",
  "del",
  "donde",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "es",
  "esta",
  "estan",
  "estas",
  "este",
  "estos",
  "hay",
  "la",
  "las",
  "lo",
  "los",
  "me",
  "mi",
  "mis",
  "mostrar",
  "necesito",
  "para",
  "por",
  "pueden",
  "puedo",
  "que",
  "quiero",
  "saber",
  "se",
  "sobre",
  "tiene",
  "tienen",
  "una",
  "uno",
  "un",
  "ver",
  "y",
  "entrega",
  "entregas",
  "pedido",
  "pedidos",
  "cliente",
  "producto",
  "productos",
  "inventario",
  "estado",
]);

function normalizeDeliveryText(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-MX");
}

function answerDeliveryQuestion(question) {
  const normalizedQuestion = normalizeDeliveryText(question);
  let candidates = deliveryReport.records;
  if (/faltan|faltante|faltantes|notific|comprar|insuficient/.test(normalizedQuestion)) {
    candidates = candidates.filter(({ fulfillment }) => fulfillment === "shortage");
  } else if (/retras|atras|demor/.test(normalizedQuestion)) {
    candidates = candidates.filter(({ status }) =>
      normalizeDeliveryText(status).includes("retras"),
    );
  } else if (/surtir|disponible|complet/.test(normalizedQuestion)) {
    candidates = candidates.filter(({ fulfillment }) => fulfillment === "ready");
  } else if (/entregado|entregada|completado/.test(normalizedQuestion)) {
    candidates = candidates.filter(({ fulfillment }) => fulfillment === "delivered");
  }

  const searchTerms = normalizedQuestion
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(
      (term) =>
        term.length > 2 &&
        !deliveryQuestionStopWords.has(term) &&
        !/^(faltan|faltante|faltantes|notificar|notifique|comprar|insuficiente|surtir|disponible|completa|completas|retrasado|retrasada|atrasado|atrasada)$/.test(
          term,
        ),
    );
  if (searchTerms.length) {
    candidates = candidates.filter((record) => {
      const searchable = normalizeDeliveryText(
        `${record.customer} ${record.product} ${record.status} ${record.sku ?? ""}`,
      );
      return searchTerms.some((term) => searchable.includes(term));
    });
  }

  if (candidates.length === 0) {
    return "No encontré entregas que coincidan con esa consulta en el registro.";
  }

  const lines = candidates.map((record) => {
    const shortage =
      record.fulfillment === "shortage"
        ? `; faltan ${record.shortage} unidades`
        : "";
    const available =
      record.availableForOrder === null
        ? ""
        : `; ${record.availableForOrder} disponibles antes de asignar`;
    return `${record.customer}: ${record.product}, ${record.quantity} solicitadas; ${record.status}${available}${shortage}.`;
  });
  return lines.join("\n");
}

function createDeliveryNotification(report) {
  const shortages = report.records.filter(
    ({ fulfillment }) => fulfillment === "shortage",
  );
  if (shortages.length === 0) {
    return "No hay faltantes identificados en el registro consultado.";
  }

  const lines = [
    "AVISO DE FALTANTES PARA ENCARGADOS DE PROVEEDORES",
    `Fecha de consulta: ${formatDeliveryDate(report.referenceDate)}`,
    "Favor de revisar disponibilidad y resurtido de los siguientes productos:",
  ];
  for (const record of shortages) {
    lines.push(
      `- ${record.product} (${record.sku}): faltan ${record.shortage} unidades para ${record.customer}; solicitadas ${record.quantity}, disponibles para asignar ${record.availableForOrder}. Entrega programada: ${formatDeliveryDate(record.deliveryDate)}.`,
    );
  }
  lines.push(
    "Aviso preparado desde el registro interno. Verifica los datos en los sistemas oficiales antes de surtir.",
  );
  return lines.join("\n");
}

supplierStatusFilter.addEventListener("change", renderSupplierRecords);
deliveryFilter.addEventListener("change", renderDeliveryRecords);

deliveryPrepareNotification.addEventListener("click", () => {
  if (!deliveryReport) {
    return;
  }
  deliveryNotificationMessage.value = createDeliveryNotification(deliveryReport);
  deliveryNotificationStatus.textContent =
    "Aviso listo para revisar y compartir con los encargados de proveedores.";
  deliveryNotificationStatus.dataset.state = "warning";
  deliveryNotification.hidden = false;
});

async function loadDeliveryReadiness() {
  if (!accessState.deliveries.authenticated) {
    return;
  }

  deliveryLoadButton.disabled = true;
  deliveryStatus.textContent = "Consultando entregas e inventario…";
  deliveryStatus.dataset.state = "";
  deliveryResults.hidden = true;
  deliveryNotification.hidden = true;
  deliveryAnswer.textContent = "";

  try {
    const response = await accessFetch("deliveries", "/api/deliveries");
    const result = await response.json();

    if (!response.ok) {
      deliveryStatus.textContent =
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo consultar la disponibilidad.";
      deliveryStatus.dataset.state = "error";
      return;
    }

    deliveryReport = result;
    document.querySelector("#delivery-count-ready").textContent =
      result.counts.ready;
    document.querySelector("#delivery-count-shortage").textContent =
      result.counts.shortage;
    document.querySelector("#delivery-count-delivered").textContent =
      result.counts.delivered;
    deliveryReferenceDate.textContent = result.inventoryReferenceDate
      ? `Inventario al ${formatDeliveryDate(result.inventoryReferenceDate)}`
      : `Consulta: ${formatDeliveryDate(result.referenceDate)}`;
    deliveryStatus.textContent = result.fictional
      ? "Datos ficticios de ejemplo; el cálculo no reserva existencias en tiempo real. Confirma los datos antes de surtir."
      : "Consulta actualizada. La disponibilidad es una estimación basada en el inventario registrado.";
    deliveryStatus.dataset.state = result.fictional ? "warning" : "success";
    deliveryFilter.value = "all";
    renderDeliveryRecords();
    deliveryResults.hidden = false;
    deliveryPrepareNotification.hidden = result.counts.shortage === 0;
  } catch (error) {
    deliveryStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo conectar para consultar las entregas. Inténtalo más tarde.";
    deliveryStatus.dataset.state = "error";
  } finally {
    deliveryLoadButton.disabled = !accessState.deliveries.authenticated;
  }
}

deliveryQuestionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!deliveryReport || deliveryAskButton.disabled) {
    return;
  }

  const question = deliveryQuestion.value.trim();
  if (!question) {
    deliveryAnswer.textContent = "Escribe o dicta una pregunta.";
    return;
  }
  const answer = answerDeliveryQuestion(question);
  deliveryAnswer.textContent = answer;
  speakReply(answer);
});

deliveryShareButton.addEventListener("click", async () => {
  const text = deliveryNotificationMessage.value;
  if (!text) {
    return;
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Faltantes de inventario - Río Claro",
        text,
      });
      deliveryNotificationStatus.textContent = "Aviso compartido.";
      deliveryNotificationStatus.dataset.state = "success";
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        deliveryNotificationStatus.textContent =
          "Compartir se canceló. El aviso sigue disponible para copiar.";
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    deliveryNotificationStatus.textContent =
      "Aviso copiado. Envíalo al encargado de proveedores por el canal autorizado.";
    deliveryNotificationStatus.dataset.state = "success";
  } catch {
    deliveryNotificationStatus.textContent =
      "No se pudo copiar automáticamente. Selecciona y copia el texto del aviso.";
    deliveryNotificationStatus.dataset.state = "error";
  }
});

if (SpeechRecognition) {
  deliveryDictateButton.hidden = false;
  const deliveryRecognition = new SpeechRecognition();
  deliveryRecognition.lang = "es-MX";
  deliveryRecognition.interimResults = false;
  deliveryRecognition.maxAlternatives = 1;

  deliveryDictateButton.addEventListener("click", () => {
    try {
      deliveryRecognition.start();
      deliveryDictateButton.setAttribute("aria-pressed", "true");
      deliveryAnswer.textContent = "Escuchando la pregunta de entregas…";
    } catch {
      deliveryAnswer.textContent = "No se pudo iniciar el dictado.";
    }
  });

  deliveryRecognition.addEventListener("result", (event) => {
    deliveryQuestion.value = event.results[0][0].transcript;
    deliveryQuestionForm.requestSubmit();
  });

  deliveryRecognition.addEventListener("error", () => {
    deliveryAnswer.textContent = "No se pudo reconocer la pregunta de voz.";
  });

  deliveryRecognition.addEventListener("end", () => {
    deliveryDictateButton.setAttribute("aria-pressed", "false");
  });
}

async function loadSupplierPayments() {
  if (!accessState.suppliers.authenticated) {
    return;
  }

  supplierLoadButton.disabled = true;
  supplierStatus.textContent = "Consultando estado de pagos…";
  supplierStatus.dataset.state = "";
  supplierResults.hidden = true;

  try {
    const response = await accessFetch("suppliers", "/api/suppliers");
    const result = await response.json();

    if (!response.ok) {
      supplierStatus.textContent =
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo consultar el estado de pagos.";
      supplierStatus.dataset.state = "error";
      return;
    }

    supplierPayments = result.records;
    document.querySelector("#supplier-count-paid").textContent =
      result.counts.paid;
    document.querySelector("#supplier-count-pending").textContent =
      result.counts.pending;
    document.querySelector("#supplier-count-overdue").textContent =
      result.counts.overdue;
    supplierReferenceDate.textContent =
      `Corte: ${formatSupplierDate(result.referenceDate)}`;
    supplierStatus.textContent = result.fictional
      ? "Datos ficticios de ejemplo; confirma los importes y fechas en el sistema financiero antes de actuar."
      : "Consulta actualizada.";
    supplierStatus.dataset.state = result.fictional ? "warning" : "success";
    supplierStatusFilter.value = "all";
    renderSupplierRecords();
    supplierResults.hidden = false;
  } catch (error) {
    supplierStatus.textContent =
      error instanceof Error
        ? error.message
        : "No se pudo conectar para consultar los pagos. Inténtalo más tarde.";
    supplierStatus.dataset.state = "error";
  } finally {
    supplierLoadButton.disabled = !accessState.suppliers.authenticated;
  }
}

function showAssistantError(message) {
  createMessage("assistant", message, { tools: true });
  chatStatus.textContent = message;
}

invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = invoiceFile.files?.[0];
  if (!file || invoiceUploadButton.disabled) {
    return;
  }

  invoiceUploadButton.disabled = true;
  invoiceStatus.textContent = invoiceAnalysisEnabled
    ? "Guardando factura y ejecutando OCR local…"
    : "Guardando factura…";
  invoiceStatus.dataset.state = "";

  const formData = new FormData();
  formData.append("invoice", file);

  try {
    const response = await accessFetch("invoices", "/api/invoices", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();

    if (!response.ok) {
      invoiceStatus.textContent =
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo guardar la factura.";
      invoiceStatus.dataset.state = response.status === 409 ? "warning" : "error";
      if (response.status === 409) {
        invoiceFile.value = "";
        const duplicateMessage = invoiceStatus.textContent;
        if (invoiceGalleryEnabled) {
          await loadInvoiceGallery();
        }
        invoiceStatus.textContent = duplicateMessage;
        invoiceStatus.dataset.state = "warning";
      }
      return;
    }

    const savedMessage = [
      result.detail,
      result.analysis_error,
      `Archivo: ${result.file_name}.`,
      `ID: ${result.invoice_id}.`,
    ]
      .filter(Boolean)
      .join(" ");
    invoiceStatus.dataset.state = result.analysis
      ? result.analysis.status === "valid"
        ? "success"
        : "warning"
      : result.analysis_error
        ? "warning"
        : "success";
    invoiceFile.value = "";
    let galleryLoaded = true;
    if (invoiceGalleryEnabled) {
      galleryLoaded = await loadInvoiceGallery();
    }
    if (result.analysis) {
      renderInvoiceAnalysis(result.analysis);
    } else {
      invoiceAnalysis.hidden = true;
    }
    invoiceStatus.textContent = galleryLoaded
      ? savedMessage
      : `${savedMessage} No se pudo actualizar la galería; vuelve a consultarla.`;
    invoiceStatus.dataset.state =
      !galleryLoaded || result.analysis_error
        ? "warning"
        : result.analysis
          ? result.analysis.status === "valid"
            ? "success"
            : "warning"
          : "success";
  } catch {
    invoiceStatus.textContent =
      "No se pudo conectar para guardar la factura. Inténtalo más tarde.";
    invoiceStatus.dataset.state = "error";
  } finally {
    invoiceUploadButton.disabled =
      !accessState.invoices.authenticated || !invoiceUploadEnabled;
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sendButton.disabled) {
    return;
  }

  const message = messageInput.value;
  createMessage("user", message);
  messageInput.value = "";
  messageInput.style.height = "auto";
  sendButton.disabled = true;
  sendLabel.textContent = "Escribiendo…";
  chatStatus.textContent = "Río Claro está escribiendo";
  const typingMessage = createTypingMessage();

  try {
    const response = await authenticatedFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      showAssistantError(
        typeof result.detail === "string"
          ? result.detail
          : "No se pudo completar la solicitud.",
      );
      return;
    }

    if (typeof result.reply !== "string" || typeof result.conversation_id !== "string") {
      throw new Error("La respuesta del servidor no tiene el formato esperado.");
    }

    conversationId = result.conversation_id;
    createMessage("assistant", result.reply, { tools: true });
    chatStatus.textContent = "Respuesta recibida";
  } catch {
    showAssistantError(
      "No se pudo conectar con el asistente. Inténtalo de nuevo más tarde.",
    );
  } finally {
    typingMessage.remove();
    sendButton.disabled = false;
    sendLabel.textContent = "Enviar";
    messageInput.focus();
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 115)}px`;
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  dictateButton.addEventListener("click", () => {
    try {
      recognition.start();
      dictateButton.setAttribute("aria-pressed", "true");
      chatStatus.textContent = "Escuchando";
    } catch {
      chatStatus.textContent = "No se pudo iniciar el dictado.";
    }
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value = [messageInput.value.trim(), transcript]
      .filter(Boolean)
      .join(" ");
    messageInput.dispatchEvent(new Event("input"));
    messageInput.focus();
  });

  recognition.addEventListener("error", () => {
    chatStatus.textContent = "No se pudo reconocer el mensaje de voz.";
  });

  recognition.addEventListener("end", () => {
    dictateButton.setAttribute("aria-pressed", "false");
    chatStatus.textContent = "Dictado finalizado";
  });
}
